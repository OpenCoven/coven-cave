#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
TAILSCALE_TIMEOUT_MS="${TAILSCALE_TIMEOUT_MS:-8000}"
ACCESS_TOKEN="${COVEN_CAVE_ACCESS_TOKEN:-}"

case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "Refusing HOST=${HOST}; mobile Tailscale mode must keep Next.js bound to loopback." >&2
    exit 1
    ;;
esac

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

port_is_listening() {
  node -e "const net=require('net');const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$HOST" "$PORT"
}

backend_url() {
  if [ "$HOST" = "::1" ]; then
    printf 'http://[::1]:%s' "$PORT"
  else
    printf 'http://%s:%s' "$HOST" "$PORT"
  fi
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

if [ -z "$ACCESS_TOKEN" ]; then
  ACCESS_TOKEN="$(node -e "console.log(require(\"node:crypto\").randomBytes(32).toString(\"base64url\"))")"
fi

if ! tailscale_cmd status --self >/dev/null 2>&1; then
  echo "tailscale is not connected or did not respond. Run: tailscale up" >&2
  exit 1
fi

if port_is_listening >/dev/null 2>&1; then
  echo "Refusing to publish an already-running server on ${HOST}:${PORT}." >&2
  echo "Stop it first so this script can start CovenCave with COVEN_CAVE_ACCESS_TOKEN set." >&2
  exit 1
else
  echo "Starting Next server on ${HOST}:${PORT}"
  COVEN_CAVE_ACCESS_TOKEN="$ACCESS_TOKEN" pnpm exec next dev -H "$HOST" -p "$PORT" >"/tmp/coven-cave-mobile-${PORT}.log" 2>&1 &
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
  sleep 0.25
fi
if ! port_is_listening >/dev/null 2>&1; then
  echo "Next server did not start. See /tmp/coven-cave-mobile-${PORT}.log" >&2
  kill "$NEXT_PID" >/dev/null 2>&1 || true
  exit 1
fi

TAILSCALE_BACKEND="$(backend_url)"
tailscale_cmd serve --bg "$TAILSCALE_BACKEND"

echo
echo "CovenCave mobile is available inside your tailnet."
echo "Creating a short-lived mobile invite URL..."
node - "$HOST" "$PORT" "$ACCESS_TOKEN" <<'NODE'
(async () => {
  const [host, port, accessToken] = process.argv.slice(2);
  const base = host === "::1"
    ? `http://[::1]:${port}`
    : `http://${host}:${port}`;

  const res = await fetch(`${base}/api/mobile-handoff`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "start" }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "invalid response" }));
  if (!json.ok) {
    console.error(json.stderr || json.error || "failed to create mobile invite");
    process.exit(1);
  }
  console.log("Open this URL on your phone:");
  console.log(`  ${json.url}`);
  console.log(`Expires: ${json.expiresAtIso}`);
  console.log("The invite is stored as an HTTP-only cookie after the first successful request.");
})().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
NODE
echo "Run this to see the base Serve URL:"
echo "  tailscale serve status --json"
echo
tailscale_cmd serve status || true
