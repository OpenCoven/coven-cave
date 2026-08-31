#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
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
SERVE_OWNERSHIP_HELPER="${COVEN_CAVE_SERVE_OWNERSHIP_HELPER:-$PWD/scripts/mobile-serve-ownership.ts}"
PROCESS_OWNERSHIP_HELPER="${COVEN_CAVE_PROCESS_OWNERSHIP_HELPER:-$PWD/scripts/mobile-process-ownership.ts}"

if [ -d "$HOME/.cargo/bin" ]; then
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
fi

STATE_ROOT="${COVEN_CAVE_MOBILE_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/coven-cave}"
STATE_DIR="${COVEN_CAVE_MOBILE_STATE_DIR:-$STATE_ROOT/mobile-tailscale-${PORT}}"
TOKEN_FILE="$STATE_DIR/access-token"
SIDECAR_TOKEN_FILE="$STATE_DIR/sidecar-auth-token"
OWNER_FILE="$STATE_DIR/next.owner.json"
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

process_owner_cmd() {
  node --experimental-strip-types "$PROCESS_OWNERSHIP_HELPER" "$@"
}

process_owner_field() {
  process_owner_cmd field --state "$1" --name "$2"
}

record_process_owner() {
  local pid="$1"
  process_owner_cmd record \
    --state "$OWNER_FILE" \
    --pid "$pid" \
    --backend "$(backend_url)"
}

recorded_process_is_running() {
  process_owner_cmd matches --state "$1" >/dev/null 2>&1
}

