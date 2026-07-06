#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
SELF="$PWD/scripts/mobile-tailscale.sh"

COMMAND="${1:-start}"
# Captured before defaulting: an explicit PORT= (or state-dir) override opts out
# of the automatic port sidestep/adoption below.
PORT_WAS_SET="${PORT+1}"
STATE_DIR_WAS_SET="${COVEN_CAVE_MOBILE_STATE_DIR+1}"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
TAILSCALE_TIMEOUT_MS="${TAILSCALE_TIMEOUT_MS:-8000}"
PRINT_URL="${PRINT_URL:-0}"
COPY_INVITE="${COPY_INVITE:-1}"
USE_TMUX="${USE_TMUX:-1}"
TAILSCALE_BIN="${TAILSCALE_BIN:-tailscale}"

if [ -d "$HOME/.cargo/bin" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

STATE_ROOT="${COVEN_CAVE_MOBILE_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/coven-cave}"
STATE_DIR="${COVEN_CAVE_MOBILE_STATE_DIR:-$STATE_ROOT/mobile-tailscale-${PORT}}"
TOKEN_FILE="$STATE_DIR/access-token"
SIDECAR_TOKEN_FILE="$STATE_DIR/sidecar-auth-token"
PID_FILE="$STATE_DIR/next.pid"
MODE_FILE="$STATE_DIR/server.mode"
INVITE_FILE="$STATE_DIR/invite.url"
EXPIRES_FILE="$STATE_DIR/invite.expires"
LOG_FILE="${COVEN_CAVE_MOBILE_LOG:-$STATE_DIR/next.log}"
TMUX_SESSION="${COVEN_CAVE_MOBILE_TMUX_SESSION:-coven-cave-mobile-${PORT}}"

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

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
}

port_is_listening_at() {
  node -e "const net=require('net');const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$HOST" "$1"
}

port_is_listening() {
  port_is_listening_at "$PORT"
}

backend_url() {
  if [ "$HOST" = "::1" ]; then
    printf 'http://[::1]:%s' "$PORT"
  else
    printf 'http://%s:%s' "$HOST" "$PORT"
  fi
}

recorded_server_is_running() {
  if [ ! -s "$PID_FILE" ]; then
    return 1
  fi

  pid="$(cat "$PID_FILE")"
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac

  kill -0 "$pid" >/dev/null 2>&1
}

describe_port_occupant() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print "  in use by: pid " $2 " (" $1 ")"}' | sort -u || true
}

