# Deploying the runner

The runner is a plain Node process. It needs **no inbound connectivity** — no
open ports, no domain, no TLS certificate. It dials out to Supabase and Deriv,
and nothing dials in. That makes it about as simple as a server gets.

Anything that runs Node continuously works. The smallest plan any provider
sells is enough: **1 vCPU, 1 GB RAM**. Don't overbuy — the process idles around
100 MB.

## Provider notes

| | |
|---|---|
| **Truehost / HostAfrica / HostPinnacle** (Kenya) | M-Pesa, near-instant activation, ~KSh 560–1,400/mo. Lower latency to Deriv than a US region. |
| **Oracle Cloud Always Free** | Free forever if the signup accepts you. Rejections are common and not worth fighting. |
| **Contabo, Vultr, Akamai** | Take PayPal, which often clears where cards are declined. |
| **A spare laptop or Raspberry Pi** | Genuinely fine for testing and early users. See "When to move" below. |

Avoid **Render's free tier** (services sleep after 15 minutes — a sleeping bot
is not a bot) and **Koyeb** (free tier closed to new signups).

## Setup on a fresh Ubuntu box

```bash
# 1. Node 22. Ubuntu's apt ships something too old for --env-file.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v          # must be v20.6 or newer

# 2. Get the code
git clone https://github.com/Humphreykiyeyeu/Tradezaki.git
cd Tradezaki
npm install

# 3. Configure
cp apps/runner/.env.example apps/runner/.env
nano apps/runner/.env
```

Fill in:

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → `service_role`.
  Bypasses row-level security. Server only, never a browser.
- `DERIV_TOKEN_KEY` — **must be the exact same value the web app uses.** It
  decrypts every stored Deriv token. If the two differ, bots will fail to start
  with "could not decrypt the stored token".

```bash
# 4. Check it starts
npm start -w @tradezaki/runner
```

You should see the banner and no errors. `Ctrl-C` once it's quiet.

## Keep it running

`systemd` restarts the process if it crashes and starts it again after a reboot.
Both matter — an unattended trading service that dies at 3am and stays dead
until you notice is worse than one that never started.

```bash
sudo tee /etc/systemd/system/tradezaki-runner.service >/dev/null <<'UNIT'
[Unit]
Description=Tradezaki bot runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/Tradezaki/apps/runner
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
# Don't hammer Deriv if something is badly wrong.
StartLimitBurst=5
StartLimitIntervalSec=300
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tradezaki-runner
systemctl status tradezaki-runner
journalctl -u tradezaki-runner -f     # live logs
```

## Back up DERIV_TOKEN_KEY

Do this before you have users.

That key decrypts every stored Deriv token. **Lose it and every user has to
reconnect** — their bots stop and there is no recovery. Keep a copy somewhere
that is not the server and not this repository.

Equally: it must never end up in git, in Supabase, or in a screenshot. Anyone
holding both it and a database dump can trade on your users' accounts.

## When to move off a home machine

Compute is not the constraint — a laptop can hold hundreds of bots. Availability
is. The product's promise is *"keeps trading when your device is off"*, and
running it at home makes that promise depend on your device being on: a power
cut, a closed lid, or an ISP reset stops every customer's bot at once.

Move it the day someone who isn't you depends on a bot running overnight.

Migration is deliberately trivial. The runner is stateless — every bot,
strategy and trade lives in Postgres. Moving hosts is: clone, copy `.env`,
start. Nothing to export.

## Health check

```sql
-- Bots that claim to be running but whose heartbeat has gone stale.
-- The runner marks these as errored itself; if you see them lingering,
-- no runner is alive.
select id, name, status, last_heartbeat
from bots
where status = 'running'
  and last_heartbeat < now() - interval '2 minutes';
```
