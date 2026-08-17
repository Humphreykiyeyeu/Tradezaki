import { DerivClient, createDirectUrlProvider } from "@tradezaki/core";

import { config } from "./config.js";
import { db } from "./db.js";
import { getUsableToken } from "./vault.js";

/**
 * Collects outcomes for contracts nobody is watching any more.
 *
 * A contract keeps running at Deriv whether or not a bot is attached to it. Bots
 * re-watch their own open trades when they start, which covers a restart — but
 * not the case that actually happens most: a bot that stops, or hits a limit,
 * while still holding a contract. Nothing restarts it, so nothing ever collects
 * the result, and the row sits at 'open' forever. One such row was found after a
 * single day of testing.
 *
 * That is not a cosmetic problem. Every profit total, win rate and drawdown is
 * computed over settled trades, so a permanently-open row is money that silently
 * never lands in any number the user sees.
 *
 * This sweeps them up: find stale open trades, open one connection per account,
 * re-subscribe, record what comes back, disconnect.
 */

/** Young trades are excluded — they are probably still legitimately running. */
const STALE_AFTER_MS = 5 * 60_000;

/** A safety valve. Deriv replays state on subscribe, so this should be quick. */
const PER_ACCOUNT_TIMEOUT_MS = 30_000;

interface OpenRow {
  contract_id: number;
  user_id: string;
  deriv_account_id: string;
}

export async function sweepSettlements(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data, error } = await db
    .from("trades")
    .select("contract_id, user_id, deriv_account_id")
    .eq("result", "open")
    .lt("opened_at", cutoff)
    .limit(500);

  if (error) {
    console.error("settlement sweep: could not read open trades:", error.message);
    return;
  }
  if (!data || data.length === 0) return;

  // One connection per account, not per contract. Ten stale trades on one
  // account is one socket, not ten.
  const byAccount = new Map<string, OpenRow[]>();
  for (const row of data as OpenRow[]) {
    const key = `${row.user_id}|${row.deriv_account_id}`;
    const list = byAccount.get(key) ?? [];
    list.push(row);
    byAccount.set(key, list);
  }

  console.log(
    `settlement sweep: ${data.length} unsettled trade(s) across ${byAccount.size} account(s)`
  );

  for (const rows of byAccount.values()) {
    await sweepAccount(rows).catch((err) => {
      // One unreachable account must not stop the others; the rest are still
      // recoverable and this runs again shortly.
      console.error("settlement sweep failed:", err instanceof Error ? err.message : err);
    });
  }
}

async function sweepAccount(rows: OpenRow[]): Promise<void> {
  const { user_id: userId, deriv_account_id: accountId } = rows[0];

  const token = await getUsableToken(userId);
  const client = new DerivClient(
    createDirectUrlProvider({ appId: config.derivAppId, accessToken: token, accountId })
  );

  await client.connect();

  const pending = new Set(rows.map((r) => Number(r.contract_id)));

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (pending.size > 0) {
        // Not an error worth shouting about: a contract can genuinely still be
        // running, and the next sweep will pick it up.
        console.log(`settlement sweep: ${pending.size} still open on ${accountId}`);
      }
      done();
    }, PER_ACCOUNT_TIMEOUT_MS);

    for (const contractId of pending) {
      const stop = client.watchContract(contractId, (c) => {
        if (!c.isSold) return;

        void db
          .from("trades")
          .update({
            result: c.profit >= 0 ? "won" : "lost",
            profit: c.profit,
            settled_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("contract_id", contractId)
          .then(() => {
            console.log(
              `settlement sweep: ${contractId} settled ${c.profit >= 0 ? "won" : "lost"} ${c.profit}`
            );
          });

        stop();
        pending.delete(contractId);
        if (pending.size === 0) done();
      });
    }
  });

  client.disconnect();
}