# Next.js allows only one dev server per project directory (dev singleton), so
# when the occupant runs from THIS checkout a fallback port cannot help — the
# second `next dev` refuses to boot no matter which port it gets.
occupant_is_this_checkout() {
  command -v lsof >/dev/null 2>&1 || return 1
  local pid cwd
  for pid in $(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [ "$cwd" = "$PWD" ]; then
      OCCUPANT_PID="$pid"
      return 0
    fi
  done
  return 1
}

require_recorded_server() {
  if recorded_server_is_running; then
    return 0
  fi

  echo "Refusing to contact an untracked server on ${HOST}:${PORT} — this script did not start it, so 'stop' cannot free it." >&2
  describe_port_occupant "$PORT" >&2
  echo "Stop that process yourself, or run on a free port: PORT=$((PORT + 1)) pnpm mobile:tailscale" >&2
  exit 1
}

find_free_port() {
  local candidate
  for candidate in $(seq $((PORT + 1)) $((PORT + 20))); do
    if ! port_is_listening_at "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Servers this script starts are tracked in per-port state dirs. When the
# default port is squatted by a server it did not start (another session's dev
# server, a stale corpse), never touch that server — sidestep to a free port
# instead. Explicit PORT= / state-dir overrides opt out and hit the
# require_recorded_server refusal with the occupant named.
maybe_fallback_port() {
  if [ -n "${PORT_WAS_SET}${STATE_DIR_WAS_SET}" ]; then
    return 0
  fi
  if ! port_is_listening >/dev/null 2>&1; then
    return 0
  fi
  if recorded_server_is_running; then
    return 0
  fi

  if occupant_is_this_checkout; then
    echo "Port ${PORT} is held by a server running from this same checkout (pid ${OCCUPANT_PID}) that this script did not start." >&2
    echo "Next.js allows one dev server per checkout, so starting the mobile server on another port will not work either." >&2
    echo "If that server is expendable: kill ${OCCUPANT_PID}   then rerun: pnpm mobile:tailscale" >&2
    exit 1
  fi

  local free
  if ! free="$(find_free_port)"; then
    echo "Port ${PORT} is in use by an untracked server and no free port was found in $((PORT + 1))-$((PORT + 20))." >&2
    describe_port_occupant "$PORT" >&2
    exit 1
  fi

  echo "Port ${PORT} is in use by a server this script did not start; leaving it alone."
  describe_port_occupant "$PORT"
  echo "Starting on ${HOST}:${free} instead — invite/status/stop find it automatically."
  exec env PORT="$free" bash "$SELF" "$COMMAND"
}

# Default-port invite/status/start adopt the single live instance this script
# already runs on a fallback port, so companion commands keep working without
# an explicit PORT=.
resolve_active_port() {
  if [ -n "${PORT_WAS_SET}${STATE_DIR_WAS_SET}" ]; then
    return 0
  fi
  if recorded_server_is_running; then
    return 0
  fi

  local live="" dir port pid
  for dir in "$STATE_ROOT"/mobile-tailscale-*; do
    [ -d "$dir" ] || continue
    port="${dir##*mobile-tailscale-}"
    case "$port" in ''|*[!0-9]*) continue ;; esac
    [ -s "$dir/next.pid" ] || continue
    pid="$(cat "$dir/next.pid")"
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    kill -0 "$pid" >/dev/null 2>&1 || continue
    if [ -n "$live" ] && [ "$live" != "$port" ]; then
      # More than one live instance: ambiguous, keep the requested port.
      return 0
    fi
    live="$port"
  done

  if [ -z "$live" ] || [ "$live" = "$PORT" ]; then
    return 0
  fi
  exec env PORT="$live" bash "$SELF" "$COMMAND"
}

write_server_mode() {
  ensure_state_dir
  printf '%s\n' "$1" >"$MODE_FILE"
  chmod 600 "$MODE_FILE"
}

recorded_server_mode_is() {
  [ -s "$MODE_FILE" ] && [ "$(cat "$MODE_FILE")" = "$1" ]
}

clear_mobile_tokens() {
  rm -f "$TOKEN_FILE" "$SIDECAR_TOKEN_FILE"
}

tailscale_cmd() {
  node - "$TAILSCALE_TIMEOUT_MS" "$TAILSCALE_BIN" "$@" <<'NODE'
const { spawnSync } = require("node:child_process");

const [timeoutMsRaw, bin, ...args] = process.argv.slice(2);
const timeout = Number(timeoutMsRaw);
const res = spawnSync(bin, args, {
  stdio: "inherit",
  timeout: Number.isFinite(timeout) ? timeout : 8000,
});

if (res.error?.code === "ETIMEDOUT") {
  console.error(`${bin} ${args.join(" ")} timed out`);
  process.exit(124);
}
if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
NODE
}

tailscale_capture() {
  node - "$TAILSCALE_TIMEOUT_MS" "$TAILSCALE_BIN" "$@" <<'NODE'
const { spawnSync } = require("node:child_process");

const [timeoutMsRaw, bin, ...args] = process.argv.slice(2);
const timeout = Number(timeoutMsRaw);
const res = spawnSync(bin, args, {
  encoding: "utf8",
  timeout: Number.isFinite(timeout) ? timeout : 8000,
});

if (res.error?.code === "ETIMEDOUT") {
  console.error(`${bin} ${args.join(" ")} timed out`);
  process.exit(124);
}
if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
if (res.stderr) process.stderr.write(res.stderr);
if (res.stdout) process.stdout.write(res.stdout);
process.exit(res.status ?? 1);
NODE
}

masked_serve_status() {
  tailscale_cmd serve status 2>/dev/null |
    sed -E 's#https://[^ ]+#https://[tailscale-host-redacted]#g; s#coven_access_token=[^[:space:]&]+#coven_access_token=[redacted]#g' ||
    true
}

warn_if_serve_targets_other_backend() {
  if ! command -v "$TAILSCALE_BIN" >/dev/null 2>&1; then
    return 0
  fi

  local status_json
  if ! status_json="$(tailscale_capture serve status --json 2>/dev/null)"; then
    return 0
  fi

  node - "$(backend_url)" "$status_json" <<'NODE'
const [expectedBackend, input] = process.argv.slice(2);
let status;
try {
  status = JSON.parse(input);
} catch {
  process.exit(0);
}

const handlers = Object.values(status?.Web ?? {}).flatMap((config) =>
  Object.values(config?.Handlers ?? {}),
);
const proxies = handlers.map((handler) => handler?.Proxy).filter(Boolean);
if (proxies.length > 0 && !proxies.includes(expectedBackend)) {
  console.error(`Warning: Tailscale Serve is not pointing at ${expectedBackend}; current proxy target: ${proxies.join(", ")}`);
}
NODE
}

load_or_create_token() {
  ensure_state_dir

  if [ -n "${COVEN_CAVE_ACCESS_TOKEN:-}" ]; then
    printf '%s' "$COVEN_CAVE_ACCESS_TOKEN" >"$TOKEN_FILE"
  elif [ ! -s "$TOKEN_FILE" ]; then
    node -e "console.log(require(\"node:crypto\").randomBytes(32).toString(\"base64url\"))" >"$TOKEN_FILE"
  fi

  chmod 600 "$TOKEN_FILE"
  ACCESS_TOKEN="$(cat "$TOKEN_FILE")"
  export ACCESS_TOKEN
}

# Sidecar auth token for the native iOS app (persisted per state dir / running server). Distinct from the mobile
# ACCESS token above: this one populates COVEN_CAVE_AUTH_TOKEN, which gates /api/ (proxy.ts) and which the
# in-app SidecarAuthBridge expects via ?covenCaveToken=. Stored in its own file so the access-token reuse guards
# stay independent.
load_or_create_sidecar_token() {
  ensure_state_dir
  if [ ! -s "$SIDECAR_TOKEN_FILE" ]; then
    node -e "console.log(require(\"node:crypto\").randomBytes(32).toString(\"base64url\"))" >"$SIDECAR_TOKEN_FILE"
  fi
  chmod 600 "$SIDECAR_TOKEN_FILE"
  SIDECAR_AUTH_TOKEN="$(cat "$SIDECAR_TOKEN_FILE")"
  export SIDECAR_AUTH_TOKEN
}

ensure_tailscale() {
  need node
  need "$TAILSCALE_BIN"
  if ! tailscale_cmd status --self >/dev/null 2>&1; then
    echo "tailscale is not connected or did not respond. Run: tailscale up" >&2
    exit 1
  fi
}

wait_for_server() {
  for _ in $(seq 1 80); do
    if port_is_listening >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_with_tmux() {
  need tmux
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$TMUX_SESSION"
  fi

  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # Native SwiftUI app over Tailscale: NO token at all. Tailscale Serve is the
    # only ingress to loopback:${PORT} and the proxy's CSRF Origin/Referer gate
    # still blocks any drive-by browser request (those always carry an Origin);
    # a native client sends none, so it passes the gate, and with neither
    # COVEN_CAVE_ACCESS_TOKEN nor COVEN_CAVE_AUTH_TOKEN set (and not bundled) the
    # /api/ proxy falls through to NextResponse.next(). COVEN_CAVE_TAILNET_TRUST=1
    # relaxes the loopback host gate because Tailscale Serve forwards the
    # <host>.ts.net Host (not 127.0.0.1). Tailnet membership is the trust
    # boundary — see docs/ios-native-rebuild.md.
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'unset COVEN_CAVE_ACCESS_TOKEN COVEN_CAVE_AUTH_TOKEN COVEN_CAVE_BUNDLE; export COVEN_CAVE_TAILNET_TRUST=1 HOSTNAME=\"$HOST\" PORT=\"$PORT\"; exec pnpm dev >>\"$LOG_FILE\" 2>&1'"
    tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' >"$PID_FILE"
    return 0
  fi

  if [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
    # Native iOS app: keep the mobile ACCESS gate open (Tailscale Serve proxies to
    # loopback, so the host gate already passes) but DO set the persisted sidecar
    # auth token from our file so /api/ is authenticated and the in-app
    # SidecarAuthMonitor is satisfied. The matching token reaches the webview via
    # ?covenCaveToken= in CAVE_MOBILE_DEV_URL. Read from the file (ignoring any
    # inherited COVEN_CAVE_AUTH_TOKEN) so the env can't smuggle a mismatched value.
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'unset COVEN_CAVE_ACCESS_TOKEN; export COVEN_CAVE_AUTH_TOKEN=\"\$(cat \"$SIDECAR_TOKEN_FILE\")\" HOSTNAME=\"$HOST\" PORT=\"$PORT\"; exec pnpm dev >>\"$LOG_FILE\" 2>&1'"
  else
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'COVEN_CAVE_ACCESS_TOKEN=\"\$(cat \"$TOKEN_FILE\")\" HOSTNAME=\"$HOST\" PORT=\"$PORT\" exec pnpm dev >>\"$LOG_FILE\" 2>&1'"
  fi
  tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' >"$PID_FILE"
}

start_with_nohup() {
  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # Tokenless native-app server. See start_with_tmux for the trust rationale.
    nohup env -u COVEN_CAVE_ACCESS_TOKEN -u COVEN_CAVE_AUTH_TOKEN -u COVEN_CAVE_BUNDLE \
      COVEN_CAVE_TAILNET_TRUST=1 \
      HOSTNAME="$HOST" \
      PORT="$PORT" \
      pnpm dev >"$LOG_FILE" 2>&1 </dev/null &
    echo "$!" >"$PID_FILE"
    return 0
  fi

  if [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
    # Native iOS app: ACCESS gate stays open (loopback host), but set the sidecar
    # auth token so /api/ is authenticated. See start_with_tmux for the rationale.
    COVEN_CAVE_AUTH_TOKEN="$SIDECAR_AUTH_TOKEN" HOSTNAME="$HOST" PORT="$PORT" nohup env -u COVEN_CAVE_ACCESS_TOKEN pnpm dev >"$LOG_FILE" 2>&1 </dev/null &
  else
    nohup env COVEN_CAVE_ACCESS_TOKEN="$ACCESS_TOKEN" HOSTNAME="$HOST" PORT="$PORT" pnpm dev >"$LOG_FILE" 2>&1 </dev/null &
  fi
  echo "$!" >"$PID_FILE"
}

start_next_server() {
  need pnpm
  need node

  if port_is_listening >/dev/null 2>&1; then
    ensure_state_dir
    if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
      if recorded_server_is_running && recorded_server_mode_is app; then
        clear_mobile_tokens
        echo "CovenCave native-app server is already listening on ${HOST}:${PORT}."
        return 0
      fi
      # Refuse to reuse a token-gated or untracked server under tokenless app mode.
      if [ -n "${COVEN_CAVE_ACCESS_TOKEN:-}" ] || [ -s "$TOKEN_FILE" ] || [ -s "$SIDECAR_TOKEN_FILE" ]; then
        echo "Error: port ${PORT} is already in use by a token-gated server. Run 'pnpm mobile:tailscale:stop' first." >&2
        exit 1
      fi
      require_recorded_server
      echo "CovenCave native-app server is already listening on ${HOST}:${PORT}."
      return 0
    fi
    if [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
      # Refuse to reuse a server that may be token-gated from a prior non-native start.
      if [ -n "${COVEN_CAVE_ACCESS_TOKEN:-}" ] || [ -s "$TOKEN_FILE" ]; then
        echo "Error: port ${PORT} is already in use by a token-gated server. Run 'pnpm mobile:tailscale:stop' first." >&2
        exit 1
      fi
      # Reuse only works if the running server holds this sidecar token; load it
      # so native_command can hand the matching value to the webview.
      load_or_create_sidecar_token
      echo "CovenCave native mobile server is already listening on ${HOST}:${PORT}."
      return 0
    fi
    require_recorded_server
    load_or_create_token
    echo "CovenCave mobile server is already listening on ${HOST}:${PORT}."
    return 0
  fi

  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # tokenless app mode: do not mint or load any token, and clear stale tokens
    # from invite/native runs so future app-mode reuse is judged by server.mode.
    clear_mobile_tokens
  elif [ "${CAVE_MOBILE_NATIVE:-0}" != "1" ]; then
    load_or_create_token
  else
    load_or_create_sidecar_token
  fi
  : >"$LOG_FILE"
  echo "Starting Next server on ${HOST}:${PORT}"
  if [ "$USE_TMUX" = "1" ] && command -v tmux >/dev/null 2>&1; then
    start_with_tmux
    echo "Server is running in tmux session: ${TMUX_SESSION}"
  else
    start_with_nohup
    echo "Server is running as background pid: $(cat "$PID_FILE")"
  fi
  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    write_server_mode app
  elif [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
    write_server_mode native
  else
    write_server_mode invite
  fi

  if ! wait_for_server; then
    echo "Next server did not start. See ${LOG_FILE}" >&2
    tail -80 "$LOG_FILE" >&2 || true
    exit 1
  fi
}

serve_url_from_status() {
  node - "$1" "$2" <<'NODE'
const [backendUrl, input] = process.argv.slice(2);

{
  let status;
  try {
    status = JSON.parse(input);
  } catch {
    console.error("invalid tailscale serve status JSON");
    process.exit(1);
  }

  const web = status?.Web;
  if (!web || typeof web !== "object") {
    console.error("tailscale serve status has no Web section");
    process.exit(1);
  }

  for (const [host, config] of Object.entries(web)) {
    const handlers = config?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;

    for (const [path, handler] of Object.entries(handlers)) {
      if (handler?.Proxy !== backendUrl) continue;
      const normalizedHost = host.endsWith(":443") ? host.slice(0, -4) : host;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const suffix = normalizedPath === "/" ? "/" : normalizedPath;
      console.log(`https://${normalizedHost}${suffix}`);
      process.exit(0);
    }
  }

  console.error(`tailscale serve URL not found for ${backendUrl}`);
  process.exit(1);
}
NODE
}

tailscale_ip_host() {
  local self_json
  if ! self_json="$(tailscale_capture status --self --json 2>/dev/null)"; then
    return 1
  fi

  node - "$self_json" <<'NODE'
const input = process.argv[2] || "";
let status;
try {
  status = JSON.parse(input);
} catch {
  process.exit(1);
}
const rawIps = status?.Self?.TailscaleIPs ?? status?.TailscaleIPs;
const ips = Array.isArray(rawIps) ? rawIps.filter((ip) => typeof ip === "string") : [];
const ipv4 = ips.find((ip) => /^100\.\d+\.\d+\.\d+$/.test(ip));
if (!ipv4) process.exit(1);
console.log(ipv4);
NODE
}

resolve_ios_device_name() {
  if [ "${CAVE_MOBILE_DEVICE:-0}" != "1" ]; then
    return 0
  fi

  if [ -n "${CAVE_MOBILE_DEVICE_NAME:-}" ]; then
    printf '%s\n' "$CAVE_MOBILE_DEVICE_NAME"
    return 0
  fi

  need xcrun
  local device_json
  device_json="$(mktemp)"

  if ! xcrun devicectl list devices --json-output "$device_json" >/dev/null; then
    rm -f "$device_json"
    echo "Unable to list iOS devices. Open Xcode, unlock/trust the device, then retry." >&2
    exit 1
  fi

  if ! node - "$device_json" <<'NODE'
const fs = require("node:fs");

const devices = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))?.result?.devices ?? [];
const connected = devices.filter((device) => {
  const props = device.deviceProperties ?? {};
  const hardware = device.hardwareProperties ?? {};
  const connection = device.connectionProperties ?? {};
  return (
    hardware.platform === "iOS" &&
    Boolean(props.name) &&
    connection.tunnelState !== "unavailable" &&
    props.developerModeStatus !== "disabled"
  );
});

if (connected.length === 0) {
  console.error("No connected iOS device found. Unlock/trust the device and enable Developer Mode, or set CAVE_MOBILE_DEVICE_NAME.");
  process.exit(1);
}

console.log(connected[0].deviceProperties.name);
NODE
  then
    rm -f "$device_json"
    exit 1
  fi

  rm -f "$device_json"
}

create_invite() {
  need node
  load_or_create_token
  ensure_tailscale

  if ! port_is_listening >/dev/null 2>&1; then
    echo "CovenCave mobile server is not listening on ${HOST}:${PORT}. Run: pnpm mobile:tailscale" >&2
    exit 1
  fi
  require_recorded_server

  node - "$HOST" "$PORT" "$ACCESS_TOKEN" "$INVITE_FILE" "$EXPIRES_FILE" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const CONTROL_TOKEN_TTL_MS = 2 * 60 * 1000;

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function createMobileAccessToken(secret) {
  const expiresAt = Date.now() + CONTROL_TOKEN_TTL_MS;
  const nonce = crypto.randomUUID();
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${payload}.${base64Url(signature)}`;
}

(async () => {
  const [host, port, accessToken, invitePath, expiresPath] = process.argv.slice(2);
  const base = host === "::1"
    ? `http://[::1]:${port}`
    : `http://${host}:${port}`;

  const res = await fetch(`${base}/api/mobile-handoff`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${createMobileAccessToken(accessToken)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "start" }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "invalid response" }));
  if (!json.ok) {
    console.error(json.stderr || json.error || "failed to create mobile invite");
    process.exit(1);
  }
  fs.writeFileSync(invitePath, `${json.url}\n`, { mode: 0o600 });
  fs.writeFileSync(expiresPath, `${json.expiresAtIso}\n`, { mode: 0o600 });
})().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
NODE

  chmod 600 "$INVITE_FILE" "$EXPIRES_FILE"
}

copy_invite_to_clipboard() {
  if [ "$COPY_INVITE" != "1" ]; then
    return 0
  fi

  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy <"$INVITE_FILE"
    echo "Invite URL copied to the Mac clipboard."
  else
    echo "Clipboard copy skipped: pbcopy is unavailable."
  fi
}

print_invite_summary() {
  echo "Invite stored at: ${INVITE_FILE}"
  if [ -s "$EXPIRES_FILE" ]; then
    echo "Invite expires: $(cat "$EXPIRES_FILE")"
  fi

  if [ "$PRINT_URL" = "1" ]; then
    cat "$INVITE_FILE"
  else
    echo "Raw invite URL suppressed. Set PRINT_URL=1 to print it, or read ${INVITE_FILE} locally."
  fi
}

start_command() {
  ensure_tailscale
  start_next_server
  create_invite
  copy_invite_to_clipboard
  print_invite_summary
  echo
  masked_serve_status
}

native_command() {
  ensure_tailscale
  CAVE_MOBILE_NATIVE=1 start_next_server

  TAILSCALE_BACKEND="$(backend_url)"
  tailscale_cmd serve --bg "$TAILSCALE_BACKEND" >/dev/null

  status_json="$(tailscale_capture serve status --json)"
  CAVE_MOBILE_DEV_URL="$(serve_url_from_status "$TAILSCALE_BACKEND" "$status_json")"
  if [ -z "$CAVE_MOBILE_DEV_URL" ]; then
    echo "Unable to resolve Tailscale Serve URL for ${TAILSCALE_BACKEND}." >&2
    exit 1
  fi

  # Hand the persisted sidecar auth token to the webview via the URL HASH (not a
  # query string). A query string on the dev document URL corrupts Turbopack dev
  # chunk URLs inside the iOS WKWebView — chunk requests resolve to
  # /?covenCaveToken=.../_next/... and the server returns HTML instead of JS, so
  # the app never hydrates and shows a blank shell. The hash is excluded from
  # chunk URL resolution, so it's safe. SidecarAuthBridge reads it from the hash,
  # stores it (sessionStorage), strips it from the visible URL, and attaches it to
  # every /api/ request (x-coven-cave-token header / EventSource covenCaveToken
  # param) so the gated proxy authenticates them.
  CAVE_MOBILE_DEV_URL="$(
    node - "$CAVE_MOBILE_DEV_URL" "$SIDECAR_AUTH_TOKEN" <<'NODE'
const [base, token] = process.argv.slice(2);
const url = new URL(base);
url.hash = new URLSearchParams({ covenCaveToken: token }).toString();
console.log(url.toString());
NODE
  )"
  export CAVE_MOBILE_DEV_URL
  tauri_config="$(
    node - "$CAVE_MOBILE_DEV_URL" <<'NODE'
const devUrl = process.argv[2];
console.log(JSON.stringify({ build: { devUrl, beforeDevCommand: null } }));
NODE
  )"

  echo "Launching CovenCave native iOS app through Tailscale Serve."
  tauri_args=(
    ios
    dev
    --no-dev-server-wait
    --config
    "$tauri_config"
  )
  if [ "${CAVE_MOBILE_DEVICE:-0}" = "1" ]; then
    device_name="$(resolve_ios_device_name)"
    tauri_args+=("$device_name")
  fi
  pnpm exec tauri "${tauri_args[@]}"
}

