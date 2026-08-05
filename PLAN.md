# Tradezaki — Project Plan

Objective: a Deriv-API app that fills a real gap in the Deriv ecosystem, so people
choose to trade through it, and that earns revenue via API markup on every contract.

---

## 1. Where the project actually stands

The monorepo skeleton is sound: `packages/core` (framework-free Deriv WS client,
Risk Guardian rules, types) + `apps/web` (Next.js App Router, Tailwind). That
split is worth keeping — the core package will run unchanged in Node on a server,
which the plan below depends on.

### The account is on a different API than the code targets

The real cause, and it isn't a configuration mistake:

```
GET /trading/v1/options/legacy/migration-status  →  {"status":"complete"}
```

**This Deriv account has been migrated to the current Options API.** The legacy
`wss://ws.derivws.com/websockets/v3?app_id=NNNN` endpoint that the whole
codebase was written against rejects it outright — every app ID, and the API
token too. There is no numeric App ID to find; that value doesn't exist for
migrated accounts. Hours were spent hunting for one.

**What actually changed:**

| | Legacy v3 | Current Options API |
|---|---|---|
| App ID | numeric, `?app_id=1089` | **string**, `Deriv-App-ID:` HTTP header |
| Token | `a1-…`, sent via `{authorize:…}` | `pat_…` / OAuth, `Authorization: Bearer` |
| Connect | open socket, then authorize | REST call → one-time-password URL → open socket, already authorised |
| Trading host | `ws.derivws.com` | `api.derivws.com` |
| Symbol field | `symbol` | `underlying_symbol` |
| Messages | `{msg_type, echo_req, req_id}` | **identical** |

The message envelope being unchanged is the lucky part: trading logic ported
across untouched. Only the connection and auth layer was rewritten.

**The connection flow now:**

```
POST /trading/v1/options/accounts/{accountId}/otp
     Deriv-App-ID: 340ceNJpp5bdPFZLJxcew
     Authorization: Bearer <token>
  ↓ { "url": "wss://api.derivws.com/trading/v1/options/ws/demo?otp=…" }
open that URL — no authorize message needed
```

The OTP is single-use and expires in 120 seconds. That's a security gain worth
keeping: the browser is handed a URL that's worthless within two minutes, while
the long-lived token never leaves the server. Reconnecting means fetching a new
OTP, not reusing the URL.

**Verified working against the live API:** account listing, balance, proposal
pricing, markup statistics, OTP issuance, WebSocket connect.

### Endpoints that matter

| Endpoint | Purpose |
|---|---|
| `GET /trading/v1/options/accounts` | list accounts + balances |
| `POST /trading/v1/options/accounts/{id}/otp` | get an authenticated WS URL |
| `GET /applications/v1/markup-statistics` | **revenue reporting** |
| `GET /trading/v1/options/legacy/migration-status` | which API an account is on |

### Trades never settle

Every trade was logged `result: "open"`, so Risk Guardian scored against
permanently-zero P&L and could never fire. Fixed via `proposal_open_contract`.

---

## 2. The revenue model, with real numbers

This has to come before the product decision, because it determines the product.

Markup is **a percentage of the contract payout, not the stake**. Deriv's own
worked example: stake $25.50, payout $50.00, 2% markup → client is debited
$26.50, and that extra $1.00 is yours. You earn it whether the trade wins or
loses.

**Verified mechanics** (from Deriv's live API and JSON schemas, not the prose
docs, which are inconsistent on this):

- **The cap is 3%.** Stated in both the `app_register` and `app_update` schemas:
  *"Markup to be added to contract prices (as a percentage of contract payout).
  Max markup: 3%."* The "up to 5% for a limited time" line in the marketing docs
  is not reflected anywhere in the API — treat 3% as the real number.
- **`app_markup_percentage` is rejected as a request parameter.** Confirmed live
  on both the legacy and current APIs: `InputValidationFailed: Properties not
  allowed`. It is not something the code sends.
- **Markup is configured on the app itself**, in the Deriv dashboard. Tradezaki
  is already set to 3% — the maximum. Deriv applies it to every contract bought
  under this app ID automatically, which means it cannot be accidentally omitted
  by a bug at a call site. Good property to have.
- **`GET /applications/v1/markup-statistics`** reports earnings, broken down by
  app, with contract count, client count and volume. This is the revenue
  dashboard's data source.

### Measured, not estimated

One real-money trade settled this precisely:

| | |
|---|---|
| Stake | $0.35 |
| Payout (~1.9×) | ~$0.665 |
| Markup earned | **$0.02** — i.e. 3.0% of payout, exactly as registered |
| **Revenue per dollar staked** | **~5.7%** |

