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
  auto-reconnect. Not serverless. The engine it runs (`packages/core/strategy`)
  is already built and tested: `StrategyRunner` consumes ticks and returns buy
  intents, holding no connection, so the runner only has to wire it to the
  socket and the database.
- Risk Guardian moves to a hard server-side veto in the runner's buy path, not a
  UI check — this is what makes unattended execution safe to sell.

- Supabase schema + auth; encrypted token vault.
- ~~DBot XML import~~ **Done** — imports 22/22 tested community strategies.
  Two things learned from real files, both of which changed the design:
  - **DBot is a programming language, not a config format.** The commonest
    blocks are `variables_get/set`, `logic_compare`, `controls_if`,
    `math_arithmetic`. Entry logic is an arbitrary Blockly program. We import
    the declarative parts (market, contract types, duration, stake, martingale)
    and refuse to invent the rest: every import is flagged `needsReview` and the
    user must set entry rules. Turning "buy when RSI < 30" into "buy every tick"
    would drain an account while looking like a successful import.
  - **Two file formats are in circulation.** Legacy `trade`, and nested
    `trade_definition_*`. Supporting only one imports 15/22.
- ~~Sandboxed strategy execution~~ **Not needed, by design.** Strategies are
  data, not code — a closed condition tree with a fixed operator set. There is
  no VM to sandbox because there is nothing to execute. This removes the single
  largest security risk in the original plan.
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
2. ~~Which contract types does markup apply to?~~ **Answered: all of them, but
   on two different bases.** The earlier reasoning here was wrong. It inferred
   from `payout: 0` that Accumulators and Multipliers earn nothing, since a
   percentage of nothing is nothing. Measured directly on a $10 stake on R_100,
   reading `app_markup_amount` off the proposal:

   | Contract | Payout | Markup | Effective |
   |---|---|---|---|
   | CALL, 5 ticks | 18.19 | **0.55** | 5.5% of stake |
   | DIGITEVEN, 1 tick | 18.18 | **0.55** | 5.5% of stake |
   | ACCU, 3% growth | 0 | **0.30** | 3.0% of stake |
   | MULTUP, x100 | 0 | **0.30** | 3.0% of stake |

   For payout-based contracts markup is 3% of payout, as documented. For
   Accumulators and Multipliers Deriv falls back to **3% of stake** instead —
   less per dollar staked, but far from nothing.

   The bot consequence is the opposite of what was written here: an Accumulator
   or Multiplier strategy does earn. Digital options remain roughly 1.8× better
   per dollar staked, so they stay the priority, but there is no reason to
   steer bots away from the other families.
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

## 9. Where it stands, and what's next

*Updated 2026-08-17.*

### Done and proven, not just written

Phase 0 and most of Phase 2 are real. Verified end to end, on live infrastructure:

- **Login → sealed token → cloud bot → trade → settlement.** A bot started from
  the deployed site is claimed by the runner on a separate machine, connects to
  Deriv, trades, and writes settled results back. ~65 demo trades and one
  real-money contract.
- **Bots survive restarts.** A planned restart suspends and resumes them; a
  crash is detected by heartbeat and resumed automatically, capped by
  `RUNNER_MAX_RESUMES`. Both paths were tested deliberately, including by
  reproducing the database state a power cut leaves behind.
- **Interrupted contracts are collected.** Bots re-watch their own open trades
  on start, and a periodic sweeper picks up contracts belonging to bots that
  stopped and never came back. Without it, rows sat at `open` forever and every
  profit figure was quietly wrong.
- **Risk Guardian is server-side.** Limits live in Postgres, which is the only
  copy the runner can read. A real-money account with no limits configured gets
  a conservative fallback, announced as an event rather than applied silently.
- **Markup measured per contract**, on both bases — see §8.2.

### The gaps, in the order they matter

1. **The Deriv token is in `localStorage`.** Any script on the page can read a
   credential that places real trades. Fine while the only user is the author;
   it is the hard gate on inviting anyone else, and §7 already names it as the
   critical risk. Move it to an httpOnly cookie set by the token route.
2. **Nobody but the author has used it.** Phase 1's gate — "real markup revenue
   from a real user who isn't you" — has never been attempted. Everything else
   here is speculation until it is.
3. **No notifications.** A bot that stops at 3am is discovered at 8am. Phase 2
   lists email/push on stop, loss limit, and disconnect; none exists. For a
   product whose promise is "it runs without you", this is closer to core than
   it looks.
4. **Hand-placed trades never reach the database.** They live in `localStorage`,
   so they do not follow a user between devices and are missing from analytics
   on any other machine.
5. **Stake bounds are read but not enforced.** `min_stake`/`max_stake` arrive
   from `contracts_for`; the ticket does not check against them, so a bad stake
   fails at proposal time rather than in the form.
