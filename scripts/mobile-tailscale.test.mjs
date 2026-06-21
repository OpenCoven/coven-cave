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

test("mobile tailscale app mode serves the native client with no token", () => {
  // The tokenless native-app path must mint/load NO access or sidecar token and
  // unset both (plus COVEN_CAVE_BUNDLE) when starting the server.
  assert.match(script, /CAVE_MOBILE_APP/);
  assert.match(script, /app\) app_command ;;/);
  assert.match(
    script,
    /unset COVEN_CAVE_ACCESS_TOKEN COVEN_CAVE_AUTH_TOKEN COVEN_CAVE_BUNDLE/,
  );
  assert.match(script, /-u COVEN_CAVE_ACCESS_TOKEN -u COVEN_CAVE_AUTH_TOKEN -u COVEN_CAVE_BUNDLE/);
  assert.match(script, /tokenless app mode: do not mint or load any token/);
  // Tailscale Serve forwards the <host>.ts.net Host (verified against a real
  // tailnet), so the tokenless server MUST set COVEN_CAVE_TAILNET_TRUST=1 to
  // relax proxy.ts's loopback host gate — otherwise every request 403s.
  assert.match(script, /export COVEN_CAVE_TAILNET_TRUST=1/);
  assert.match(script, /COVEN_CAVE_TAILNET_TRUST=1/);
  assert.match(script, /HOSTNAME="\$HOST"/);
  assert.match(script, /PORT="\$PORT"/);
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

test("mobile tailscale runner syntax is shell-checkable by bash", () => {
  assert.match(script, /set -euo pipefail/);
});

console.log("mobile-tailscale.test.mjs OK");
