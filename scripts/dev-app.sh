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
cleanup() { rm -f "$TAURI_OVERRIDE_CONFIG"; }
trap cleanup EXIT

if [ "$should_start_server" = true ]; then
  # Use beforeDevCommand but set PORT so it uses our free port
  cat >"$TAURI_OVERRIDE_CONFIG" <<CONF
{"build":{"beforeDevCommand":"PORT=${dev_port} pnpm dev","devUrl":"http://127.0.0.1:${dev_port}"}}
CONF
else
  # Skip beforeDevCommand since the server is already running
  cat >"$TAURI_OVERRIDE_CONFIG" <<CONF
{"build":{"beforeDevCommand":null,"devUrl":"http://127.0.0.1:${dev_port}"}}
CONF
fi

exec pnpm exec tauri dev --config "$TAURI_OVERRIDE_CONFIG" "$@"
