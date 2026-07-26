#!/usr/bin/env bash
# scripts/dev-app.sh — launch CovenCave in Tauri dev mode.
#
# Auto-detects or starts a dev server, discovering its actual port (which may
# be >3000 if lower ports are in use), then configures Tauri's devUrl to match.
# Respects explicit PORT= override.
#
# Usage:
#   pnpm dev:app             # auto-detect, start on default or next free port
#   PORT=3001 pnpm dev:app   # force specific port
#   pnpm dev:app -- --release    # forwarded flags to Tauri

set -euo pipefail
cd "$(dirname "$0")/.."

# The desktop shell may need its bundled sidecar before the dev server is
# reachable. Source the helper so the Next process inherits its absolute CLI.
source scripts/whisper-runtime-dev-env.sh

port_is_listening() {
  node -e "const net=require('net');const s=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$1"
}

# If PORT is explicitly set, use that; otherwise auto-discover
if [ -n "${PORT:-}" ]; then
  dev_port="$PORT"
  echo "[dev:app] using explicit PORT=${dev_port}"
else
  # Find a free port in the default range
  dev_port=""
  for candidate in $(seq 3000 3010); do
    if ! port_is_listening "$candidate" >/dev/null 2>&1; then
      dev_port="$candidate"
      break
    fi
  done

  if [ -z "$dev_port" ]; then
    echo "[dev:app] ERROR: no free port found in 3000-3010" >&2
    exit 1
  fi

  echo "[dev:app] port ${dev_port} is free"
fi

# Check if a dev server is already running on that port
if port_is_listening "$dev_port" >/dev/null 2>&1; then
  echo "[dev:app] dev server already listening on 127.0.0.1:${dev_port}"
  # Configure Tauri to use it (skip beforeDevCommand)
  should_start_server=false
else
  echo "[dev:app] starting dev server on ${dev_port}"
  should_start_server=true
fi

TAURI_OVERRIDE_CONFIG="$(mktemp)"
WATCHDOG_VERDICT="$(mktemp)"
tauri_pid=""
watchdog_pid=""

# Every descendant of a pid, children before parents. Tauri's `beforeDevCommand`
# runs as its child, so walking the tree from the Tauri pid reaches the Next dev
# server without ever guessing at unrelated processes that merely hold the port.
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
  if [ "${should_start_server:-false}" = true ] && port_is_listening "$dev_port" >/dev/null 2>&1; then
    echo "[dev:app] warning: 127.0.0.1:${dev_port} is still listening after teardown" >&2
  fi
  rm -f "$TAURI_OVERRIDE_CONFIG" "$WATCHDOG_VERDICT"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

# A Tauri dev process and its `beforeDevCommand` inherit this secret together.
# The server therefore requires the browser-side bridge token too; carry it in
# the URL fragment so it never participates in Next's module URL resolution or
# reaches the HTTP server. The bridge stores it in sessionStorage, strips it,
# and attaches the header to same-origin `/api/` calls.
dev_url="http://127.0.0.1:${dev_port}"
if [ -n "${COVEN_CAVE_AUTH_TOKEN:-}" ]; then
  sidecar_token_fragment="$(node -p 'encodeURIComponent(process.env.COVEN_CAVE_AUTH_TOKEN)')"
  dev_url+="#covenCaveToken=${sidecar_token_fragment}"
fi

if [ "$should_start_server" = true ]; then
  # The desktop shell always uses a loopback devUrl. A host-provided HOSTNAME
  # (for example Docker/WSL's machine name) would bind the server elsewhere
  # and leave Tauri waiting forever. Tauri invokes beforeDevCommand through
  # cmd.exe on Windows, so use cmd's `set` form under Git Bash/MSYS.
  before_dev_command="HOSTNAME=127.0.0.1 PORT=${dev_port} pnpm dev"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) before_dev_command="set HOSTNAME=127.0.0.1&& set PORT=${dev_port}&& pnpm dev" ;;
  esac
  # Use beforeDevCommand but set PORT so it uses our free port.
  cat >"$TAURI_OVERRIDE_CONFIG" <<CONF
{"build":{"beforeDevCommand":"${before_dev_command}","devUrl":"${dev_url}"}}
CONF
else
  # Skip beforeDevCommand since the server is already running
  cat >"$TAURI_OVERRIDE_CONFIG" <<CONF
{"build":{"beforeDevCommand":null,"devUrl":"${dev_url}"}}
CONF
fi

# The desktop shell must not stay attached to a loopback origin that is never
# coming back. The in-app recovery overlay covers restarts, so the watchdog only
# fires after a long silence: past that, the dev server is gone for good and a
# surviving window would just show stale Turbopack chunks.
DEV_SERVER_GRACE_SECONDS="${COVEN_CAVE_DEV_SERVER_GRACE_SECONDS:-30}"
case "$DEV_SERVER_GRACE_SECONDS" in
  ''|*[!0-9]*)
    echo "[dev:app] ERROR: COVEN_CAVE_DEV_SERVER_GRACE_SECONDS must be a whole number of seconds" >&2
    exit 1
    ;;
esac

watch_dev_server() {
  local down_for=0
  # Only start judging once the server has actually come up.
  until port_is_listening "$dev_port" >/dev/null 2>&1; do
    kill -0 "$tauri_pid" 2>/dev/null || return 0
    sleep 2
  done
  while kill -0 "$tauri_pid" 2>/dev/null; do
    if port_is_listening "$dev_port" >/dev/null 2>&1; then
      down_for=0
    else
      down_for=$((down_for + 2))
      if [ "$down_for" -ge "$DEV_SERVER_GRACE_SECONDS" ]; then
        echo "[dev:app] dev server on 127.0.0.1:${dev_port} has been unreachable for ${down_for}s; shutting the desktop shell down" >&2
        printf 'dev-server-lost\n' >"$WATCHDOG_VERDICT"
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