recorded_server_is_running() {
  recorded_process_is_running "$OWNER_FILE"
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

wait_for_port_to_clear() {
  local port="${1:-$PORT}"
  for _ in $(seq 1 40); do
    if ! port_is_listening_at "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

take_over_same_checkout_server_for_app() {
  if [ "$COMMAND" != "app" ]; then
    return 1
  fi
  if ! occupant_is_this_checkout; then
    return 1
  fi

  echo "Taking over untracked same-checkout dev server on ${HOST}:${PORT} (pid ${OCCUPANT_PID}) for native app mode."
  kill "$OCCUPANT_PID" >/dev/null 2>&1 || true
  if ! wait_for_port_to_clear "$PORT"; then
    echo "Port ${PORT} is still in use after stopping pid ${OCCUPANT_PID}." >&2
    describe_port_occupant "$PORT" >&2
    exit 1
  fi
  rm -f "$OWNER_FILE" "$MODE_FILE"
  return 0
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

  if take_over_same_checkout_server_for_app; then
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
    local recorded_host
    recorded_host="$(process_owner_field "$OWNER_FILE" host)" || return 0
    if [ "$recorded_host" != "$HOST" ]; then
      exec env PORT="$PORT" HOST="$recorded_host" bash "$SELF" "$COMMAND"
    fi
    return 0
  fi

  local live="" live_host="" dir port host
  for dir in "$STATE_ROOT"/mobile-tailscale-*; do
    [ -d "$dir" ] || continue
    recorded_process_is_running "$dir/next.owner.json" || continue
    port="$(process_owner_field "$dir/next.owner.json" port)" || continue
    host="$(process_owner_field "$dir/next.owner.json" host)" || continue
    if [ -n "$live" ] && [ "$live" != "$port" ]; then
      # More than one live instance: ambiguous, keep the requested port.
      return 0
    fi
    live="$port"
    live_host="$host"
  done

  if [ -z "$live" ] || { [ "$live" = "$PORT" ] && [ "$live_host" = "$HOST" ]; }; then
    return 0
  fi
  exec env PORT="$live" HOST="$live_host" bash "$SELF" "$COMMAND"
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
  rm -f "$INVITE_FILE" "$EXPIRES_FILE"
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

# Legacy stale-state sentinel: SIDECAR_TOKEN_FILE was written by older builds that ran a sidecar-gated server
# (populating COVEN_CAVE_AUTH_TOKEN / SidecarAuthBridge). That mode and load_or_create_sidecar_token have been
# removed. The file is now only a detection marker — its presence is checked by the app-mode guard in
# start_next_server to reject a port already occupied by an older-style run — and is deleted on app-mode start
# and on stop.
ensure_tailscale() {
  need node
  need "$TAILSCALE_BIN"
  if ! tailscale_cmd status --self >/dev/null 2>&1; then
    echo "tailscale is not connected or did not respond. Run: tailscale up" >&2
    exit 1
  fi
}

server_logged_ready() {
  grep -F "> Ready on $(backend_url)" "$LOG_FILE" >/dev/null 2>&1
}

wait_for_server() {
  for _ in $(seq 1 80); do
    if recorded_server_is_running && port_is_listening >/dev/null 2>&1 && server_logged_ready; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_with_tmux() {
  local pid
  need tmux
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux kill-session -t "$TMUX_SESSION"
  fi

  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # Native SwiftUI app over Tailscale: protect the full API surface with the
    # same mobile access token used by invite mode. Tailscale membership is not
    # sufficient authorization because Serve exposes every /api route.
    tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
      "bash -lc 'unset COVEN_CAVE_AUTH_TOKEN COVEN_CAVE_BUNDLE COVEN_CAVE_TAILNET_TRUST; export COVEN_CAVE_ACCESS_TOKEN=\"\$(cat \"$TOKEN_FILE\")\" HOSTNAME=\"$HOST\" PORT=\"$PORT\"; exec pnpm dev >>\"$LOG_FILE\" 2>&1'"
    pid="$(tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}')"
    if ! record_process_owner "$pid"; then
      tmux kill-session -t "$TMUX_SESSION" >/dev/null 2>&1 || true
      rm -f "$OWNER_FILE"
      echo "Could not record the started server process identity; stopped it rather than leaving unsafe PID state." >&2
      return 1
    fi
    return 0
  fi

  tmux new-session -d -s "$TMUX_SESSION" -c "$PWD" \
    "bash -lc 'COVEN_CAVE_ACCESS_TOKEN=\"\$(cat \"$TOKEN_FILE\")\" HOSTNAME=\"$HOST\" PORT=\"$PORT\" exec pnpm dev >>\"$LOG_FILE\" 2>&1'"
  pid="$(tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}')"
  if ! record_process_owner "$pid"; then
    tmux kill-session -t "$TMUX_SESSION" >/dev/null 2>&1 || true
    rm -f "$OWNER_FILE"
    echo "Could not record the started server process identity; stopped it rather than leaving unsafe PID state." >&2
    return 1
  fi
}

start_with_nohup() {
  local pid
  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # Token-gated native-app server. See start_with_tmux for the trust rationale.
    nohup env -u COVEN_CAVE_AUTH_TOKEN -u COVEN_CAVE_BUNDLE -u COVEN_CAVE_TAILNET_TRUST \
      COVEN_CAVE_ACCESS_TOKEN="$ACCESS_TOKEN" \
      HOSTNAME="$HOST" \
      PORT="$PORT" \
      pnpm dev >"$LOG_FILE" 2>&1 </dev/null &
    pid="$!"
    if ! record_process_owner "$pid"; then
      rm -f "$OWNER_FILE"
      echo "Could not record the started server process identity; refusing to signal an unverified PID. Inspect pid ${pid} manually." >&2
      return 1
    fi
    return 0
  fi

  nohup env COVEN_CAVE_ACCESS_TOKEN="$ACCESS_TOKEN" HOSTNAME="$HOST" PORT="$PORT" pnpm dev >"$LOG_FILE" 2>&1 </dev/null &
  pid="$!"
  if ! record_process_owner "$pid"; then
    rm -f "$OWNER_FILE"
    echo "Could not record the started server process identity; refusing to signal an unverified PID. Inspect pid ${pid} manually." >&2
    return 1
  fi
}

start_next_server() {
  need pnpm
  need node
  if ! process_owner_cmd token --pid "$$" >/dev/null; then
    echo "Kernel-resolution process identity is unavailable; refusing to start an untrackable mobile backend." >&2
    exit 1
  fi

  if port_is_listening >/dev/null 2>&1; then
    ensure_state_dir
    if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
      if recorded_server_is_running && recorded_server_mode_is app; then
        load_or_create_token
        echo "CovenCave native-app server is already listening on ${HOST}:${PORT}."
        return 0
      fi
      # Refuse to reuse a sidecar-gated or untracked server under app mode.
      if [ -s "$SIDECAR_TOKEN_FILE" ]; then
        echo "Error: port ${PORT} is already in use by a native sidecar server. Run 'pnpm mobile:tailscale:stop' first." >&2
        exit 1
      fi
      require_recorded_server
      load_or_create_token
      echo "CovenCave native-app server is already listening on ${HOST}:${PORT}."
      return 0
    fi
    require_recorded_server
    load_or_create_token
    echo "CovenCave mobile server is already listening on ${HOST}:${PORT}."
    return 0
  fi

  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    # App mode serves the full API surface through Tailscale, so mint/load the
    # mobile access token and clear any stale sidecar token left by an older build.
    rm -f "$SIDECAR_TOKEN_FILE"
  fi
  load_or_create_token
  : >"$LOG_FILE"
  echo "Starting Next server on ${HOST}:${PORT}"
  if [ "$USE_TMUX" = "1" ] && command -v tmux >/dev/null 2>&1; then
    start_with_tmux
    echo "Server is running in tmux session: ${TMUX_SESSION}"
  else
    start_with_nohup
    echo "Server is running as background pid: $(process_owner_field "$OWNER_FILE" pid)"
  fi
  if [ "${CAVE_MOBILE_APP:-0}" = "1" ]; then
    write_server_mode app
  else
    write_server_mode invite
  fi

  if ! wait_for_server; then
    echo "Next server did not start. See ${LOG_FILE}" >&2
    tail -80 "$LOG_FILE" >&2 || true
    exit 1
  fi
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

# Native SwiftUI app over Tailscale Serve. Starts a loopback Next server with a
# mobile access token, publishes it via `tailscale serve`, and prints/scans a
# pairing URL so tailnet peers still need the Cave credential for the full API.
app_command() {
  ensure_tailscale
  CAVE_MOBILE_APP=1 start_next_server

  TAILSCALE_BACKEND="$(backend_url)"
  APP_URL=""
  serve_result=""
  if ! serve_result="$(
    node --experimental-strip-types "$SERVE_OWNERSHIP_HELPER" claim \
      --backend "$TAILSCALE_BACKEND" --channel dev
  )"; then
    echo "Tailscale Serve ownership refused the native app route: ${serve_result:-no result}" >&2
    exit 1
  fi
  case "$serve_result" in
    *'"kind":"owned"'*|*'"kind":"claimed"'*) ;;
    *)
      echo "Tailscale Serve ownership returned an unexpected result: ${serve_result}" >&2
      exit 1
      ;;
  esac
  status_json="$(tailscale_capture serve status --json)"
  url_result=""
  if url_result="$(
    printf '%s' "$status_json" |
      node --experimental-strip-types "$SERVE_OWNERSHIP_HELPER" url \
        --backend "$TAILSCALE_BACKEND"
  )"; then
    APP_URL="$(
      node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.url ?? "")' \
        "$url_result"
    )"
  fi
  if [ -z "$APP_URL" ]; then
    echo "Could not determine an HTTPS Tailscale Serve URL for the native app." >&2
    echo "Confirm MagicDNS and HTTPS are enabled, run 'pnpm mobile:tailscale:stop', then retry." >&2
    exit 1
  fi

  APP_PAIRING_URL="$(node -e "const url = new URL(process.argv[1]); url.searchParams.set('coven_access_token', process.argv[2]); process.stdout.write(url.toString())" "$APP_URL" "$ACCESS_TOKEN")"

  echo
  echo "Native iOS app is ready."
  echo "In the Coven Cave app, scan or paste this pairing URL:"
  echo
  echo "    ${APP_PAIRING_URL}"
  echo
  print_terminal_qr "$APP_PAIRING_URL"
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
      echo "CovenCave mobile server: running on ${HOST}:${PORT} (pid $(process_owner_field "$OWNER_FILE" pid))"
    else
      echo "CovenCave mobile server: not running. ${HOST}:${PORT} is in use by a server this script does not track."
      describe_port_occupant "$PORT"
    fi
  else
    echo "CovenCave mobile server: not listening on ${HOST}:${PORT}"
  fi
  echo "State directory: ${STATE_DIR}"
  echo "Log file: ${LOG_FILE}"
  if [ -s "$OWNER_FILE" ]; then
    echo "Recorded pid: $(process_owner_field "$OWNER_FILE" pid 2>/dev/null || echo invalid)"
  fi
  if [ -s "$EXPIRES_FILE" ]; then
    echo "Last invite expires: $(cat "$EXPIRES_FILE")"
  fi
  masked_serve_status
  warn_if_serve_targets_other_backend
}

