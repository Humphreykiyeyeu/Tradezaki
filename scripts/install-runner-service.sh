#!/usr/bin/env bash
#
# Installs the runner as a macOS launchd user agent, so bots keep trading
# after you close the browser, log out, or reboot.
#
# The Linux equivalent is the systemd unit in apps/runner/DEPLOY.md. launchd is
# macOS's counterpart: it starts the process at login and restarts it if it
# dies.
#
#   scripts/install-runner-service.sh            install and start
#   scripts/install-runner-service.sh --uninstall
#
set -euo pipefail

LABEL="app.tradezaki.runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
LOG="$LOG_DIR/tradezaki-runner.log"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER_DIR="$REPO/apps/runner"

# launchd starts processes with a minimal PATH that does not include Homebrew or
# nvm, so every binary has to be named absolutely or the agent fails with a
# bare "no such file" long after you have forgotten why.
NODE_BIN="$(command -v node)"
TSX="$REPO/node_modules/tsx/dist/cli.mjs"

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Bots will not run until it is installed again."
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

[ -x "$NODE_BIN" ] || { echo "node not found on PATH."; exit 1; }
[ -f "$TSX" ] || { echo "tsx not found at $TSX — run 'npm install' first."; exit 1; }
[ -f "$RUNNER_DIR/.env" ] || { echo "$RUNNER_DIR/.env is missing."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# caffeinate -i holds off idle sleep for as long as the runner lives. Without it
# the Mac sleeps, every WebSocket drops, and bots stop silently — which is the
# exact failure this whole service exists to prevent. It cannot defeat a closed
# lid on battery; see DEPLOY.md.
cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-i</string>
        <string>$NODE_BIN</string>
        <string>$TSX</string>
        <!-- Absolute paths: launchd does not reliably apply WorkingDirectory
             before these are resolved, and a relative .env fails with a bare
             "not found" that names neither the file nor the directory. -->
        <string>--env-file=$RUNNER_DIR/.env</string>
        <string>$RUNNER_DIR/src/index.ts</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$RUNNER_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <!-- If the runner is misconfigured it exits immediately; without this
         launchd would respawn it in a tight loop. -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_END

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed $LABEL"
echo "  logs    : $LOG"
echo "  status  : launchctl print gui/$(id -u)/$LABEL | head -20"
echo "  stop    : launchctl bootout gui/$(id -u)/$LABEL"
echo "  restart : launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "  watch   : tail -f $LOG"

# Only tail when asked. Ending unconditionally in `tail -f` makes the script
# hang anything that runs it non-interactively.
if [ "${1:-}" = "--tail" ]; then
  echo
  echo "Tailing — Ctrl-C stops watching, the runner keeps going:"
  sleep 2
  tail -n 30 -f "$LOG"
fi