The user *won* that trade and the markup was still earned — revenue does not
depend on users losing.

Earlier drafts of this plan modelled 2% markup and ~3.7% of stake. The real
figure is **~5.7% of stake**, roughly 54% higher. Projections below use the
measured number.

> **Markup revenue scales with contract count × stake size. It does not scale
> with user count.**

| User type | Contracts/day | Stake | Revenue/mo (20 active days) |
|---|---|---|---|
| Casual manual trader | 10 | $2 | **~$23** |
| Active manual trader | 60 | $5 | **~$342** |
| Bot user (modest) | 200 | $1 | **~$228** |
| Bot user (serious) | 500 | $5 | **~$2,850** |

One serious automation user is worth 100+ casual manual users. Any product
decision that doesn't push contract volume is, commercially, decoration.

**Demo trades earn nothing.** Verified: demo trades execute and move the balance
but never appear in markup statistics. Demo is for onboarding and trust, and it
costs you nothing to give away generously — but only real-money volume is
revenue.

**Two structural advantages worth understanding:** you never custody client
money (users trade their own Deriv accounts, Deriv does KYC and settlement), and
you get paid on losing trades too — your revenue doesn't depend on your users
winning. That makes this a viable solo business in a way most fintech isn't.

---

## 3. The problem with the current positioning

Risk Guardian's explicit promise is *"we stop you from trading."* Markup revenue
is *"we get paid when you trade."* As the headline product, those are in direct
opposition — the better Risk Guardian works, the less you earn.

It's a genuinely good feature and it should stay. But it can't be the growth
engine. It has to be repositioned as **the safety layer that makes something else
trustworthy** — and there's exactly one thing that needs it badly.

---

## 4. The gap

**Deriv's own bot builder (DBot) only runs while your browser tab is open.**

Close the tab, sleep the laptop, lose power, lose data connection, phone
screen-locks — the bot stops mid-strategy. For Deriv's core markets (Kenya,
Nigeria, South Africa, Southeast Asia, LatAm), where users are mobile-first and
power and connectivity are not guaranteed, this isn't a minor annoyance. It's the
defining complaint about DBot.

Deriv has not fixed it in years. It is a real gap, it is concrete, and a user can
understand the value in one sentence.

> ### Tradezaki: your Deriv bots, running in the cloud. 24/7. Phone off.
> Import the DBot strategy you already have. It runs on our servers, not your
> browser. Hard loss limits you set, enforced server-side. Start and stop it
> from your phone.

**Why this gap and not another:**

- **It maximises exactly the thing markup pays for.** A cloud bot generates
  hundreds of contracts a day, unattended. Nothing else you could build comes
  close on volume-per-user.
- **It justifies the markup honestly.** Trading through you costs ~3.7% of stake
  more than trading direct. For a manual Rise/Fall clicker that's a terrible
  deal and they'll figure it out. For 24/7 hosted execution they cannot get
  anywhere else, it's cheap — it's a hosting fee, and it's usage-priced.
- **It inherits a ready-made content ecosystem.** Thousands of free DBot `.xml`
  strategy files circulate on Telegram, YouTube and Deriv forums. Supporting
  **DBot XML import** means users arrive with strategies already in hand. You
  build zero content and inherit the entire community's library on day one. This
  is the distribution wedge, and it's the part most competitors would skip.
- **It makes Risk Guardian essential instead of contradictory.** An unattended
  bot with no kill-switch is genuinely frightening — that fear is the #1 reason
  people won't leave a bot running. Server-enforced daily loss limits are what
  make cloud execution sellable. And by preventing account wipeout, Risk Guardian
  *extends* how long a user keeps generating volume. On automation, safety and
  revenue point the same direction.

**Later, the volume multiplier:** a strategy marketplace where authors publish
bots with API-verified track records (you can prove real P&L from contract
history — no screenshots, no faking), followers subscribe, authors take a cut.
One strategy × N followers × hundreds of contracts each. That's Phase 4, and
it's where this stops being a side project.

---

## 5. Architecture

The current design cannot do any of this: a browser-tab WebSocket dies with the
tab, and Vercel serverless functions can't hold a WebSocket open for hours. Cloud
execution needs an always-on process.