stop_tracked_instance() {
  local dir="$1" owner_file backend serve_result serve_status
  owner_file="$dir/next.owner.json"
  [ -e "$owner_file" ] || return 0
  if ! backend="$(process_owner_field "$owner_file" backendUrl)"; then
    echo "Tracked process ownership is malformed; preserving state without signaling or resetting Serve: ${owner_file}" >&2
    return 1
  fi
  serve_result=""
  if serve_result="$(
    node --experimental-strip-types "$SERVE_OWNERSHIP_HELPER" reset \
      --backend "$backend" --channel dev --process-owner "$owner_file"
  )"; then
    serve_status=0
  else
    serve_status=$?
  fi
  case "$serve_result" in
    *'"kind":"removed"'*)
      if [ "$serve_status" -ne 0 ]; then
        echo "Tailscale Serve ownership returned an inconsistent removal result; tracked state was retained: ${serve_result}" >&2
        return 1
      fi
      rm -f \
        "$owner_file" \
        "$dir/next.pid" \
        "$dir/next.identity" \
        "$dir/access-token" \
        "$dir/invite.url" \
        "$dir/invite.expires" \
        "$dir/server.mode"
      echo "Stopped tracked backend: ${backend}"
      ;;
    *'"kind":"not-owned"'*)
      if [ "$serve_status" -ne 10 ]; then
        echo "Tailscale Serve ownership returned an inconsistent not-owned result; tracked state was retained: ${serve_result}" >&2
        return 1
      fi
      echo "Tailscale Serve belongs to another backend; preserving the tracked backend process and its state: ${backend}" >&2
      ;;
    *)
      echo "Tailscale Serve ownership could not safely stop/reset this backend; tracked state was retained: ${serve_result:-no result}" >&2
      return 1
      ;;
  esac
}

