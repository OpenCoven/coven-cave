#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
TAILSCALE_TIMEOUT_MS="${TAILSCALE_TIMEOUT_MS:-8000}"
COVEN_MOBILE_ACCESS_TOKEN="${COVEN_MOBILE_ACCESS_TOKEN:-}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

port_is_listening() {
  node -e "const net=require('net');const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$HOST" "$PORT"
}

tailscale_cmd() {
  node - "$TAILSCALE_TIMEOUT_MS" "$@" <<'NODE'
const { spawnSync } = require("node:child_process");

const [timeoutMsRaw, ...args] = process.argv.slice(2);
const timeout = Number(timeoutMsRaw);
const res = spawnSync("tailscale", args, {
  stdio: "inherit",
  timeout: Number.isFinite(timeout) ? timeout : 8000,
});

if (res.error?.code === "ETIMEDOUT") {
  console.error(`tailscale ${args.join(" ")} timed out`);
  process.exit(124);
}
if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
NODE
}

need pnpm
need node
need tailscale

if [ -z "$COVEN_MOBILE_ACCESS_TOKEN" ]; then
  COVEN_MOBILE_ACCESS_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')"
fi
export COVEN_MOBILE_ACCESS_TOKEN

if ! tailscale_cmd status --self >/dev/null 2>&1; then
  echo "tailscale is not connected or did not respond. Run: tailscale up" >&2
  exit 1
fi

if port_is_listening >/dev/null 2>&1; then
  echo "Refusing to expose an already-running server on ${HOST}:${PORT}." >&2
  echo "Stop that server or choose a different PORT so the mobile launcher can start one with a mobile access token." >&2
  exit 1
fi

echo "Starting token-protected Next server on ${HOST}:${PORT}"
pnpm exec next dev -H "$HOST" -p "$PORT" >"/tmp/coven-cave-mobile-${PORT}.log" 2>&1 &
NEXT_PID="$!"
for _ in $(seq 1 40); do
  if port_is_listening >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
if ! port_is_listening >/dev/null 2>&1; then
  echo "Next server did not start. See /tmp/coven-cave-mobile-${PORT}.log" >&2
  kill "$NEXT_PID" >/dev/null 2>&1 || true
  exit 1
fi

tailscale_cmd serve --bg "$PORT"

echo
echo "CovenCave mobile is available inside your tailnet."
echo "Run this to see the exact URL:"
echo "  tailscale serve status"
echo "Then open that URL with this access query:"
echo "  ?coven_mobile_token=${COVEN_MOBILE_ACCESS_TOKEN}"
echo
tailscale_cmd serve status || true
