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

**Deriv needs two different identifiers, and they are not interchangeable.**
Confusing them is why login failed for so long:

| | What it is | Where it's used | Status |
|---|---|---|---|
| **OAuth2 client_id** | `340ceNJpp5bdPFZLJxcew` | `auth.deriv.com` login | ✅ registered |
| **WebSocket app_id** | a **number**, e.g. `1089` | every `ws.derivws.com` connection; markup is attributed to it | ⚠️ **not yet found** |

### The numeric App ID problem

The new dashboard at `developers.deriv.com/dashboard` only displays a *string*
App ID. The classic WebSocket API rejects all of them — verified against the live
endpoint:

```
1089                    → pong      ✅
340ceNJpp5bdPFZLJxcew   → rejected  ❌
33Xn6UW6wxtir6DmpOVsV   → rejected  ❌
33XmUqwFqikftoumiU276   → rejected  ❌
```

So the dashboard is not showing the value the WebSocket wants. To ask Deriv
directly what your apps' real IDs are:

```bash
read -s DERIV_API_TOKEN && export DERIV_API_TOKEN   # Admin-scoped token
node scripts/find-app-id.mjs
```

That calls Deriv's `app_list` API and prints the true `app_id` for every app on
the account. If it comes back as a string there too, the numeric ID genuinely
doesn't exist for apps registered on the new dashboard, and that's a question for
Deriv support.

Set whatever it returns in `.env.local`:

```bash
NEXT_PUBLIC_DERIV_WS_APP_ID=<your numeric App ID>
NEXT_PUBLIC_APP_URL=https://tradezaki.vercel.app
# NEXT_PUBLIC_DERIV_MARKUP_PERCENTAGE is intentionally unset — see Markup below
```

Until you set it, the app falls back to Deriv's public test ID `1089`. That
connects and trades work, but **it isn't your app, so you earn no markup** — the
dashboard shows a warning while it's active.

### The login flow

```
/  → generate PKCE verifier + state (sessionStorage)
   → auth.deriv.com/oauth2/auth       client_id, scope=openid, code_challenge
   → /callback?code=…&state=…         state is verified before use
   → POST /api/deriv/token            server-side, two steps:
        1. code + verifier      → access_token
        2. access_token         → POST oauth.deriv.com/oauth2/legacy/tokens
                                  → { acct1, token1, cur1, … }
   → /dashboard                       token1 authorizes the WebSocket
```

Step 2 is the one that's easy to miss: the `access_token` from `auth.deriv.com`
is an **identity** token and cannot place trades. Only the legacy per-account
tokens work with the WebSocket `authorize` call.

**Scopes** are `openid` only. `auth.deriv.com` advertises just
`openid`/`offline`/`offline_access` in its discovery document — `trade` and
`account_manage` are not valid there. Trading permission comes from how the app
is registered in the dashboard.

### Redirect URIs

Deriv rejects any `redirect_uri` that isn't an exact match for one registered on
the app. Two are currently registered:

| Registered URL | Usable? |
|---|---|
| `https://tradezaki.vercel.app/callback` | ✅ has the `/callback` path |
| `https://tradezaki-humphreykiyeyeus-projects.vercel.app` | ❌ bare origin, no `/callback` |

The second can never receive the redirect, which is why login failed against that
domain. `NEXT_PUBLIC_APP_URL` now defaults to `https://tradezaki.vercel.app`. To
use the other domain, add its `/callback` variant in the dashboard.

Whether `http://localhost:3000/callback` is accepted is **unverified** — try
registering it before assuming you need an HTTPS tunnel. If it's rejected,
`npx ngrok http 3000` gives you an HTTPS origin; register that and set
`NEXT_PUBLIC_APP_URL` to match.

### ⚠️ Turn off the Payments scope

The app currently requests **Trade, Account management, Payments and Application
insights**. `Payments` grants access to payment agent deposit and withdrawal
operations — a token leak would then let an attacker move money, not just place
trades. Nothing in this app uses it. Untick it in the dashboard; `Trade` is what
you actually need.

## Markup — how the app makes money

Markup is a percentage of contract **payout** (not stake), earned on every
contract whether it wins or loses.

**The Tradezaki app is already set to 3% — the maximum — in the dashboard.** That
app-level setting applies to every contract automatically, so the code sends no
per-buy markup by default. `NEXT_PUBLIC_DERIV_MARKUP_PERCENTAGE` exists only to
charge *less* than the app default on a specific trade (e.g. a discounted tier);
it cannot raise the rate above what the app is registered for.

Verified against Deriv's schemas:

- **Maximum is 3%.**
- It is **rejected on the `proposal` call** — Deriv returns
  `Properties not allowed: app_markup_percentage`.
- Apply it either **app-wide** (dashboard, or the `app_update` API call —
  recommended) or **per-buy** via the `buy: 1` + `parameters` form.
  `DerivClient.buyContract` switches to the parameters form automatically when a
  markup is configured.
- `app_markup_details` reports what you've earned.

Because proposal prices exclude markup, the buy sends `price` with headroom
(`askPrice + markup% × payout`), or Deriv rejects it as underpriced.

## What's wired up in this first pass

- Landing page with the Risk Guardian pitch
- Deriv OAuth login flow
- Live balance via WebSocket subscription
- A minimal Rise/Fall trade ticket on Volatility 75 (`R_75`)
- Markup applied to every buy, capped at Deriv's 3% limit
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