```
┌─ apps/web ────────────┐   Next.js on Vercel
│  Landing, auth,       │   UI only — never places trades
│  bot config, journal  │
└───────────┬───────────┘
            │ REST + Supabase Realtime
┌───────────┴───────────┐
│  Postgres (Supabase)  │   users, encrypted tokens, bots,
│                       │   strategies, trades, risk config
└───────────┬───────────┘
            │
┌───────────┴───────────┐   Long-running Node service
│  apps/runner          │   on Railway / Fly.io / Hetzner VPS
│  ├ bot scheduler      │   (NOT serverless)
│  ├ 1 Deriv WS / user  │
│  ├ strategy VM        │   sandboxed strategy execution
│  ├ Risk Guardian      │   hard server-side veto on every buy
│  └ settlement watcher │   proposal_open_contract → real P&L
└───────────┬───────────┘
            │
      Deriv API — every buy carries app_markup_percentage
```

`packages/core` stays shared and framework-free — the same `DerivClient` and
`riskGuardian` run in the browser and in the runner. That structure was a good
call and it pays off here.

**Stack:** Next.js + Tailwind (have it) · Supabase Postgres + Auth · Node runner
on Railway or a €5 Hetzner VPS · Redis for job state · React Native/Expo for
mobile in Phase 3.

**Security, non-negotiable from day one.** You will hold OAuth tokens that can
place real-money trades, on a server. A breach means users' accounts get drained
and the project is over. Therefore: tokens encrypted at rest with a KMS-held key
(never a hardcoded secret, never in the repo), decrypted only in the runner's
memory, never logged, never returned to the browser. Request the narrowest
scopes that work — `read` and `trade` only. **Never request the `payments`
scope**, which would allow withdrawals; not requesting it is both a real security
boundary and something to say out loud on the landing page.

---

## 6. Phases

**Chosen route: manual first, then cloud bots.** Ship the manual dashboard with
markup proven end-to-end, so there's a live revenue test early — then build the
runner. The cloud-bot gap in §4 remains the destination; this just de-risks the
path to it.

### Phase 0 — Unblock login and verify the money (1–3 days)
Nothing below matters until these are true.

1. ~~Find the numeric App ID.~~ **Resolved: it doesn't exist.** The account is
   migrated to the current Options API, where the app ID is the string
   `340ceNJpp5bdPFZLJxcew` sent as a header. Core client rewritten accordingly.
2. ~~Register the redirect URI.~~ **Diagnosed:** `tradezaki.vercel.app/callback`
   is registered and works; the `…humphreykiyeyeus-projects.vercel.app` entry is
   a bare origin with no `/callback` path, so it can never receive the redirect.
   Default switched to the working one.
2b. **Untick the `Payments` scope** on the app. It grants payment-agent deposit
   and withdrawal access, nothing in the app uses it, and it turns a token leak
   into a money-loss event rather than a trading-nuisance event.
3. Fix the OAuth chain: `openid` scope + the `/oauth2/legacy/tokens` exchange.
   *(Code work — in progress.)*
4. **Confirm markup rules with Deriv support in writing:** current maximum %;
   exactly which contract types it applies to (digital options have a payout, so
   they qualify — multipliers and accumulators are structured differently and may
   not); whether it applies on virtual accounts; which account it's credited to
   and on what schedule.
5. ~~Do one real markup test trade.~~ **Done.** $0.35 real-money Rise on
   ROT92023182 → contracts 13→14, revenue $0.21→$0.23, volume +$0.35. The $0.02
   is 3% of the ~$0.665 payout: the full registered rate, applied correctly to a
   contract bought by this codebase.

**Gate: PASSED — by this codebase, with real money.**

```
                  before      after      delta
contracts           13          14        +1
revenue          $0.21       $0.23      +$0.02
volume          $13.00      $13.35      +$0.35   (= the stake, exactly)
```

A $0.35 real-money Rise placed through this app's own buy path. The $0.02 is 3%
of the ~$0.665 payout — the full registered rate, correctly applied. Earlier
earnings on this App ID came from Deriv's App Builder template; this one did not.

The distinction mattered because the failure mode is silent: a buy that succeeds
but produces an unmarked contract is indistinguishable in the UI from one that
earns. It now demonstrably earns.

### Phase 1 — Manual dashboard, markup working end-to-end (1–2 weeks)
The live revenue test. Everything here is reused by the runner later.

- Settlement: subscribe `proposal_open_contract`, write real win/loss + profit.
  Fixes the `result: "open"` bug and makes Risk Guardian functional for the first
  time.
- `app_markup_percentage` on every buy — centralised in one place in
  `derivClient.ts` so it can never be accidentally omitted.
- Symbol and contract picker, duration and stake controls — enough that a real
  trader would actually use it rather than trading direct on Deriv.
- Risk Guardian wired to real settled P&L, with a settings page.
- Auto-journal: win rate by symbol, hour, contract type.
- WS auto-reconnect with backoff (the runner will depend on this being solid).

**Gate: real markup revenue from a real user who isn't you.**

