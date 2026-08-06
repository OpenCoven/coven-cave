#!/usr/bin/env bash
# scripts/dev-app.sh — launch CovenCave in Tauri dev mode.
#
# Starts (or attaches to) the dev server on Cave's DEDICATED dev port, then
# configures Tauri's devUrl to match.
#
# This used to scan 3000..3010 for whatever was free, which meant the address
# depended on what else happened to be running. Now the port is fixed by
# scripts/ports.mjs and a busy port is resolved by identity, not by moving:
#
#   busy, and it answers as Cave  -> attach to it (the common case: you already
#                                    have `pnpm dev` running in another terminal)
#   busy, and it is a stranger    -> refuse, and say what to do about it
#
# Usage:
#   pnpm dev:app                    # attach to, or start, the dev port
#   COVEN_CAVE_PORT=3007 pnpm dev:app   # override the port
#   PORT=3007 pnpm dev:app          # same, honoured second
#   pnpm dev:app -- --release       # forwarded flags to Tauri

set -euo pipefail
cd "$(dirname "$0")/.."

# The desktop shell may need its bundled sidecar before the dev server is
# reachable. Source the helper so the Next process inherits its absolute CLI.
source scripts/whisper-runtime-dev-env.sh

port_is_listening() {
  node -e "const net=require('net');const s=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$1"
}

# A socket accept only proves that some process owns the port. The desktop
# WebView needs an actual HTTP response; a wedged compiler otherwise leaves a
# responsive but permanently black Tauri window.
origin_is_ready() {
  node scripts/dev-app-origin-health.mjs --port "$1" --timeout-ms "${2:-1500}" >/dev/null 2>&1
}

# The dedicated dev port, honouring COVEN_CAVE_PORT then PORT.
dev_port="$(node -e "import('./scripts/ports.mjs').then((m) => console.log(m.resolvePort('dev', process.env)))")"
if [ -n "${COVEN_CAVE_PORT:-}" ] || [ -n "${PORT:-}" ]; then
  echo "[dev:app] using overridden port ${dev_port}"
else
  echo "[dev:app] dedicated dev port ${dev_port}"
fi

# Busy is resolved by identity, never by relocating — a port that moves is what
# this contract exists to stop. See scripts/dev-port-owner.mjs.
port_owner="$(node scripts/dev-port-owner.mjs --port "$dev_port" 2>/dev/null || echo free)"
case "$port_owner" in
  ours)
    echo "[dev:app] attaching to the CovenCave dev server already on 127.0.0.1:${dev_port}"
    should_start_server=false
    ;;
  gated)
    echo "[dev:app] ERROR: 127.0.0.1:${dev_port} is serving with an access token configured," >&2
    echo "[dev:app]        so it cannot be identified as CovenCave from here." >&2
    echo "[dev:app]        Stop it, or pick another port: COVEN_CAVE_PORT=3007 pnpm dev:app" >&2
    exit 1
    ;;
  stranger)
    echo "[dev:app] ERROR: port ${dev_port} is held by something that is not CovenCave." >&2
    if command -v lsof >/dev/null 2>&1; then
      echo "[dev:app]        holder: $(lsof -nP -iTCP:"$dev_port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}')" >&2
    fi
    echo "[dev:app]        Free it, or pick another port: COVEN_CAVE_PORT=3007 pnpm dev:app" >&2
    exit 1
    ;;
  *)
    echo "[dev:app] starting dev server on ${dev_port}"
    should_start_server=true
    ;;
esac

TAURI_OVERRIDE_CONFIG="$(mktemp)"
WATCHDOG_VERDICT="$(mktemp)"
tauri_pid=""
server_pid=""
watchdog_pid=""

# Every descendant of a pid, children before parents. The launcher only ever
# walks PIDs it started, never a process guessed from a loopback port.
list_process_tree() {
  local pid="$1" child
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      list_process_tree "$child"
    done
  fi
  printf '%s\n' "$pid"
}

signal_process_tree() {
  local pid="$1" signal="$2" member
  if command -v taskkill >/dev/null 2>&1 && [ "$signal" = "KILL" ]; then
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
    return
  fi
  for member in $(list_process_tree "$pid"); do
    kill -"$signal" "$member" 2>/dev/null || true
  done
}