print_terminal_qr() {
  node - "$1" <<'NODE' 2>/dev/null || true
const url = process.argv[2];
try {
  require("qrcode").toString(url, { type: "terminal", small: true }, (err, str) => {
    if (!err && str) process.stdout.write(str);
  });
} catch {}
NODE
}

# Tokenless native SwiftUI app over Tailscale Serve. Starts a loopback Next
# server with NO access/sidecar token, publishes it via `tailscale serve`, and
# prints the host to type into the iOS app. There is no invite/token to copy —
# tailnet membership is the trust boundary. See docs/ios-native-rebuild.md.
app_command() {
  ensure_tailscale
  CAVE_MOBILE_APP=1 start_next_server

  TAILSCALE_BACKEND="$(backend_url)"
  APP_URL=""
  if tailscale_cmd serve --bg "$TAILSCALE_BACKEND" >/dev/null 2>&1; then
    status_json="$(tailscale_capture serve status --json)"
    APP_URL="$(serve_url_from_status "$TAILSCALE_BACKEND" "$status_json" 2>/dev/null || true)"
  fi
  if [ -z "$APP_URL" ]; then
    APP_IP_HOST="$(tailscale_ip_host)"
    tailscale_cmd serve --bg --http="$PORT" "$TAILSCALE_BACKEND" >/dev/null
    APP_URL="http://${APP_IP_HOST}:${PORT}/"
  fi

  APP_HOST="$(node -e "process.stdout.write(new URL(process.argv[1]).host)" "$APP_URL")"

  echo
  echo "Native iOS app is ready — no token required."
  echo "In the Coven Cave app, enter this address:"
  echo
  echo "    ${APP_HOST}"
  echo
  print_terminal_qr "$APP_URL"
  echo
  echo "Stop with: pnpm mobile:tailscale:stop"
  echo
  masked_serve_status
}

