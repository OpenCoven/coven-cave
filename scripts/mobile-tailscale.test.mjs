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
  assert.match(script, /start\|invite\|native\|status\|stop/);
  assert.match(packageJson.scripts["mobile:tailscale"], /mobile-tailscale\.sh start/);
  assert.match(packageJson.scripts["mobile:tailscale:invite"], /mobile-tailscale\.sh invite/);
  assert.match(packageJson.scripts["mobile:tailscale:native"], /mobile-tailscale\.sh native/);
  assert.match(packageJson.scripts["mobile:tailscale:native:device"], /CAVE_MOBILE_DEVICE=1/);
  assert.match(packageJson.scripts["mobile:tailscale:status"], /mobile-tailscale\.sh status/);
  assert.match(packageJson.scripts["mobile:tailscale:stop"], /mobile-tailscale\.sh stop/);
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
