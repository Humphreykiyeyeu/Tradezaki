import type { Strategy } from "@tradezaki/core";
import { validateStrategy } from "@tradezaki/core";

import { BotInstance, type BotRecord } from "./botInstance.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { logEvent, line } from "./log.js";

/**
 * The supervisor.
 *
 * Polls the bots table, starts anything marked `starting`, stops anything
 * marked `stopping`, and heartbeats what's running. The web app never talks to
 * this process — it writes a status to the database, and the runner reacts.
 * That indirection is what lets the runner be restarted, moved, or scaled
 * without the app knowing or caring.
 */

const running = new Map<string, BotInstance>();
let shuttingDown = false;

async function claimAndStart(row: Record<string, unknown>): Promise<void> {
  const botId = row.id as string;
  const userId = row.user_id as string;

  if (running.size >= config.maxBots) {
    await db
      .from("bots")
      .update({ status: "error", status_detail: "This server is at capacity. Try again shortly." })
      .eq("id", botId);
    return;
  }

  // Strategies are stored as JSONB and may have been written by an older build
  // or edited by hand. The IR is only safe because it is a closed shape, and
  // that guarantee holds only if it's checked before execution.
  const { data: strategyRow } = await db
    .from("strategies")
    .select("definition")
    .eq("id", row.strategy_id as string)
    .maybeSingle();

  const check = validateStrategy(strategyRow?.definition);
  if (!check.ok || !check.strategy) {
    const detail = check.issues.map((i) => i.message).join(" ") || "The strategy is not valid.";
    await db.from("bots").update({ status: "error", status_detail: detail }).eq("id", botId);
    await logEvent(userId, botId, "error", detail);
    return;
  }

  const record: BotRecord = {
    id: botId,
    user_id: userId,
    deriv_account_id: row.deriv_account_id as string,
    name: row.name as string,
    strategy: check.strategy as Strategy,
  };

  // Atomic claim. Two runners polling the same table would otherwise both see
  // status='starting' and both start the bot — the user gets every trade
  // placed twice, which is the worst possible way to discover you scaled out.
  // Only one UPDATE can match status='starting'; the loser gets no rows back.
  const { data: claimed } = await db
    .from("bots")
    .update({ status: "running", last_heartbeat: new Date().toISOString() })
    .eq("id", botId)
    .eq("status", "starting")
    .select("id");

  if (!claimed || claimed.length === 0) {
    line(botId, "another runner claimed this bot");
    return;
  }

  const instance = new BotInstance(record, 2);
  running.set(botId, instance);

  try {
    await instance.start();
  } catch (err) {
    running.delete(botId);
    const message = err instanceof Error ? err.message : "Could not start.";
    await db.from("bots").update({ status: "error", status_detail: message }).eq("id", botId);
    await logEvent(userId, botId, "error", message);
    line(botId, `failed to start: ${message}`);
  }
}

async function poll(): Promise<void> {
  if (shuttingDown) return;

  const { data, error } = await db
    .from("bots")
    .select("id, user_id, strategy_id, deriv_account_id, name, status, last_heartbeat")
    .in("status", ["starting", "running", "stopping"]);

  if (error) {
    console.error("poll failed:", error.message);
    return;
  }

  const seen = new Set<string>();

  for (const row of data ?? []) {
    const id = row.id as string;
    seen.add(id);
    const status = row.status as string;
    const instance = running.get(id);

    if (status === "stopping" && instance) {
      await instance.stop();
      running.delete(id);
      continue;
    }

    if (status === "starting" && !instance) {
      await claimAndStart(row);
      continue;
    }

    // Marked running but this process isn't running it. Either another runner
    // owns it, or a previous process died holding it. Either way, a bot that
    // nothing is executing must not sit there looking alive — the user would
    // believe it was trading.
    if (status === "running" && !instance) {
      const stale =
        !row.last_heartbeat ||
        Date.now() - Date.parse(row.last_heartbeat as string) > config.heartbeatMs * 4;
      if (stale) {
        await db
          .from("bots")
          .update({
            status: "error",
            status_detail: "The server running this bot stopped unexpectedly. Start it again.",
          })
          .eq("id", id);
        await logEvent(
          row.user_id as string,
          id,
          "error",
          "The server running this bot stopped unexpectedly."
        );
      }
    }
  }

  // Clean up instances whose row vanished, and any that finished on their own.
  for (const [id, instance] of running) {
    if (!seen.has(id)) {
      await instance.stop();
      running.delete(id);
    } else if (instance.finished) {
      running.delete(id);
    }
  }
}

async function heartbeat(): Promise<void> {
  await Promise.all([...running.values()].map((b) => b.heartbeat()));
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} — stopping ${running.size} bot(s) cleanly.`);

  // Stop every bot and mark it stopped, so nothing is left showing "running"
  // with no process behind it. Open contracts still settle at Deriv; the user
  // sees them when the bot is next started.
  await Promise.allSettled([...running.values()].map((b) => b.stop()));
  process.exit(0);
}

async function main(): Promise<void> {
  console.log(`Tradezaki runner ${config.instanceId}`);
  console.log(`  supabase : ${config.supabaseUrl}`);
  console.log(`  app id   : ${config.derivAppId}`);
  console.log(`  max bots : ${config.maxBots}`);

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // An unhandled rejection in a trading process must not be swallowed; it means
  // a bot may be in an unknown state.
  process.on("unhandledRejection", (reason) => {
    console.error("unhandled rejection:", reason);
  });

  setInterval(() => void poll(), config.pollMs);
  setInterval(() => void heartbeat(), config.heartbeatMs);
  await poll();
}

void main();
