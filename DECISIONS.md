# Decisions

Things settled, and why. Kept separate from PLAN.md, which says what we intend to
do — this says what we worked out along the way, including the ideas that were
tried and dropped. If a decision here is reversed later, edit it and say what
changed rather than deleting the reasoning.

---

## Product

### Sell execution, not the bot file
**Decided 2026-08-17.** A strategy here is JSON, and JSON copies for free. Selling
the file to an audience that already shares DBot `.xml` on Telegram cannot work.
The marketplace therefore sells *execution*: the bot runs on our servers under the
buyer's account, the definition never reaches their browser, and it stops when they
stop paying. Deriv cannot copy this — DBot runs in the user's own browser and must
hand over the file. Falls straight out of the runner architecture.

### The platform reports, it does not judge
**Decided 2026-08-17.** Show the evidence — win rate, drawdown, losing streaks,
distributions — and let the trader decide. "Verified" means *this record is real*,
never *this will work*. The moment the claim widens, it becomes the same lie the
Telegram screenshots are, with a badge on it.

### Three revenue lines, not one
**Decided 2026-08-17.** Markup (3% of payout on digits, 3% of stake on
Accumulators and Multipliers), platform subscription, and marketplace commission.
Markup alone is a single point of failure Deriv controls unilaterally — §7 has
always listed it as a critical risk.

### Gate scale and convenience, never safety
**Decided 2026-08-17, reversing an earlier instinct.** The idea was to withhold
backtesting so users would test on real accounts and generate markup while they
found out their strategy failed. The numbers kill it: a $50 account running a
martingale turns over ~$200 in stakes before it is gone — about **$11 of markup,
once** — against **~$228/month** for a retained bot user (PLAN §2). One retained
user is worth about twenty burned ones, and the burned one complains in the same
Telegram groups we recruit from. §7 had already reached this from the other
direction: *"a user who blows their account in a week stops generating revenue in
a week."* Limit how many simulations a free tier gets; never hide the drawdown.

---

## Dropped

### Backtesting as the headline feature — *demoted*
Originally called "the strongest single sellable feature". It is not. Synthetic
indices come from a random number generator, so past ticks contain no pattern to
find and no strategy can be validated against them. It survives as a **risk
simulator** — how deep the drawdowns go, how often a martingale hits its ceiling —
which is honest and useful, but sells safety rather than profit. Alerts moved
ahead of it.

### Optimising strategy parameters against history — *dropped*
Suggested by a comparison table of staking multipliers ranked by profit. On a
random series this is curve-fitting: it confidently recommends whichever setting
got lucky. The side-by-side comparison survives, but framed as *risk* — higher
multipliers show deeper drawdowns — never as "the best setting".

### Dry-run mode — *removed 2026-08-16*
Simulated contracts settled from the tick stream, with no money involved. It only
handled contract types simple enough to settle from ticks and quietly refused the
rest, while a demo account risks nothing *and* exercises the real path.
`simulate.ts` was kept — it is the settlement engine a risk simulator needs.

### A pie chart on the analytics page — *declined*
Asked for directly. A pie cannot draw a negative slice, and the question being
asked is which markets made money and which lost it. With the two symbols this
account trades it would also have been a two-slice pie. Diverging bars from a
shared zero answer the same question honestly.

### "Maximum ticks per streak" as a label — *declined*
Asked for directly. It is not a streak limit: the history routinely shows runs of
93 and 94 against an 85 ceiling. The streak belongs to the market and runs as long
as it runs; the ceiling belongs to a contract, which closes and leaves. Shipped as
"contract max ticks".

---

## Engineering

### Bots are data, not code
No sandbox, no VM. A strategy is a closed condition tree with a fixed operator
set, validated before every run. This removed the largest security risk in the
original plan.

### The web app never talks to the runner
It writes a status to Postgres and the runner reacts. That indirection is what
lets the runner be restarted, moved between machines, or run twice without the
app knowing. Bot claiming is atomic, so two runners can never both take one bot.

### Suspend, don't stop, when the runner goes down
A bot the owner did not stop goes back to `starting`, and any runner picks it up.
Marking it `stopped` blamed the user for something they did not do and meant
nothing ever resumed it.

### Read what the market allows, never hardcode it
Multipliers, growth rates, cancellation windows and stake bounds all come from
`contracts_for` per symbol. Hardcoded lists shipped values Deriv rejects: R_100
allows 40–400 where the code offered 30–400, and R_10 starts at 400, so every
chip was invalid there.

### Fingerprint key material, not the string
Comparing raw environment strings reported a mismatch on a working deployment,
because a trailing space is a different string but decodes to identical bytes.
Compare what AES is handed.

### Ranges are per-market and per-message
Deriv's accumulator stream sends the full history once, then a single live count
per tick. Assigning each message straight through wiped the history. Fold, don't
replace.

### The token never reaches the browser
**Decided and shipped 2026-08-18.** The Deriv access token is a trading
credential. It now lives only in an httpOnly cookie, sealed with the same key as
the runner's vault, and every route reads it server-side. Routes no longer accept
a token in the request body — accepting one would have made the cookie pointless,
since anything able to send a token could trade with it. A script on the page can
still call our routes; what it can no longer do is take the credential somewhere
we cannot see. Legacy localStorage keys are purged on load, because shipping the
fix without that would have protected new users and left existing ones exposed.

---

## Verified facts worth not re-deriving

- Markup on a $10 stake, R_100: **CALL / DIGITEVEN $0.55** (3% of payout),
  **ACCU / MULTUP $0.30** (3% of stake — they earn, contrary to the old §8.2).
- `maximum_ticks` for Accumulators depends only on growth rate: 1%→250, 2%→125,
  3%→85, 4%→65, 5%→50. It is the point where the contract reaches ~12× stake.
- Tick history returns **1,000 ticks per request**, ~33 minutes of R_100.
  Anything longer needs pagination and our own storage.
- `markup-statistics` needs a token with **Application insights**; the OAuth
  `trade` scope returns 403.
- Demo trades earn no markup.
