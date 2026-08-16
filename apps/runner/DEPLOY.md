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

## Where each piece runs, and why

The runner never talks to the browser. The web app writes a row to Postgres,
the runner polls for it. That means the two halves can live in completely
different places, and normally they have to:

| | |
|---|---|
| **Web app** | Hosted at an `https://` origin — Vercel by default. |
| **Runner** | Anywhere Node runs, including your own machine. |

The web app has to be hosted because **Deriv will not redirect an OAuth login to
`localhost`**. A local dev server can trade manually with a token you already
have, but it can never complete a fresh login, so it never mints the Tradezaki
account and sealed credentials a cloud bot needs. Sign in on the deployed site.
The runner on your machine picks up bots started there within one poll.

This is also why the deployment holds a *third* copy of the configuration. If
its `DERIV_TOKEN_KEY` differs from the runner's, logging in still appears to
work — the vault write fails and is only warned about in the server log — and
every cloud bot then dies claiming there are no stored credentials. `npm run
check:cloud` asks the deployment for its fingerprints and compares them:

```bash
npm run check:cloud                                    # checks the default deployment
npm run check:cloud -- https://my-app.vercel.app       # or a specific one
```

Rotating `DERIV_TOKEN_KEY` invalidates every stored credential, so users must
reconnect Deriv afterwards. Update all three copies together.

## Running it on your own machine

Perfectly valid for testing and early users — the runner needs no inbound
connectivity, so a laptop works.

### macOS

Before installing anything, check the configuration. Every failure this catches
otherwise shows up as a bot that flips to `error` with a message blaming
decryption, when the real cause was two `.env` files disagreeing:

```bash
npm run check:cloud
```

Then install it as a launchd user agent — macOS's equivalent of a systemd user
service. It starts at login and restarts the process if it dies:

```bash
scripts/install-runner-service.sh              # install, start, tail the log
scripts/install-runner-service.sh --uninstall
```

```bash
launchctl print gui/$(id -u)/app.tradezaki.runner | head -20   # status
launchctl kickstart -k gui/$(id -u)/app.tradezaki.runner       # restart
tail -f ~/Library/Logs/tradezaki-runner.log                    # live logs
```

**Do not keep the repo in `~/Desktop`, `~/Documents` or `~/Downloads`.** macOS
protects those directories, and a launchd agent cannot read files inside them —
there is no way for it to ask, because a background agent has no UI to prompt
with. The failure is badly disguised: `ls` on the file succeeds while reading
its contents returns `Operation not permitted`, and Node reports that as

```
/usr/local/bin/node: /path/to/apps/runner/.env: not found
```

which sends you hunting for a missing file that is plainly there. Keep the
project somewhere unprotected — `~/tradezaki` is fine. Running the runner from a
terminal works either way, because Terminal has already been granted access, so
this only appears once you install the service.

**Sleep is the thing that will catch you out.** A Mac that sleeps drops every
WebSocket, and bots stop without any error — the runner is not crashed, it is
suspended, so nothing reports a fault until the heartbeat goes stale. The agent
runs under `caffeinate -i`, which holds off *idle* sleep, but that cannot
override a closed lid on battery. For a machine that is genuinely meant to keep
bots alive:

```bash
sudo pmset -a disablesleep 1     # or: System Settings → Lock Screen, and
                                 # Energy → "Prevent automatic sleeping"
```

Keep it plugged in, and expect a closed lid to end the session unless the Mac is
in clamshell mode with an external display.

### Linux

A systemd **user** service is installed at
`~/.config/systemd/user/tradezaki-runner.service`:

```bash
systemctl --user start tradezaki-runner     # start now
systemctl --user enable tradezaki-runner    # start at login
systemctl --user status tradezaki-runner
journalctl --user -u tradezaki-runner -f    # live logs
```

By default a user service stops when you log out. To keep it running after
logout and across reboots:

```bash
sudo loginctl enable-linger $USER
```

The limitation to be honest about: this makes "keeps trading with your phone
off" depend on **your** machine staying on. A closed lid, a power cut or an ISP
reset stops every bot at once. Fine while you're testing; move it before anyone
else relies on it. Migration is clone, copy `.env`, start — the runner is
stateless.

## Setup on a fresh Debian/Ubuntu box

```bash
# 1. Node 20.6+ — that is what --env-file needs. Check apt first; newer
#    distros already ship a recent enough version.
apt-cache policy nodejs | head -3
# If it is older than v20.6 (Debian 12 ships v18):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v

# 2. Get the code
git clone https://github.com/Humphreykiyeyeu/Tradezaki.git
cd Tradezaki
npm install

# 3. Configure
cp apps/runner/.env.example apps/runner/.env
nano apps/runner/.env
```

Fill in:

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → **Secret key**
  (`sb_secret_...`). Supabase renamed these: the old `service_role` key is now
  called the *secret* key, and the old `anon` key is now *publishable*. The
  secret key carries `BYPASSRLS` and skips every policy, so it must never reach
  a browser. The variable keeps its old name for continuity.
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
