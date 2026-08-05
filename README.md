# Tradezaki

A Deriv companion app for options traders, built around one differentiator
competitors don't have: a Risk Guardian that enforces daily loss limits and
cooldowns automatically, plus a trade journal that fills itself in.

## Structure

```
tradezaki/
  packages/core/     Shared TypeScript package: Deriv WebSocket client,
                      Risk Guardian rules, shared types. Framework-free —
                      will be imported by the React Native app later too.
  apps/web/           Next.js app (App Router, Tailwind). Landing page,
                      Deriv OAuth callback, and the trading dashboard.
```

## Setup (run this locally — needs internet access)

Uses plain npm workspaces (not pnpm) — pnpm currently has a registry-fetch
bug on Vercel's build servers (`ERR_INVALID_THIS`), so npm is the safer
choice here for now.

1. From the repo root: `npm install`
2. `cd apps/web && npm run dev` → opens on http://localhost:3000

## Deriv app configuration — read this before testing login

Deriv's OAuth has moved to a proper OAuth2 + PKCE flow at `auth.deriv.com`,
which is stricter than the flow this project originally shipped with:

- **HTTPS-only redirect URIs.** `http://localhost:3000/callback` will
  always be rejected — this is what "localhost URLs are not allowed in
  production" means. There is no local-dev exception.
- **Every redirect goes through `state` + `code_challenge`**, and Deriv
  returns a `code` (not a token) to `/callback`, which is then exchanged
  for an `access_token` server-side via `/api/deriv/token`.

### To test locally without hitting the HTTPS wall

Local dev needs an HTTPS URL pointing at your machine. Use a tunnel:

```bash
npx ngrok http 3000
```

Take the `https://xxxx.ngrok-free.app` URL it gives you and:
1. Add `https://xxxx.ngrok-free.app/callback` as a Redirect URL in the
   [Deriv API dashboard](https://api.deriv.com/dashboard)
2. Set `NEXT_PUBLIC_APP_URL=https://xxxx.ngrok-free.app` in `.env.local`
3. Open the app through the ngrok URL, not `localhost:3000`, when testing login

ngrok URLs change every time you restart it (on the free tier), so you'll
re-do steps 1–2 each session — annoying but only affects local testing.
The simpler option day-to-day: just test against your deployed Vercel URL,
which is already HTTPS and already registered.

### One assumption to verify

Deriv's docs say to append `&app_id=YOUR_LEGACY_APP_ID` alongside
`client_id` when your app was registered on the classic dashboard (which
yours was) — `derivConfig.ts` currently sends the same ID for both. If
login still doesn't redirect back after the changes above, this is the
first thing to check against your dashboard/Deriv support, since it's the
one detail their docs don't fully spell out for apps registered before
this migration.

### Scopes

Set to `trade account_manage` in `lib/derivConfig.ts` — adjust if your
dashboard shows different scope names available for this app.

The OAuth flow now: `/` → generates a PKCE verifier/challenge, stores the
verifier in `sessionStorage` → redirects to `auth.deriv.com` → Deriv
redirects to `/callback?code=...&state=...` → callback posts the code to
`/api/deriv/token` (server-side exchange) → access token stored → redirects
to `/dashboard`.

## What's wired up in this first pass

- Landing page with the Risk Guardian pitch
- Deriv OAuth login flow
- Live balance via WebSocket subscription
- A minimal Rise/Fall trade ticket on Volatility 75 (`R_75`)
- Risk Guardian enforcement before every trade (daily loss limit +
  consecutive-loss cooldown), configured directly in `dashboard/page.tsx`
  for now
- Trades logged to `localStorage` (swap for Supabase next — see below)

## Known placeholders to replace next

- **Trade outcomes**: trades are logged as `"open"` and never settled.
  Subscribe to `proposal_open_contract` in `derivClient.ts` to get the
  real win/loss and profit, and update the log entry.
- **Storage**: `localStorage` works for a single-device MVP. Move to
  Supabase (Postgres) so the journal survives across devices and so the
  mobile app can read the same data — this was flagged as Phase 2 in the
  plan.
- **Token security**: tokens currently sit in `localStorage`, readable by
  any script on the page. Fine to develop against; before real users
  connect real accounts, move the token exchange behind a server route
  using an httpOnly cookie.
- **Risk Guardian config**: currently hardcoded in the dashboard. Phase 3
  is a Settings page that writes this to Supabase per user.

## Deploying

This is already set up for Vercel — push to your connected repo and it
builds `apps/web` automatically. If Vercel doesn't auto-detect the
monorepo layout, set the project's **Root Directory** to `apps/web` in
Vercel's project settings, and its **Install Command** to
`cd ../.. && npm install`.
