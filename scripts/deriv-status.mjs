#!/usr/bin/env node
/**
 * Diagnostics against Deriv's current Options API: which API your account is on,
 * what accounts exist, and how much markup you've earned.
 *
 * Setup: Deriv dashboard → API tokens → create one with Trade + Application
 * insights. Put it in a file named `.deriv-token` in the project root (it's
 * gitignored), or set DERIV_API_TOKEN.
 *
 *   node scripts/deriv-status.mjs
 *
 * Delete .deriv-token when you're done — it can place trades.
 */

import { readFileSync } from "node:fs";

const APP_ID = "340ceNJpp5bdPFZLJxcew";
const BASE = "https://api.derivws.com";

function loadToken() {
  if (process.env.DERIV_API_TOKEN) return process.env.DERIV_API_TOKEN.trim();
  try {
    return readFileSync(new URL("../.deriv-token", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

const TOKEN = loadToken();

if (!TOKEN) {
  console.error(
    "\nNo Deriv API token found.\n\n" +
      "Create a file named  .deriv-token  in the project root and paste an\n" +
      "API token into it (Deriv dashboard → API tokens). It's gitignored.\n"
  );
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Deriv-App-ID": APP_ID };

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

try {
  const migration = await get("/trading/v1/options/legacy/migration-status");
  console.log(`\nAPI migration status: ${migration.status}`);
  if (migration.status === "complete") {
    console.log("  → on the current Options API. The legacy v3 WebSocket will reject this account.");
  }

  const accounts = await get("/trading/v1/options/accounts");
  console.log("\nAccounts:");
  for (const a of accounts.data ?? []) {
    const kind = a.account_type === "demo" ? "DEMO" : "REAL";
    console.log(`  ${a.account_id.padEnd(14)} ${kind.padEnd(5)} ${a.balance} ${a.currency}  (${a.status})`);
  }

  const from = isoDaysAgo(30);
  const to = isoDaysAgo(0);
  const stats = await get(
    `/applications/v1/markup-statistics?date_from=${from}&date_to=${to}`
  );
  const d = stats.data ?? {};
  console.log(`\nMarkup earned, ${from} → ${to}:`);
  console.log(`  revenue   : $${(d.total_app_markup_usd ?? 0).toFixed(2)}`);
  console.log(`  volume    : $${(d.total_volume_usd ?? 0).toFixed(2)}`);
  console.log(`  contracts : ${d.total_contract_count ?? 0}`);
  console.log(`  clients   : ${d.total_client_count ?? 0}`);

  const volume = d.total_volume_usd ?? 0;
  if (volume > 0) {
    const rate = ((d.total_app_markup_usd ?? 0) / volume) * 100;
    console.log(`  effective : ${rate.toFixed(2)}% of volume (app is registered at 3% of payout)`);
  }
  console.log("");
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