invite_command() {
  create_invite
  copy_invite_to_clipboard
  print_invite_summary
}

status_command() {
  ensure_state_dir
  if port_is_listening >/dev/null 2>&1; then
    if recorded_server_is_running; then
      echo "CovenCave mobile server: running on ${HOST}:${PORT} (pid $(cat "$PID_FILE"))"
    else
      echo "CovenCave mobile server: not running. ${HOST}:${PORT} is in use by a server this script does not track."
      describe_port_occupant "$PORT"
    fi
  else
    echo "CovenCave mobile server: not listening on ${HOST}:${PORT}"
  fi
  echo "State directory: ${STATE_DIR}"
  echo "Log file: ${LOG_FILE}"
  if [ -s "$PID_FILE" ]; then
    echo "Recorded pid: $(cat "$PID_FILE")"
  fi
  if [ -s "$EXPIRES_FILE" ]; then
    echo "Last invite expires: $(cat "$EXPIRES_FILE")"
  fi
  masked_serve_status
  warn_if_serve_targets_other_backend
}

stop_instance() {
  local dir="$1" session="$2" pid_file pid
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$session" 2>/dev/null; then
    tmux kill-session -t "$session"
    echo "Stopped tmux session: ${session}"
  fi

  pid_file="$dir/next.pid"
  if [ -s "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    case "$pid" in
      ''|*[!0-9]*) ;;
      *)
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill "$pid" >/dev/null 2>&1 || true
          echo "Stopped pid: ${pid}"
        fi
        ;;
    esac
  fi

  rm -f "$dir/next.pid" "$dir/invite.url" "$dir/invite.expires" "$dir/server.mode"
}

