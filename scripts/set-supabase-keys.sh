#!/usr/bin/env bash
#
# Prompts for the two Supabase keys and writes them into both env files.
#
# The secret key is read without echoing and never appears in your shell
# history, in a log, or on screen. The web app and the runner each need their
# own copy, and typing it twice by hand is how they end up different — so this
# writes both from one entry.
#
#   scripts/set-supabase-keys.sh
#
# Get the keys from:
#   https://supabase.com/dashboard/project/psedpaxybuikruplvqwe/settings/api-keys
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$REPO/apps/web/.env.local"
RUNNER="$REPO/apps/runner/.env"

[ -f "$WEB" ] || { echo "Missing $WEB"; exit 1; }
[ -f "$RUNNER" ] || { echo "Missing $RUNNER"; exit 1; }

echo
echo "Supabase keys → https://supabase.com/dashboard/project/psedpaxybuikruplvqwe/settings/api-keys"
echo

# Public by design: row-level security separates users, not the secrecy of this
# string. Echoing it is fine and lets you see a truncated paste.
read -r -p "Publishable key (sb_publishable_...): " PUBLISHABLE
[ -n "$PUBLISHABLE" ] || { echo "Nothing entered."; exit 1; }

# Bypasses RLS entirely, so it is never echoed.
read -r -s -p "Secret key      (sb_secret_...): " SECRET
echo
[ -n "$SECRET" ] || { echo "Nothing entered."; exit 1; }

if [ "$PUBLISHABLE" = "$SECRET" ]; then
  echo "Those are the same value — one of them is the wrong key. Nothing written."
  exit 1
fi

# Node does the substitution: keys can contain characters that sed would treat
# as syntax, and a mangled key fails in a way that looks like a permissions bug.
PUBLISHABLE="$PUBLISHABLE" SECRET="$SECRET" WEB="$WEB" RUNNER="$RUNNER" node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const pub = process.env.PUBLISHABLE, sec = process.env.SECRET;

function set(file, key, value) {
  const text = readFileSync(file, "utf8");
  const line = new RegExp(`^${key}=.*$`, "m");
  if (!line.test(text)) throw new Error(`${key} not found in ${file}`);
  writeFileSync(file, text.replace(line, `${key}=${value}`));
}

set(process.env.WEB, "NEXT_PUBLIC_SUPABASE_ANON_KEY", pub);
set(process.env.WEB, "SUPABASE_SERVICE_ROLE_KEY", sec);
set(process.env.RUNNER, "SUPABASE_SERVICE_ROLE_KEY", sec);
console.log("Written to both files.");
'

echo
exec node "$REPO/scripts/check-cloud.mjs"
