#!/usr/bin/env bash
# Source this from a desktop development launcher before starting Next/Tauri.
# The sidecar route runs in the Next process during development, so it must
# receive the same bundled executable path that production receives from Rust.

set -euo pipefail

WHISPER_DEV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DEV_BIN="$WHISPER_DEV_ROOT/src-tauri/resources/whisper/whisper-cli"

bash "$WHISPER_DEV_ROOT/scripts/whisper-runtime-bundle.sh"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    WHISPER_DEV_BIN+=".exe"
    if command -v cygpath >/dev/null 2>&1; then
      WHISPER_DEV_BIN="$(cygpath -w "$WHISPER_DEV_BIN")"
    fi
    ;;
esac

export COVEN_WHISPER_CPP_BIN="$WHISPER_DEV_BIN"
echo "[dev:whisper] using bundled runtime: $COVEN_WHISPER_CPP_BIN"