stop_command() {
  stop_instance "$STATE_DIR" "$TMUX_SESSION"

  # Sweep sibling per-port instances so a server started on a fallback port
  # (see maybe_fallback_port) is not stranded by a default-port stop.
  local dir port
  for dir in "$STATE_ROOT"/mobile-tailscale-*; do
    [ -d "$dir" ] || continue
    [ "$dir" = "$STATE_DIR" ] && continue
    port="${dir##*mobile-tailscale-}"
    case "$port" in ''|*[!0-9]*) continue ;; esac
    stop_instance "$dir" "coven-cave-mobile-${port}"
  done

  if command -v "$TAILSCALE_BIN" >/dev/null 2>&1; then
    tailscale_cmd serve reset >/dev/null 2>&1 || true
  fi
  echo "CovenCave mobile Tailscale state stopped."
}

case "$COMMAND" in
  start) resolve_active_port; maybe_fallback_port; start_command ;;
  invite) resolve_active_port; invite_command ;;
  native) resolve_active_port; maybe_fallback_port; native_command ;;
  app) resolve_active_port; maybe_fallback_port; app_command ;;
  status) resolve_active_port; status_command ;;
  stop) stop_command ;;
  *)
    echo "Usage: pnpm mobile:tailscale[:invite|:native|:app|:status|:stop]" >&2
    echo "       bash scripts/mobile-tailscale.sh {start|invite|native|app|status|stop}" >&2
    exit 2
    ;;
esac
