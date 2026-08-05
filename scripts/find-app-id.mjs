#!/usr/bin/env node
/**
 * Finds the numeric App ID that the Deriv WebSocket needs.
 *
 * The developers.deriv.com dashboard only shows a *string* App ID
 * (e.g. "340ceNJpp5bdPFZLJxcew"). The WebSocket API rejects that — it wants a
 * number. This asks Deriv's own `app_list` API what IDs your apps really have.
 *
 * Usage:
 *   1. Deriv dashboard → API tokens → create a token with the "Admin" scope
 *      (needed for app_list; read-only scopes won't return apps).
 *   2. Run it WITHOUT putting the token in your shell history:
 *
 *        read -s DERIV_API_TOKEN && export DERIV_API_TOKEN
 *        node scripts/find-app-id.mjs
 *
 * The token stays on your machine. Nothing is written to disk. Paste only the
 * printed table if you want help interpreting it — never the token itself.
 */

const TOKEN = process.env.DERIV_API_TOKEN;

if (!TOKEN) {
  console.error("Missing DERIV_API_TOKEN. See the usage notes at the top of this file.");
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
