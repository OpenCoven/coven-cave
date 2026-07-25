#!/usr/bin/env bash
# Direct `tauri dev` launcher: stage and export Whisper for the Next process.
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/whisper-runtime-dev-env.sh
exec pnpm dev
