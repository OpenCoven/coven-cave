#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

COMMAND="${1:-start}"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
TAILSCALE_TIMEOUT_MS="${TAILSCALE_TIMEOUT_MS:-8000}"
PRINT_URL="${PRINT_URL:-0}"
COPY_INVITE="${COPY_INVITE:-1}"
USE_TMUX="${USE_TMUX:-1}"

if [ -d "$HOME/.cargo/bin" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

STATE_ROOT="${COVEN_CAVE_MOBILE_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/coven-cave}"
STATE_DIR="${COVEN_CAVE_MOBILE_STATE_DIR:-$STATE_ROOT/mobile-tailscale-${PORT}}"
TOKEN_FILE="$STATE_DIR/access-token"
SIDECAR_TOKEN_FILE="$STATE_DIR/sidecar-auth-token"
PID_FILE="$STATE_DIR/next.pid"
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

require_recorded_server() {
  if recorded_server_is_running; then
    return 0
  fi

  echo "Refusing to contact an untracked server on ${HOST}:${PORT}. Run: pnpm mobile:tailscale:stop && pnpm mobile:tailscale" >&2
  exit 1
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

tailscale_capture() {
  node - "$TAILSCALE_TIMEOUT_MS" "$@" <<'NODE'
const { spawnSync } = require("node:child_process");

const [timeoutMsRaw, ...args] = process.argv.slice(2);
const timeout = Number(timeoutMsRaw);
const res = spawnSync("tailscale", args, {
  encoding: "utf8",
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
  need tailscale
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

  if [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
    # Native iOS app: keep the mobile ACCESS gate open (Tailscale Serve proxies to
    # loopback, so the host gate already passes) but DO set the persisted sidecar
    # auth token from our file so /api/ is authenticated and the in-app
    # SidecarAuthMonitor is satisfied. The matching token reaches the webview via
    # ?covenCaveToken= in CAVE_MOBILE_DEV_URL. Read from the file (ignoring any
    # inherited COVEN_CAVE_AUTH_TOKEN) so the env can't smuggle a mismatched value.
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'unset COVEN_CAVE_ACCESS_TOKEN; export COVEN_CAVE_AUTH_TOKEN=\"\$(cat \"$SIDECAR_TOKEN_FILE\")\"; exec pnpm exec next dev -H \"$HOST\" -p \"$PORT\" >>\"$LOG_FILE\" 2>&1'"
  else
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'COVEN_CAVE_ACCESS_TOKEN=\"\$(cat \"$TOKEN_FILE\")\" exec pnpm exec next dev -H \"$HOST\" -p \"$PORT\" >>\"$LOG_FILE\" 2>&1'"
  fi
  tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' >"$PID_FILE"
}

start_with_nohup() {
  if [ "${CAVE_MOBILE_NATIVE:-0}" = "1" ]; then
    # Native iOS app: ACCESS gate stays open (loopback host), but set the sidecar
    # auth token so /api/ is authenticated. See start_with_tmux for the rationale.
    COVEN_CAVE_AUTH_TOKEN="$SIDECAR_AUTH_TOKEN" nohup env -u COVEN_CAVE_ACCESS_TOKEN pnpm exec next dev -H "$HOST" -p "$PORT" >"$LOG_FILE" 2>&1 </dev/null &
  else
    nohup env COVEN_CAVE_ACCESS_TOKEN="$ACCESS_TOKEN" pnpm exec next dev -H "$HOST" -p "$PORT" >"$LOG_FILE" 2>&1 </dev/null &
  fi
  echo "$!" >"$PID_FILE"
}

start_next_server() {
  need pnpm
  need node

  if port_is_listening >/dev/null 2>&1; then
    ensure_state_dir
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

  if [ "${CAVE_MOBILE_NATIVE:-0}" != "1" ]; then
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

invite_command() {
  create_invite
  copy_invite_to_clipboard
  print_invite_summary
}

status_command() {
  ensure_state_dir
  if port_is_listening >/dev/null 2>&1; then
    echo "CovenCave mobile server: running on ${HOST}:${PORT}"
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
}

stop_command() {
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$TMUX_SESSION"
    echo "Stopped tmux session: ${TMUX_SESSION}"
  fi

  if [ -s "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      echo "Stopped pid: ${pid}"
    fi
  fi

  if command -v tailscale >/dev/null 2>&1; then
    tailscale_cmd serve reset >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE" "$INVITE_FILE" "$EXPIRES_FILE"
  echo "CovenCave mobile Tailscale state stopped."
}

case "$COMMAND" in
  start) start_command ;;
  invite) invite_command ;;
  native) native_command ;;
  status) status_command ;;
  stop) stop_command ;;
  *)
    echo "Usage: pnpm mobile:tailscale[:invite|:native|:status|:stop]" >&2
    echo "       bash scripts/mobile-tailscale.sh {start|invite|native|status|stop}" >&2
    exit 2
    ;;
esac