6. **One runner, one machine.** It is currently a laptop. Two runners can safely
   share the load — claiming is atomic — but nothing has ever run on a second
   machine, and no monitoring exists to notice the first one being gone.
7. **Markup revenue is not readable from the app.** `markup-statistics` needs a
   token with Application insights; the OAuth `trade` scope returns 403. Revenue
   is only visible by running `scripts/deriv-status.mjs` with a separate token.

### The honest strategic question

The engineering works. What has not been tested is whether anyone wants it, and
the one strategy run at length lost money — 29 wins to 35 losses over 64 demo
trades, exactly as its own preset warns a martingale on digits will. "The bots
run perfectly and lose money" is a hard sell, and no amount of further
engineering answers it.

Two candidate responses, and they are not mutually exclusive:

- **Position honestly as infrastructure.** Sell reliable unattended execution of
  *the user's own* strategy, and stay out of the business of implying it wins.
  The DBot import wedge from §4 already points this way — people arrive with
  strategies they already believe in.
- **Test with real users before building more.** Phase 3's onboarding target —
  signup to running demo bot in under five minutes — is now mostly reachable.
  Getting five people from a Deriv Telegram group through it would produce more
  information than another month of features.

**Recommended next: item 1, then item 2.** Security is what makes item 2 legal
to attempt, and item 2 is what tells you whether items 3–7 are worth building.

---

## 10. The product beyond bots

*Written 2026-08-17, after the cloud runner was proven working.*

Cloud execution is the wedge, not the product. It gets attention because the
pain is obvious, but on its own it is one feature and a competent team could
copy it in a month. This section is the argument for what the system is *for*.

### The reframe

Deriv sells **access to markets**. It does not sell **confidence in a decision**.
Every gap below is a confidence gap, and confidence is what people actually
lack — not another way to press buy.

Follow what a Deriv bot trader actually goes through:

| Step | What they need | What Deriv gives them |
|---|---|---|
| 1. Get a strategy | Something worth running | Nothing. They find `.xml` files on Telegram |
| 2. Decide if it works | Evidence | **Nothing. DBot has no backtest at all** |
| 3. Run it | Execution that survives | DBot, which dies with the browser tab |
| 4. Not blow up | A limit that actually stops it | Nothing. Self-exclusion is account-wide and drastic |
| 5. Know what happened | Performance, honestly | A statement. A list of rows |
| 6. Do more of what works | A way to compound | Nothing |

Deriv serves one step out of six, and serves it badly. **That sequence is the
product.** It is not a feature list — it is a loop, and each stage feeds the
next. That is what makes it something people stay inside rather than a tool they
visit.

### The loop, and where we are

```
   ┌──────────────────────────────────────────────────────┐
   │                                                      │
   ▼                                                      │
 FIND ──────► PROVE ──────► RUN ──────► PROTECT ──────► LEARN
   │            │            │             │              │
 import       backtest     cloud        risk limits    analytics
 DBot xml     on real      runner       server-side    win rate,
 marketplace  tick data    24/7         + alerts       drawdown
   ▲                                                      │
   │                                                      │
   └───────────────── PUBLISH ◄───────────────────────────┘
                   verified track record
```

| Stage | State |
|---|---|
| FIND | DBot import **done** (22/22 real files). Marketplace not started |
| PROVE | **Not started.** `simulate.ts` exists in core, unused |
| RUN | **Done.** Survives restarts, crashes, deploys |
| PROTECT | Limits **done**, server-side. **Alerts missing entirely** |
| LEARN | Analytics **done** |
| PUBLISH | Not started |

### The three things that would actually make it sell

**1. Backtesting — "prove it before you risk it."**

DBot has no backtest. None. People run strategies on real money to find out if
they work, which is an expensive way to learn.

We can do better than most platforms could, because of the instrument: a digit
contract settles purely from the tick stream. Given tick history, a backtest of a
digit strategy is not an approximation — it is **exact**. `simulate.ts` already
does this settlement maths and is already tested; it was written for the dry-run
feature and kept when that was removed.

**Two corrections to the above, both important.**

*It cannot find a winning strategy, and must not claim to.* Synthetic indices are
generated by a random number generator — each tick is independent of the last.
There is no pattern in past ticks because there was none to begin with, so a
strategy that looks brilliant over 10,000 historical ticks is showing luck. Any
feature that invites optimising parameters against history is curve-fitting on
noise, and will confidently recommend the setting that got lucky.

*What it is genuinely for is risk.* How deep the losses get, how often a
martingale hits its ceiling, what nine losses in a row does to a balance, and
that a 1.85× payout on a coin flip loses money over time — shown in the user's
own numbers rather than asserted. The honest pitch is **"see what this strategy
does to your balance, before it does it"**, not "find a winner".