# Give the tree a chance to flush and shut down, then insist. Without this an
# interrupted wrapper leaves an orphaned Next dev server holding the port and a
# detached Tauri window attached to it.
terminate_process_tree() {
  local pid="$1" waited=0
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  signal_process_tree "$pid" TERM
  while [ "$waited" -lt 50 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    signal_process_tree "$pid" KILL
  fi
}

cleanup() {
  trap - EXIT INT TERM HUP
  if [ -n "$watchdog_pid" ]; then
    kill "$watchdog_pid" 2>/dev/null || true
    watchdog_pid=""
  fi
  terminate_process_tree "$tauri_pid"
  terminate_process_tree "$server_pid"
  if [ "${should_start_server:-false}" = true ] && port_is_listening "$dev_port" >/dev/null 2>&1; then
    echo "[dev:app] warning: 127.0.0.1:${dev_port} is still listening after teardown" >&2
  fi
  rm -f "$TAURI_OVERRIDE_CONFIG" "$WATCHDOG_VERDICT"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

# The launcher starts both the Tauri dev process and its owned server with this
# secret. Carry it into the browser-side bridge through the URL fragment so it
# never participates in Next's module URL resolution or reaches the HTTP server.
# The bridge stores it in sessionStorage, strips it,
# and attaches the header to same-origin `/api/` calls.
dev_url="http://127.0.0.1:${dev_port}"
if [ -n "${COVEN_CAVE_AUTH_TOKEN:-}" ]; then
  sidecar_token_fragment="$(node -p 'encodeURIComponent(process.env.COVEN_CAVE_AUTH_TOKEN)')"
  dev_url+="#covenCaveToken=${sidecar_token_fragment}"
fi

# The desktop shell must not be opened until the actual root document answers.
# The first Windows compile can be slow, so a long one-shot request avoids
# multiplying concurrent compiles while still bounding a genuinely hung origin.
DEV_SERVER_GRACE_SECONDS="${COVEN_CAVE_DEV_SERVER_GRACE_SECONDS:-180}"
case "$DEV_SERVER_GRACE_SECONDS" in
  ''|*[!0-9]*)
    echo "[dev:app] ERROR: COVEN_CAVE_DEV_SERVER_GRACE_SECONDS must be a whole number of seconds" >&2
    exit 1
    ;;
esac

if [ "$should_start_server" = true ]; then
  # Bind explicitly to loopback. Git Bash exports HOSTNAME from the host (often
  # a non-loopback machine name), so relying on server.ts's default is unsafe.
  HOSTNAME=127.0.0.1 PORT="$dev_port" pnpm dev &
  server_pid=$!
fi

initial_timeout_ms=$((DEV_SERVER_GRACE_SECONDS * 1000))
if [ "$initial_timeout_ms" -lt 100 ]; then
  initial_timeout_ms=100
fi
if ! origin_is_ready "$dev_port" "$initial_timeout_ms"; then
  echo "[dev:app] loopback origin on 127.0.0.1:${dev_port} did not return the root document within ${DEV_SERVER_GRACE_SECONDS}s; desktop shell was not opened" >&2
  exit 1
fi

# The server is already owned by this wrapper (or was pre-existing), so Tauri
# must never start another one. This makes initial startup fail in the terminal
# rather than presenting a black native window.
cat >"$TAURI_OVERRIDE_CONFIG" <<CONF
{"build":{"beforeDevCommand":null,"devUrl":"${dev_url}"}}
CONF

watch_dev_server() {
  local down_for=0
  while kill -0 "$tauri_pid" 2>/dev/null; do
    if origin_is_ready "$dev_port"; then
      down_for=0
    else
      down_for=$((down_for + 2))
      if [ "$down_for" -ge "$DEV_SERVER_GRACE_SECONDS" ]; then
        echo "[dev:app] loopback origin on 127.0.0.1:${dev_port} did not return HTTP within ${down_for}s; shutting the desktop shell down" >&2
        printf 'dev-origin-unhealthy\n' >"$WATCHDOG_VERDICT"
        terminate_process_tree "$tauri_pid"
        return 0
      fi
    fi
    sleep 2
  done
}

pnpm exec tauri dev --config "$TAURI_OVERRIDE_CONFIG" "$@" &
tauri_pid=$!

if [ "$DEV_SERVER_GRACE_SECONDS" -gt 0 ]; then
  watch_dev_server &
  watchdog_pid=$!
fi

tauri_status=0
wait "$tauri_pid" || tauri_status=$?
tauri_pid=""

if [ -s "$WATCHDOG_VERDICT" ]; then
  exit 1
fi

exit "$tauri_status"
