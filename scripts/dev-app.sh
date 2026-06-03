#!/usr/bin/env bash
# scripts/dev-app.sh — launch CovenCave in Tauri dev mode.
#
# - If localhost:3000 is already running (e.g. a separate `pnpm dev`),
#   attach to it and skip Tauri's beforeDevCommand.
# - Otherwise let Tauri spawn `pnpm dev` itself.
#
# Usage:
#   pnpm dev:app             # auto-detect
#   pnpm dev:app -- --release    # forwarded flags

set -euo pipefail
cd "$(dirname "$0")/.."

if lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev:app] localhost:3000 already up — attaching to existing dev server"
  # Override beforeDevCommand so Tauri doesn't try to start a second pnpm dev
  TAURI_OVERRIDE_CONFIG="$(mktemp)"
  cleanup() { rm -f "$TAURI_OVERRIDE_CONFIG"; }
  trap cleanup EXIT
  cat >"$TAURI_OVERRIDE_CONFIG" <<'JSON'
{"build":{"beforeDevCommand":null}}
JSON
  pnpm exec tauri dev --config "$TAURI_OVERRIDE_CONFIG" "$@"
else
  echo "[dev:app] starting Tauri (will spawn pnpm dev itself)"
  exec pnpm exec tauri dev "$@"
fi