*Better than a single backtest: run it a thousand times.* Because the market is
a known random process, a single historical path is one sample and tells you
almost nothing. Simulating the strategy over many generated paths gives the
**distribution** of outcomes, which is the real answer:

```
1,000 simulated sessions of this strategy:
  lost money in 78% of them
  median result        -$12
  worst case          -$340
  chance of 9+ losses in a row   64%
```

That is mathematically correct for this instrument, impossible to curve-fit,
and far more useful than one lucky curve. It also sidesteps the tick-history
limit entirely.

Practical limit measured: Deriv returns **1,000 ticks per request** (~33 minutes
of R_100). Backtesting over a day means paginating backwards and storing ticks
ourselves — real data-infrastructure work that must be budgeted, not assumed.

Coverage limit: exact for digits, approximate for touch/barrier contracts, and
not possible for Accumulators and Multipliers without modelling Deriv's pricing.
Ship the exact cases and say plainly which they are.

**2. Alerts — the promise is not kept without them.**

"It runs without you" is false if a bot stopping at 3am is discovered at 8am.
Push, email, or a Telegram bot on: bot stopped, loss limit hit, connection lost,
unusual drawdown. Cheapest item here by a distance and it closes the gap between
what the product claims and what it does.

Telegram specifically, because that is where this audience already lives.

**3. Verified track records — the moat.**

This is the one worth building the rest for.

The Deriv strategy community runs on **screenshots**, and screenshots are
trivially faked. Telegram is full of people selling `.xml` files with invented
results. There is no way to tell a good strategy from a lie, and everyone in that
market knows it.

We hold settled contract history from the API. We can prove real P&L — every
trade, every loss, the drawdown included. A verified badge backed by settled
contracts is something **Deriv itself does not offer and a seller cannot fake.**

That is the sharpest "why this app" sentence available:

> Every strategy here has a track record you can check, trade by trade.
> No screenshots.

**Why it is a moat and cloud execution is not:** anyone can rent a server. Nobody
can retroactively manufacture six months of API-verified settled trades. It
compounds, it has a network effect, and the data only exists because people ran
bots here. Everything earlier in the loop is the on-ramp that generates it.

**Why it multiplies revenue:** markup scales with contract count, and the
marketplace is the only feature that breaks the one-user-one-bot ceiling. One
strategy × 50 followers × 200 contracts/day is a different business from one
trader with one bot.

### What this does to the positioning

It stops being *"we run your bots"* and becomes:

> **The place where Deriv strategies are proven, run, and trusted.**

The distinction matters commercially. "We run your bots" invites a price
comparison against a $5 VPS. "The only place a strategy's record can be verified"
does not compare to anything.

### The honest tensions

- **A marketplace means implicitly endorsing strategies that lose money.** Most
  will. Mitigate by construction: never rank by return alone, show drawdown and
  loss runs as prominently as gains, and make "verified" mean *this record is
  real*, never *this will work*. The verification claim must stay narrow or it
  becomes the same lie with a badge on it.
- **Deriv could build any of this.** They have not in years, which is evidence
  but not a guarantee. The marketplace is the hardest for them to copy, because
  the data has to accumulate somewhere and they would be starting at zero too.
- **§3's contradiction does not go away.** Revenue still comes from volume. The
  answer stays the same: a user who survives trades longer, and Risk Guardian is
  therefore commercially correct as well as ethically correct.
- **Backtesting will show most strategies lose.** That is a feature. A product
  that tells people the truth before they spend money is the one that gets
  recommended — and the strategies that survive it are the ones worth hosting.

### Suggested order

Sequenced so each step makes the next possible, not by size:

| # | Item | Why now |
|---|---|---|
| 1 | Token out of `localStorage` | Gate on any real user existing |
| 2 | Alerts (Telegram first) | Makes the current promise true |
| 3 | Five real users on demo | Tells you if any of this is wanted |
| 4 | Backtesting | Strongest single sellable feature; core maths already exists |
| 5 | Marketplace with verified records | Needs 3 and 4 to have produced data |

Items 1–3 are weeks. Item 4 is the one that changes the pitch. Item 5 is the one
that changes the business.

---

## 11. Revenue beyond markup

*Written 2026-08-17.*

Markup is currently the only revenue line, and §7 already lists that as a
critical risk: Deriv can change or end the programme unilaterally and the
business ends with it. Two more lines are available, and both fit the product
rather than being bolted on.

### The three lines

| Line | What it is | Scales with |
|---|---|---|
| **Markup** | 3% of payout (digits) or 3% of stake (Accu/Mult) | contracts × stake |
| **Subscription** | Traders pay for the tooling | active users |
| **Marketplace** | Cut of strategy subscriptions | strategies × followers |

They are complementary, not alternatives: subscription revenue is stable and
predictable where markup is volatile, and the marketplace is the only one that
scales beyond one-user-one-bot.

