#!/usr/bin/env node
/**
 * Preflight for cloud bots.
 *
 * Every failure this checks for is one that otherwise surfaces late and
 * misleadingly: a bot sits in `starting`, flips to `error`, and the message
 * blames decryption when the real cause was two environment files disagreeing.
 * Checking here means the answer arrives before a user has trusted a bot with
 * money.
 *
 * Reads the same files the app and runner read, and asks the deployment what it
 * holds. It never prints a secret — only whether one is present, and whether
 * two of them match.
 *
 *   node scripts/check-cloud.mjs
 *   node scripts/check-cloud.mjs https://my-deployment.vercel.app
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RESET = "\x1b[0m";
const paint = (c, s) => `${c}${s}${RESET}`;
const red = (s) => paint("\x1b[31m", s);
const green = (s) => paint("\x1b[32m", s);
const yellow = (s) => paint("\x1b[33m", s);
const dim = (s) => paint("\x1b[2m", s);

let failures = 0;
let warnings = 0;

const ok = (msg) => console.log(`  ${green("ok")}   ${msg}`);
const bad = (msg, fix) => {
  failures++;
  console.log(`  ${red("FAIL")} ${msg}`);
  if (fix) console.log(`       ${dim(fix)}`);
};
const warn = (msg, fix) => {
  warnings++;
  console.log(`  ${yellow("warn")} ${msg}`);
  if (fix) console.log(`       ${dim(fix)}`);
};

/** Minimal .env reader — no dependency, and it must not evaluate anything. */
function readEnv(path) {
  let text;
  try {
    text = readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const isPlaceholder = (v) => !v || /^PASTE_/.test(v);

/** Identifies a secret well enough to compare two of them, without exposing it. */
const fingerprint = (v) => createHash("sha256").update(v).digest("hex").slice(0, 12);

/** True if a decode would throw or produce something that isn't a 32-byte key. */
const usableKey = (raw) => {
  try {
    return decodeKey(raw).length === 32;
  } catch {
    return false;
  }
};

function decodeKey(raw) {
  const v = raw.trim();
  return /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
}

/**
 * Fingerprints the key material rather than the string encoding it.
 *
 * Comparing the strings is the obvious thing and it is wrong: a key pasted with
 * a trailing space encodes to the identical 32 bytes, so string comparison
 * reports a mismatch where encryption would have worked. What must agree is
 * what AES is handed.
 */
const keyFingerprint = (raw) => fingerprint(decodeKey(raw));

console.log("\nTradezaki cloud preflight\n");

// ------------------------------------------------------------------- files
console.log("Configuration files");

const web = readEnv("apps/web/.env.local");
const runner = readEnv("apps/runner/.env");

if (!web) bad("apps/web/.env.local is missing.");
else ok("apps/web/.env.local");

if (!runner) bad("apps/runner/.env is missing.", "Copy apps/runner/.env.example to apps/runner/.env");
else ok("apps/runner/.env");

if (!web || !runner) {
  console.log(`\n${red("Cannot continue without both files.")}\n`);
  process.exit(1);
}

// ------------------------------------------------------------------ secrets
console.log("\nSecrets");

const required = [
  ["apps/web/.env.local", web, "NEXT_PUBLIC_SUPABASE_URL"],
  ["apps/web/.env.local", web, "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  ["apps/web/.env.local", web, "SUPABASE_SERVICE_ROLE_KEY"],
  ["apps/web/.env.local", web, "DERIV_TOKEN_KEY"],
  ["apps/runner/.env", runner, "SUPABASE_URL"],
  ["apps/runner/.env", runner, "SUPABASE_SERVICE_ROLE_KEY"],
  ["apps/runner/.env", runner, "DERIV_TOKEN_KEY"],
];

for (const [file, env, name] of required) {
  if (isPlaceholder(env[name])) bad(`${name} is not filled in (${file}).`);
  else ok(`${name} set ${dim(`(${file})`)}`);
}

// The mismatch this exists to catch. The web app seals; the runner opens.
if (
  !isPlaceholder(web.DERIV_TOKEN_KEY) &&
  !isPlaceholder(runner.DERIV_TOKEN_KEY) &&
  usableKey(web.DERIV_TOKEN_KEY) &&
  usableKey(runner.DERIV_TOKEN_KEY)
) {
  if (keyFingerprint(web.DERIV_TOKEN_KEY) === keyFingerprint(runner.DERIV_TOKEN_KEY)) {
    ok(
      `DERIV_TOKEN_KEY matches across both files ${dim(`(#${keyFingerprint(web.DERIV_TOKEN_KEY)})`)}`
    );
  } else {
    bad(
      "DERIV_TOKEN_KEY differs between the web app and the runner.",
      "The runner cannot decrypt what the web app sealed. Make them identical."
    );
  }
}

for (const [file, env] of [["apps/web/.env.local", web], ["apps/runner/.env", runner]]) {
  const raw = env.DERIV_TOKEN_KEY;
  if (isPlaceholder(raw)) continue;
  let len;
  try {
    len = decodeKey(raw).length;
  } catch {
    bad(`DERIV_TOKEN_KEY in ${file} is not valid base64 or hex.`);
    continue;
  }
  if (len !== 32) {
    bad(
      `DERIV_TOKEN_KEY in ${file} decodes to ${len} bytes, not 32.`,
      "Generate one with: openssl rand -base64 32"
    );
  }
}

if (
  !isPlaceholder(web.SUPABASE_SERVICE_ROLE_KEY) &&
  !isPlaceholder(runner.SUPABASE_SERVICE_ROLE_KEY) &&
  web.SUPABASE_SERVICE_ROLE_KEY !== runner.SUPABASE_SERVICE_ROLE_KEY
) {
  warn("The web app and runner use different Supabase secret keys.");
}

if (
  !isPlaceholder(web.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
  web.NEXT_PUBLIC_SUPABASE_ANON_KEY === web.SUPABASE_SERVICE_ROLE_KEY
) {
  bad(
    "The publishable key and the secret key are the same value.",
    "The secret key would be shipped to every visitor. Take the publishable key from the dashboard instead."
  );
}

if (failures > 0) {
  console.log(`\n${red(`${failures} problem(s) — fix these before checking anything else.`)}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- deployment
/**
 * The third copy of the configuration.
 *
 * Everything above reads files on this machine. But OAuth cannot land on
 * localhost — Deriv rejects it as a redirect — so the app users actually log in
 * through is the deployed one, and *its* environment is what seals the tokens
 * this runner has to open. A mismatch there is invisible from here: the login
 * succeeds, the vault write fails silently, and the bot dies claiming there are
 * no credentials.
 */
console.log("\nDeployment");

const deployment = (process.argv[2] ?? process.env.DEPLOYMENT_URL ?? "https://tradezaki.vercel.app")
  .replace(/\/$/, "");

console.log(`  ${dim(deployment)}`);

let health = null;
try {
  const res = await fetch(`${deployment}/api/health/cloud`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) {
    warn(
      "The deployment has no /api/health/cloud endpoint.",
      "It is running a build from before this check existed. Redeploy, then run this again."
    );
  } else if (!res.ok) {
    warn(`The deployment answered ${res.status}.`);
  } else {
    health = await res.json();
  }
} catch (e) {
  warn(`Could not reach the deployment: ${e.message}`, "Skipping — local configuration was checked above.");
}

if (health) {
  // The one that silently breaks every cloud bot.
  const localKey = keyFingerprint(web.DERIV_TOKEN_KEY);
  if (!health.derivTokenKey?.set) {
    bad(
      "The deployment has no DERIV_TOKEN_KEY.",
      `Set it to the value in apps/web/.env.local (#${localKey}). Without it, logging in stores no credentials and every cloud bot fails.`
    );
  } else if (health.derivTokenKey.invalid) {
    bad(
      `The deployment's DERIV_TOKEN_KEY decodes to ${health.derivTokenKey.bytes} bytes, not 32.`,
      "It was probably truncated on paste. Set it again from apps/web/.env.local."
    );
  } else if (health.derivTokenKey.fingerprint !== localKey) {
    bad(
      `The deployment seals tokens with a different DERIV_TOKEN_KEY (#${health.derivTokenKey.fingerprint} vs #${localKey}).`,
      "The runner cannot open what it seals. Update the deployment's environment and redeploy."
    );
  } else {
    ok(`DERIV_TOKEN_KEY matches the deployment ${dim(`(#${localKey})`)}`);
  }

  // Same symptom, different cause: right key, wrong database.
  const localUrl = runner.SUPABASE_URL.replace(/\/$/, "");
  const deployedUrl = (health.supabaseUrl ?? "").replace(/\/$/, "");
  if (!deployedUrl) {
    bad("The deployment has no Supabase URL configured.");
  } else if (deployedUrl !== localUrl) {
    bad(
      "The deployment points at a different Supabase project.",
      `It writes bots to ${deployedUrl}; this runner polls ${localUrl}. Nothing will ever pick them up.`
    );
  } else {
    ok("Supabase project matches the deployment");
  }

  if (!health.supabaseServiceKey?.set) {
    bad(
      "The deployment has no SUPABASE_SERVICE_ROLE_KEY.",
      "Login cannot create accounts without it."
    );
  } else if (health.supabaseServiceKey.fingerprint !== fingerprint(runner.SUPABASE_SERVICE_ROLE_KEY)) {
    warn("The deployment uses a different Supabase secret key than the runner.");
  } else {
    ok("Supabase secret key matches the deployment");
  }

  if (!health.supabaseAnonKey?.set) {
    bad(
      "The deployment has no NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      "The browser cannot sign in, so the cloud panel stays locked."
    );
  } else {
    ok("Publishable key present on the deployment");
  }
}

// ------------------------------------------------------------------ database
console.log("\nDatabase");

const url = runner.SUPABASE_URL.replace(/\/$/, "");
const key = runner.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = [
  ["profiles", "0001_init.sql"],
  ["deriv_accounts", "0001_init.sql"],
  ["risk_configs", "0001_init.sql"],
  ["trades", "0001_init.sql"],
  ["strategies", "0001_init.sql"],
  ["bots", "0001_init.sql"],
  ["bot_events", "0001_init.sql"],
  ["deriv_credentials", "0002_credentials.sql"],
];

const missing = new Set();

for (const [table, migration] of TABLES) {
  let res;
  try {
    res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    bad(`Could not reach Supabase: ${e.message}`);
    process.exit(1);
  }

  if (res.status === 200) {
    ok(`${table}`);
  } else if (res.status === 401 || res.status === 403) {
    bad(
      `Supabase rejected the secret key (${res.status}).`,
      "Check SUPABASE_SERVICE_ROLE_KEY is the Secret key (sb_secret_...), not the publishable one."
    );
    process.exit(1);
  } else {
    missing.add(migration);
    bad(`${table} does not exist.`, `Apply supabase/migrations/${migration}`);
  }
}

if (missing.size > 0) {
  console.log(
    `\n${yellow("Apply the missing migration(s)")} in the Supabase dashboard → SQL Editor:`
  );
  for (const m of [...missing].sort()) console.log(`  supabase/migrations/${m}`);
}

// ------------------------------------------------------------------- summary
console.log("");
if (failures === 0 && warnings === 0) {
  console.log(green("Everything checks out. The runner can start.\n"));
} else if (failures === 0) {
  console.log(yellow(`${warnings} warning(s), nothing blocking.\n`));
} else {
  console.log(red(`${failures} problem(s) to fix.\n`));
}

process.exit(failures > 0 ? 1 : 0);