stop_command() {
  local dir failures=0 found=0
  if [ -e "$STATE_DIR/next.owner.json" ]; then
    found=1
    stop_tracked_instance "$STATE_DIR" || failures=1
  fi
  for dir in "$STATE_ROOT"/mobile-tailscale-*; do
    [ -d "$dir" ] || continue
    [ "$dir" = "$STATE_DIR" ] && continue
    [ -e "$dir/next.owner.json" ] || continue
    found=1
    stop_tracked_instance "$dir" || failures=1
  done

  if [ "$found" -eq 0 ]; then
    echo "No identity-verified CovenCave mobile backends are tracked; Serve was not changed."
  elif [ "$failures" -ne 0 ]; then
    echo "One or more tracked backends could not be stopped safely; their state was retained." >&2
    return 1
  else
    echo "CovenCave mobile Tailscale stop completed."
  fi
}

main() {
  case "$COMMAND" in
    start) resolve_active_port; maybe_fallback_port; start_command ;;
    invite) resolve_active_port; invite_command ;;
    app) resolve_active_port; maybe_fallback_port; app_command ;;
    status) resolve_active_port; status_command ;;
    stop) stop_command ;;
    *)
      echo "Usage: pnpm mobile:tailscale[:invite|:app|:status|:stop]" >&2
      echo "       bash scripts/mobile-tailscale.sh {start|invite|app|status|stop}" >&2
      exit 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