A plausible split of tiers, deliberately gating *convenience and scale* rather
than *safety*:

- **Free** — one bot, demo and real, full risk controls, basic analytics,
  limited simulations per day
- **Pro** — several bots, unlimited simulations, Telegram alerts, full analytics
  history, scheduling
- **Advanced** — many bots, API access, longer data retention, priority execution

### The one thing not to put behind a paywall

There is a tempting argument that goes: markup is earned on real-money trades,
so anything that stops a user losing money on a real account costs revenue —
therefore withhold risk information, or sell it later, and earn from their
testing in the meantime.

**The numbers say this is a bad trade, before any question of ethics.**

Burning a user is a one-off. A trader with a $50 balance running a martingale
turns over roughly $200 in stakes before the account is gone — about **$11 of
markup, once**. A retained bot user on modest volume is **~$228 a month**
(§2). One retained user for one month is worth roughly twenty burned ones, and
the burned one leaves angry, in a market where the entire audience is in the
same Telegram groups.

§7 already reached this conclusion from the other direction: *"a user who blows
their account in a week stops generating revenue in a week."* Risk information
is retention, and retention is the revenue.

The commercially correct version of the same instinct is to gate **scale and
convenience**, never safety: limit *how many* simulations a free user can run,
not whether they are allowed to know the drawdown. That sells Pro without
selling the user out.

### Reviewed against the ChatGPT roadmap

Worth adopting from it:

- **Parameter comparison.** Run one strategy at several staking settings and
  show the results side by side. The engine is pure, so this is nearly free.
  Frame it as a *risk* comparison — higher multipliers show deeper drawdowns —
  and never as "find the best setting", which on a random series is noise.
- **Backtest versus actual demo.** Show the simulation's prediction against what
  the demo run really did. It validates the simulator in the open and builds
  trust in it, which no competitor screenshot can.
- **Strategy Lab.** Strategies need to be first-class objects: rename,
  duplicate, organise, version. They are currently save-and-forget.
- **Two subscription types**, as above.

Worth rejecting from it:

- **Its example numbers.** "8,421 trades, 58.3% win rate, +37% return" and a
  "184,231 trade" verified record are not achievable on this instrument —
  break-even at a 1.85× payout needs about 54%, sustained, on a random series.
  Shipping mock-ups with those figures teaches users to expect them.
- **Optimising parameters against history**, for the reason above.
- **Its phase order**, which assumes a green field. Phases 1 and 2 are largely
  built; risk controls and alerts sit at its Phase 5 despite alerts being the
  cheapest item and the one that makes the existing promise true.

### The bot marketplace, and the one problem it has to solve

The intent is: creators build bots, sell them, the platform takes a commission.
The obstacle is structural and has to be designed for, not discovered later.

**A bot here is data, and data copies for free.** A strategy in this system is
JSON — a closed condition tree, by design (§6). Sell someone the file and they
own it forever, can hand it to a friend, and can post it in the same Telegram
group it would have been sold in. This is exactly why DBot `.xml` files already
circulate free: nobody has found a way to sell a copyable file to an audience
that shares everything.

**The cloud runner is the answer, and it is the reason this can work here and
nowhere else.** Don't sell the bot. Sell its *execution*.

- The buyer subscribes; the bot runs on our infrastructure, on their Deriv
  account, under their own risk limits.
- The strategy definition never reaches the buyer's browser. They get the
  trades, not the recipe.
- Stop paying and it stops running. Nothing was handed over to keep.

A VPS reseller cannot offer this, and neither can Deriv — DBot has to give the
user the file, because DBot runs in the user's own browser. Sealed execution is
a direct consequence of the architecture already built.

It also cleanly separates the two things a creator sells: the strategy itself,
and their continued work on it — tuning, adjusting, retiring it when it stops
working. The second is worth paying monthly for; a file is not.

**What still has to be built beyond the runner:**

- Strategy definitions hidden from the buyer's client (they are currently sent
  to the browser through `lib/cloud.ts`, so this is a real change, not a config)
- Creator profiles, publishing, pricing
- Subscription billing and **creator payouts** — the genuinely hard part in the
  target markets, where card rails are weak and M-Pesa or similar is expected.
  Budget this properly; it is not a weekend of Stripe
- Commission handling and creator reporting

**The risk that grows here.** Hosting a user's own bot is infrastructure.
Running a marketplace where people sell trading bots to strangers is closer to
distributing financial products, and §7's "regulatory exposure per country" line
gets substantially heavier. Practical mitigations: sell *execution and access*
rather than advice, never rank by profit alone, show drawdown as prominently as
returns, keep "verified" meaning only *this record is real*, require demo
running before a real-money subscription, and take legal advice for the specific
countries targeted before launch rather than after.
