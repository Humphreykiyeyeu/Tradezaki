# Tradezaki runner

The long-running process that executes bots. This is what makes "keeps trading
with your phone off" true — Vercel cannot hold a WebSocket open for hours, so
the runner lives on its own host.

## How it fits together

The web app never talks to this process. It writes a bot's `status` to Postgres
and the runner reacts:

```
web app ──> bots.status = 'starting' ──> Postgres
                                            │  poll
                                            ▼
                                        runner ──> Deriv WebSocket
                                            │
                                            └──> trades, bot_events
```

That indirection is deliberate: the runner can be restarted, moved between
hosts, or scaled to several processes without the app knowing.

## Setup

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only, never a browser
export DERIV_TOKEN_KEY=$(openssl rand -base64 32)     # 32 bytes, keep it safe
npm start -w @tradezaki/runner
```

`DERIV_TOKEN_KEY` decrypts every stored Deriv token. **Lose it and every user
has to reconnect; leak it together with a database dump and every user's
account is exposed.** It belongs in the host's environment, never in the repo,
never in Supabase.

Optional: `RUNNER_POLL_MS`, `RUNNER_HEARTBEAT_MS`, `RUNNER_MAX_BOTS`,
`RUNNER_INSTANCE_ID`.

## What it guards against

- **Strategies are validated before execution.** They are stored as JSONB and
  could have been hand-edited; the IR's safety comes from being a closed shape,
  which only holds if it's checked.
- **Risk Guardian is enforced here too**, against the account's real trades for
  the day — not just the bot's own session. A second bot on the same account
  counts toward the same limit.
- **A crashed runner is detectable.** Bots heartbeat; a row still marked
  `running` with a stale heartbeat is flipped to `error` so nobody believes a
  bot is trading when nothing is executing it.
- **Clean shutdown.** SIGTERM stops every bot and records why, rather than
  leaving rows that claim to be running.

## Deployment

Any host that runs a Node process continuously: Railway, Fly.io, or a €4/mo
Hetzner box. Not Vercel — serverless functions cannot hold the connection.
