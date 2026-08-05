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

**This account is on Deriv's current Options API, not the legacy one.** That
single fact explains every failure up to now:

```
GET /trading/v1/options/legacy/migration-status  →  {"status":"complete"}
```

The legacy `wss://ws.derivws.com/websockets/v3?app_id=NNNN` endpoint rejects this
account entirely. **There is no numeric App ID to find** — that value doesn't
exist for migrated accounts.

| | Legacy v3 | Current Options API |
|---|---|---|
| App ID | numeric, `?app_id=1089` | **string**, `Deriv-App-ID:` header |
| Token | `a1-…` via `{authorize:…}` | `pat_…` / OAuth, `Authorization: Bearer` |
| Connect | open socket, then authorize | REST → one-time-password URL → already authorised |
| Host | `ws.derivws.com` | `api.derivws.com` |
| Symbol field | `symbol` | `underlying_symbol` |
| Message envelope | `{msg_type, echo_req, req_id}` | **identical** |

Your app ID is `340ceNJpp5bdPFZLJxcew` and it is correct as-is.

### The connection flow

```
POST /trading/v1/options/accounts/{accountId}/otp
     Deriv-App-ID: 340ceNJpp5bdPFZLJxcew
     Authorization: Bearer <token>
  ↓ { "url": "wss://api.derivws.com/trading/v1/options/ws/demo?otp=…" }
open that URL — no authorize message needed
```

The OTP is **single-use and expires after 120 seconds**. The app exploits this:
`/api/deriv/ws-url` runs server-side and hands the browser only the short-lived
URL, so the long-lived token never reaches client JavaScript. Reconnecting
fetches a fresh OTP rather than reusing the URL.

### Endpoints in use

| Endpoint | Purpose |
|---|---|
| `GET /trading/v1/options/accounts` | list accounts + balances |
| `POST /trading/v1/options/accounts/{id}/otp` | authenticated WebSocket URL |
| `GET /applications/v1/markup-statistics` | revenue reporting |
| `GET /trading/v1/options/legacy/migration-status` | which API an account is on |

### Local config

```bash
NEXT_PUBLIC_APP_URL=https://tradezaki.vercel.app
```

### Redirect URIs

Deriv rejects any `redirect_uri` that isn't an exact match for one registered on
the app. Two are registered:

| Registered URL | Usable? |
|---|---|
| `https://tradezaki.vercel.app/callback` | ✅ has the `/callback` path |
| `https://tradezaki-humphreykiyeyeus-projects.vercel.app` | ❌ bare origin, no `/callback` |

The second can never receive the redirect. `NEXT_PUBLIC_APP_URL` defaults to the
first. To use the other domain, add its `/callback` variant in the dashboard.

### ⚠️ Turn off the Payments scope

The app requests **Trade, Account management, Payments and Application insights**.
`Payments` grants payment-agent deposit and withdrawal access — a token leak would
let an attacker move money, not just place trades. Nothing here uses it. Untick it.

## Markup — how the app makes money

A percentage of contract **payout** (not stake), earned on every contract whether
it wins or loses.

**The app's markup is confirmed live** — `GET /applications/v1/markup-statistics`
reports $0.21 across 13 contracts under app ID `340ceNJpp5bdPFZLJxcew`. But those
trades came from **Deriv's App Builder template**, not from this codebase.

So the app-level configuration is proven; this client's buy path is not. No trade
has yet been placed through `DerivClient`. That gap matters because the failure is
silent — a buy that succeeds but produces an unmarked contract looks exactly like
one that earns.

**To close it:** place one trade through the app, then run
`node scripts/deriv-status.mjs` and check that contract count *and* revenue both
increase.

- **Maximum is 3%**, and the app is already set to it in the dashboard.
- **It is not a request parameter.** Sending `app_markup_percentage` on
  `proposal` fails with `Properties not allowed` on both API versions. Deriv
  applies the app's registered rate automatically — which also means a bug can
  never accidentally drop it.
- Read earnings from `GET /applications/v1/markup-statistics`.

## What's wired up in this first pass

- Landing page with the Risk Guardian pitch
- Deriv OAuth login flow (PKCE)
- Live balance via WebSocket subscription
- A minimal Rise/Fall trade ticket on Volatility 75 (`R_75`)
- Markup at 3%, applied by Deriv automatically (unverified from this code — see above)
- Contract settlement via `proposal_open_contract` — trades now record their
  real win/loss and profit instead of sitting at `"open"` forever, which is what
  makes Risk Guardian able to fire at all
- Risk Guardian enforcement before every trade (daily loss limit +
  consecutive-loss cooldown), configured directly in `dashboard/page.tsx`
  for now
- Trades logged to `localStorage` (swap for Supabase next — see below)

See [PLAN.md](PLAN.md) for the full product plan, revenue model and roadmap.

## Known placeholders to replace next

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
