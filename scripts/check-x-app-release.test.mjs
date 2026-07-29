import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = "scripts/check-x-app-release.mjs";
const cwd = new URL("..", import.meta.url);
const missingMessage = "::error::COVEN_CAVE_X_PRODUCTION_CLIENT_ID must be configured with a valid OpenCoven X public client ID before creating a release.\n";

const missing = spawnSync(process.execPath, [script], {
  cwd,
  encoding: "utf8",
  env: {
    ...process.env,
    COVEN_CAVE_X_CLIENT_ID: "development-client-id-123",
    COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "",
  },
});
assert.notEqual(missing.status, 0, "a development override cannot satisfy the release guard");
assert.equal(missing.stdout, "");
assert.equal(missing.stderr, missingMessage);
assert.doesNotMatch(missing.stdout + missing.stderr, /development-client-id-123/);

for (const clientId of ["   ", "not a valid public client id!"]) {
  const invalid = spawnSync(process.execPath, [script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, COVEN_CAVE_X_PRODUCTION_CLIENT_ID: clientId },
  });
  assert.notEqual(invalid.status, 0, "blank and malformed production client IDs are rejected");
  assert.equal(invalid.stdout, "");
  assert.equal(invalid.stderr, missingMessage);
  if (clientId.trim()) {
    assert.doesNotMatch(invalid.stdout + invalid.stderr, new RegExp(clientId.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

const configured = spawnSync(process.execPath, [script], {
  cwd,
  encoding: "utf8",
  env: { ...process.env, COVEN_CAVE_X_PRODUCTION_CLIENT_ID: "test-client-id-123" },
});
assert.equal(configured.status, 0);
assert.doesNotMatch(configured.stdout + configured.stderr, /test-client-id-123/);

console.log("check-x-app-release.test.mjs: ok");
