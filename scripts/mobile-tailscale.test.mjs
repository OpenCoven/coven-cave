import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  fileURLToPath(new URL("./mobile-tailscale.sh", import.meta.url)),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

test("mobile tailscale runner exposes operator commands", () => {
  assert.match(script, /COMMAND="\$\{1:-start\}"/);
  assert.match(script, /start\|invite\|native\|app\|status\|stop/);
  assert.match(packageJson.scripts["mobile:tailscale"], /mobile-tailscale\.sh start/);
  assert.match(packageJson.scripts["mobile:tailscale:invite"], /mobile-tailscale\.sh invite/);
  assert.match(packageJson.scripts["mobile:tailscale:native"], /mobile-tailscale\.sh native/);
  assert.match(packageJson.scripts["mobile:tailscale:native:device"], /CAVE_MOBILE_DEVICE=1/);
  assert.match(packageJson.scripts["mobile:tailscale:app"], /mobile-tailscale\.sh app/);
  assert.match(packageJson.scripts["mobile:tailscale:status"], /mobile-tailscale\.sh status/);
  assert.match(packageJson.scripts["mobile:tailscale:stop"], /mobile-tailscale\.sh stop/);
});

test("mobile tailscale app mode serves the native client with an access token", () => {
  // The native-app path exposes the full API through Tailscale Serve, so it must
  // mint/load a mobile access token and only clear sidecar/bundle trust.
  assert.match(script, /CAVE_MOBILE_APP/);
  assert.match(script, /app\) resolve_active_port; maybe_fallback_port; app_command ;;/);
  assert.match(script, /load_or_create_token/);
  assert.match(script, /COVEN_CAVE_ACCESS_TOKEN="\$ACCESS_TOKEN"/);
  assert.match(script, /unset COVEN_CAVE_AUTH_TOKEN COVEN_CAVE_BUNDLE COVEN_CAVE_TAILNET_TRUST/);
  assert.match(script, /-u COVEN_CAVE_AUTH_TOKEN -u COVEN_CAVE_BUNDLE -u COVEN_CAVE_TAILNET_TRUST/);
  assert.match(script, /coven_access_token/);
  assert.match(script, /HOSTNAME="\$HOST"/);
  assert.match(script, /PORT="\$PORT"/);
});

test("mobile tailscale runner can use an explicit Tailscale binary", () => {
  assert.match(script, /TAILSCALE_BIN="\$\{TAILSCALE_BIN:-tailscale\}"/);
  assert.match(script, /node - "\$TAILSCALE_TIMEOUT_MS" "\$TAILSCALE_BIN" "\$@"/);
  assert.match(script, /const \[timeoutMsRaw, bin, \.\.\.args\]/);
  assert.match(script, /spawnSync\(bin, args/);
  assert.match(script, /need "\$TAILSCALE_BIN"/);
  assert.match(script, /command -v "\$TAILSCALE_BIN"/);
});

test("mobile tailscale app mode falls back to Tailscale IP HTTP when MagicDNS is missing", () => {
  assert.match(script, /tailscale_ip_host\(\)/);
  assert.match(script, /Array\.isArray\(rawIps\)/);
  assert.match(script, /typeof ip === "string"/);
  assert.match(script, /tailscale_cmd serve --bg --http="\$PORT" "\$TAILSCALE_BACKEND"/);
  assert.match(script, /APP_URL="http:\/\/\$\{APP_IP_HOST\}:\$\{PORT\}\/"/);
});

test("mobile tailscale app mode records ownership separately from sidecar tokens", () => {
  assert.match(script, /MODE_FILE=/);
  assert.match(script, /write_server_mode app/);
  assert.match(script, /recorded_server_mode_is app/);
  assert.match(script, /rm -f "\$SIDECAR_TOKEN_FILE"/);
});

test("mobile tailscale app mode takes over an untracked same-checkout dev server", () => {
  assert.match(script, /take_over_same_checkout_server_for_app\(\)/);
  assert.match(script, /\[ "\$COMMAND" != "app" \]/);
  assert.match(script, /occupant_is_this_checkout/);
  assert.match(script, /kill "\$OCCUPANT_PID"/);
  assert.match(script, /wait_for_port_to_clear "\$PORT"/);
  assert.match(script, /Taking over untracked same-checkout dev server/);
});

test("mobile tailscale runner persists state for remote invite regeneration", () => {
  assert.match(script, /STATE_DIR=/);
  assert.match(script, /TOKEN_FILE=/);
  assert.match(script, /PID_FILE=/);
  assert.match(script, /INVITE_FILE=/);
  assert.match(script, /chmod 700 "\$STATE_DIR"/);
  assert.match(script, /chmod 600 "\$TOKEN_FILE"/);
});

test("mobile tailscale runner refuses untracked localhost listeners", () => {
  assert.match(script, /recorded_server_is_running\(\)/);
  assert.match(script, /require_recorded_server\(\)/);
  assert.match(script, /Refusing to contact an untracked server/);
  assert.match(script, /kill -0 "\$pid"/);
});

test("mobile tailscale status warns when Serve points at another backend", () => {
  assert.match(script, /warn_if_serve_targets_other_backend\(\)/);
  assert.match(script, /Tailscale Serve is not pointing at/);
  assert.match(script, /current proxy target/);
  assert.match(script, /warn_if_serve_targets_other_backend/);
});

test("mobile tailscale invite flow does not send the raw persisted token", () => {
  assert.match(script, /CONTROL_TOKEN_TTL_MS/);
  assert.match(script, /createMobileAccessToken\(accessToken\)/);
  assert.doesNotMatch(script, /Bearer \$\{accessToken\}/);
});

test("mobile tailscale runner keeps dev server alive after the wrapper exits", () => {
  assert.match(script, /tmux new-session -d/);
  assert.match(script, /nohup env COVEN_CAVE_ACCESS_TOKEN=/);
  assert.match(script, /<\/dev\/null/);
});

test("mobile tailscale invite command is chat-safe by default", () => {
  assert.match(script, /copy_invite_to_clipboard/);
  assert.match(script, /PRINT_URL="\$\{PRINT_URL:-0\}"/);
  assert.match(script, /Raw invite URL suppressed/);
  assert.doesNotMatch(script, /Open this URL on your phone:/);
});

test("mobile tailscale readiness requires this server's ready log", () => {
  assert.match(script, /server_logged_ready\(\)/);
  assert.match(script, /grep -F "> Ready on http:\/\/\$\{HOST\}:\$\{PORT\}" "\$LOG_FILE"/);
  assert.match(script, /recorded_server_is_running && port_is_listening.*&& server_logged_ready/);
});

test("mobile tailscale runner syntax is shell-checkable by bash", () => {
  assert.match(script, /set -euo pipefail/);
});

console.log("mobile-tailscale.test.mjs OK");
