#!/usr/bin/env node
/**
 * Finds the numeric App ID that the Deriv WebSocket needs.
 *
 * The developers.deriv.com dashboard only shows a *string* App ID
 * (e.g. "340ceNJpp5bdPFZLJxcew"). The WebSocket API rejects that — it wants a
 * number. This asks Deriv's own `app_list` API what IDs your apps really have.
 *
 * First: Deriv dashboard → API tokens → create a token with the "Admin" scope.
 * (app_list needs Admin; read-only scopes return nothing.)
 *
 * Then EITHER — easiest, no terminal knowledge needed:
 *   Create a file called `.deriv-token` in the project root, paste the token
 *   into it, save. It's gitignored, so it can't be committed by accident.
 *   Delete it when you're done.
 *
 * OR — if you'd rather not have it touch disk:
 *   read -s DERIV_API_TOKEN && export DERIV_API_TOKEN
 *   node scripts/find-app-id.mjs
 *
 * Either way the token stays on your machine. Share only the printed table.
 */

import { readFileSync } from "node:fs";

function loadToken() {
  if (process.env.DERIV_API_TOKEN) return process.env.DERIV_API_TOKEN.trim();
  try {
    // Resolved relative to the project root, not wherever you ran this from.
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
      "Admin-scoped API token into it (Deriv dashboard → API tokens).\n" +
      "It's gitignored, so it won't be committed.\n"
  );
  process.exit(1);
}

// 1089 is Deriv's public test app_id — used only to open the socket so we can
// ask the question. It has nothing to do with the answer.
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

const timeout = setTimeout(() => {
  console.error("Timed out waiting for Deriv.");
  process.exit(1);
}, 20000);

ws.onopen = () => ws.send(JSON.stringify({ authorize: TOKEN }));

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.error) {
    console.error(`\nDeriv returned an error: ${msg.error.code} — ${msg.error.message}`);
    if (msg.error.code === "PermissionDenied") {
      console.error("The token likely lacks the Admin scope. Recreate it with Admin ticked.");
    }
    clearTimeout(timeout);
    process.exit(1);
  }

  if (msg.msg_type === "authorize") {
    ws.send(JSON.stringify({ app_list: 1 }));
    return;
  }

  if (msg.msg_type === "app_list") {
    const apps = msg.app_list ?? [];
    clearTimeout(timeout);

    if (apps.length === 0) {
      console.log("\nDeriv reports no registered apps for this token.");
      process.exit(0);
    }

    console.log("\nApps Deriv has registered for you:\n");
    for (const app of apps) {
      console.log(`  ${app.name}`);
      console.log(`    app_id  : ${app.app_id}   ${typeof app.app_id === "number" ? "← use this for the WebSocket" : ""}`);
      console.log(`    markup  : ${app.app_markup_percentage ?? 0}%`);
      console.log(`    redirect: ${app.redirect_uri || "(none)"}`);
      console.log(`    scopes  : ${(app.scopes ?? []).join(", ") || "(none)"}`);
      console.log("");
    }

    console.log("Put the numeric app_id in apps/web/.env.local as:");
    console.log("  NEXT_PUBLIC_DERIV_WS_APP_ID=<that number>\n");
    ws.close();
    process.exit(0);
  }
};

ws.onerror = () => {
  console.error("WebSocket connection failed.");
  clearTimeout(timeout);
  process.exit(1);
};