### Phase 2 — Cloud bot MVP (3–5 weeks)
The gap from §4, and where the volume actually is.

- `apps/runner` — long-running Node service, persistent Deriv WS per user,
  auto-reconnect. Not serverless.
- Risk Guardian moves to a hard server-side veto in the runner's buy path, not a
  UI check — this is what makes unattended execution safe to sell.

- Supabase schema + auth; encrypted token vault.
- **DBot XML import** — parse Blockly XML into an internal strategy IR. Start
  with the 80% subset that covers common community strategies (Martingale,
  D'Alembert, fixed-stake digit strategies); reject the rest with a clear message
  rather than failing silently.
- Sandboxed strategy execution (isolated VM, hard CPU/memory/trade-rate caps).
- Bot dashboard: start/stop, live status, positions, P&L, kill switch.
- Risk Guardian settings page, per user, enforced server-side.
- Auto-journal with real settled outcomes — win rate by symbol, hour, strategy.
- Email/push on bot stop, loss limit hit, or disconnect.

### Phase 3 — Mobile + first users (3–4 weeks)
- React Native/Expo app: monitor, start/stop, push notifications. Mobile-first is
  not optional for this audience.
- Onboarding that gets a user from signup → imported strategy → running bot on a
  **demo account** in under 5 minutes. Demo-first is the honest way to acquire
  users, and it costs you nothing since markup doesn't apply to virtual accounts.
- Launch to Deriv trading communities on Telegram/Discord/YouTube — where the
  DBot XML files already circulate. That's the audience, already assembled.

### Phase 4 — Marketplace and copy trading (the multiplier)
- Publish strategies with API-verified track records.
- Follower subscriptions; author revenue share.
- Deriv's native copy-trading API (`copy_start`) as a possible shortcut —
  evaluate against running followers as independent bots.
- Leaderboards from real settled data.

---

## 7. Risks

| Risk | Severity | Response |
|---|---|---|
| Markup doesn't apply to your chosen contract type | **Critical** | Phase 0 gate — verify before building |
| Deriv changes or ends the markup programme | **Critical** | Single revenue dependency. Add subscription tier (e.g. free = 1 bot, paid = unlimited) so markup isn't the only line |
| Token breach drains user accounts | **Critical** | KMS encryption, `read`+`trade` scopes only, never `payments`, no token ever reaches the browser |
| Runaway bot loses a user's balance | High | Server-enforced Risk Guardian, rate caps, demo-first onboarding, hard kill switch |
| Users compare and see markup makes prices worse | Medium | Be upfront about it and price the value honestly — hosted execution is the thing they're paying for |
| Regulatory exposure marketing trading tools per country | Medium | You never custody funds, which helps a lot. Check rules for your target markets; add clear risk disclosure |
| DBot XML parsing is deeper than expected | Medium | Ship a documented subset; fail loudly, not silently |

**One thing to be clear-eyed about:** markup makes an already negative-expectancy
product slightly worse for the user, and optimising for contract volume means
optimising for how fast people trade. Risk Guardian is a real mitigation rather
than a fig leaf — but only if the limits are enforced server-side and can't be
raised mid-session while a user is chasing losses. Build it that way. It's also
the commercially correct choice: a user who blows their account in a week stops
generating revenue in a week.

---

## 8. Open questions for Deriv (send before Phase 1)

1. ~~What is the maximum markup?~~ **Answered: 3%**, per the API schemas.
2. Which contract types does markup apply to? Specifically: digital options,
   multipliers, accumulators, turbos, vanillas. (Markup is a % of *payout*, so
   contracts without a fixed payout are the open question.)
3. Which account is markup credited to, and on what schedule?
4. ~~Is markup earned on demo trades?~~ **Answered: no.** Trades placed on the
   demo account executed and moved the balance, but contract count and revenue
   in markup-statistics did not move at all. Only real-money trades earn.
5. Are there restrictions on apps that execute trades server-side on behalf of
   users, unattended?
6. Is `http://localhost` genuinely disallowed as a registered redirect URL?
7. Unauthenticated `proposal` on `R_75` returns `OfferingsValidationError: This
   trade is temporarily unavailable.` Re-test once authorized — if it persists,
   the default symbol needs changing.

---

## 9. Immediate next actions

1. Log into api.deriv.com/dashboard and read off the **numeric App ID** →
   everything is blocked on this.
2. Send the Phase 0 questions to Deriv support; get answers in writing.
3. I revert the OAuth flow to the classic `acct1/token1` version, fix the app ID,
   and wire `proposal_open_contract` settlement so Risk Guardian works for real.
4. First markup test trade, and confirm the money lands.
