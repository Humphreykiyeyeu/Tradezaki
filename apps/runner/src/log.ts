import { db } from "./db.js";

/**
 * Bot event log.
 *
 * These lines are read by a user trying to work out why their bot stopped
 * overnight, so they are written as plain sentences rather than diagnostics.
 * Nothing sensitive goes in here — no tokens, no raw API payloads.
 */
export async function logEvent(
  userId: string,
  botId: string,
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  const { error } = await db.from("bot_events").insert({
    user_id: userId,
    bot_id: botId,
    level,
    message,
    context: context ?? null,
  });
  // A failed log write must never take down a running bot.
  if (error) console.error(`[${botId}] could not write event: ${error.message}`);
}

export function line(botId: string, msg: string): void {
  console.log(`${new Date().toISOString()} [${botId.slice(0, 8)}] ${msg}`);
}
