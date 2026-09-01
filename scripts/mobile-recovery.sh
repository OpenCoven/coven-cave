#!/usr/bin/env bash
set -euo pipefail

# Cave mobile transport recovery utility.
#
# Repairs Tailscale Serve drift for the packaged Cave without killing whatever
# process currently owns a stale target port and without printing credentials.
# Pairing authorization remains a separate Cave concern.

PACKAGED_SERVER_SUFFIX="/Applications/CovenCave.app/Contents/Resources/resources/server/server.mjs"
TAILSCALE_BIN="${TAILSCALE_BIN:-tailscale}"
DRY_RUN="${DRY_RUN:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  printf 'mobile-recovery: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

need ps
need lsof
need "$TAILSCALE_BIN"
need node

server_pid="$(
  ps ax -o pid=,command= |
    awk -v suffix="$PACKAGED_SERVER_SUFFIX" 'index($0, suffix) { print $1; exit }'
)"

[ -n "$server_pid" ] || fail "packaged Cave server is not running"

# Read only the non-secret PORT assignment from the process environment. Do not
# print or retain sidecar/mobile tokens.
port="$(
  ps eww -p "$server_pid" |
    tr ' ' '\n' |
    sed -n 's/^PORT=//p' |
    head -1
)"

case "$port" in
  ''|*[!0-9]*) fail "could not determine packaged Cave loopback port" ;;
esac

backend="http://127.0.0.1:${port}"

if ! lsof -nP -a -p "$server_pid" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "packaged Cave process ${server_pid} is not listening on ${backend}"
fi

self_json="$($TAILSCALE_BIN status --self --json 2>/dev/null)" ||
  fail "Tailscale is unavailable, stopped, or signed out"

backend_state="$(
  SELF_JSON="$self_json" python3 - <<'PY'
import json, os
try:
    print(json.loads(os.environ["SELF_JSON"]).get("BackendState", ""))
except Exception:
    print("")
PY
)"

[ "$backend_state" = "Running" ] || fail "Tailscale is not running and authenticated (BackendState=${backend_state:-unknown})"

magic_dns="$(
  SELF_JSON="$self_json" python3 - <<'PY'
import json, os
try:
    data=json.loads(os.environ["SELF_JSON"])
    dns=((data.get("Self") or {}).get("DNSName") or "").strip().rstrip(".")
    print(dns)
except Exception:
    print("")
PY
)"

printf 'mobile-recovery: packaged Cave pid=%s backend=%s\n' "$server_pid" "$backend"

if [ "$DRY_RUN" = "1" ]; then
  printf 'mobile-recovery: dry-run; would publish %s\n' "$backend"
  exit 0
fi

# Reclaim only through the canonical cross-process lease and complete Serve
# inventory. Packaged precedence is granted by this script only after it proves
# the live packaged process and loopback listener above; the helper still
# requires the fixed production port before replacing a healthy dev route.
serve_result=""
if ! serve_result="$(
  node --experimental-strip-types "$ROOT/scripts/mobile-serve-ownership.ts" claim \
    --backend "$backend" --channel packaged
)"; then
  fail "Serve recovery was refused; no route changed (${serve_result:-no result})"
fi
case "$serve_result" in
  *'"kind":"owned"'*)
    printf 'mobile-recovery: Serve already belongs to %s\n' "$backend"
    ;;
  *'"kind":"claimed"'*)
    printf 'mobile-recovery: recovered and verified Serve -> %s\n' "$backend"
    ;;
  *)
    fail "Serve recovery returned an unexpected result (${serve_result})"
    ;;
esac

if [ -n "$magic_dns" ]; then
  printf 'mobile-recovery: endpoint=https://%s/\n' "$magic_dns"
fi

printf 'mobile-recovery: transport healthy; pairing authorization is unchanged\n'
