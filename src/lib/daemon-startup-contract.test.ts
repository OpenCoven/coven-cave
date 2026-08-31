// @ts-nocheck
import assert from "node:assert/strict";
import {
  assessDaemonStartupCompatibility,
  COVEN_DAEMON_API_VERSION,
  isSupportedDaemonApiVersion,
  SUPPORTED_DAEMON_API_VERSIONS,
  unsupportedDaemonApiDiagnostic,
} from "./daemon-startup-contract.ts";

const healthy = {
  ok: true,
  apiVersion: COVEN_DAEMON_API_VERSION,
  covenVersion: "1.2.3",
  daemon: { pid: 1234 },
};

// --- supported-set gate (cave-0mrr7) ---

assert.equal(isSupportedDaemonApiVersion(COVEN_DAEMON_API_VERSION), true);

// The set is the single source of adoption truth: non-empty, pinned, and every
// member round-trips through the guard it feeds.
assert.ok(SUPPORTED_DAEMON_API_VERSIONS.size >= 1, "the supported set must never be empty");
assert.ok(
  SUPPORTED_DAEMON_API_VERSIONS.has(COVEN_DAEMON_API_VERSION),
  "the pinned contract must be in the supported set",
);
for (const supported of SUPPORTED_DAEMON_API_VERSIONS) {
  assert.equal(isSupportedDaemonApiVersion(supported), true, `${supported} must be adoptable`);
}

// Fail-closed: nothing outside the source-pinned set is adoptable — not a
// newer contract, not a near miss, not a non-string.
for (const apiVersion of [
  "1",
  "v1",
  "coven.daemon.v2",
  "coven.daemon.v0",
  ` ${COVEN_DAEMON_API_VERSION} `,
  "",
  null,
  1,
  undefined,
  {},
]) {
  assert.equal(isSupportedDaemonApiVersion(apiVersion), false, `${String(apiVersion)} must not be adoptable`);
}

assert.deepEqual(assessDaemonStartupCompatibility(healthy), {
  ok: true,
  daemonVersion: "1.2.3",
  apiVersion: COVEN_DAEMON_API_VERSION,
});

for (const ok of [undefined, false, null, 1, "true"]) {
  assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, ok }), {
    ok: false,
    code: "invalid_health",
    diagnostic: "The local Coven daemon did not publish a usable readiness document. Restart Coven and try again.",
  });
}

// Every previously-refused API contract stays a refusal with the same code,
// and the diagnostic now names the contract Cave wanted and the one it got.
for (const apiVersion of ["1", "v1", "coven.daemon.v2", ` ${COVEN_DAEMON_API_VERSION} `, null, 1, undefined]) {
  assert.equal(isSupportedDaemonApiVersion(apiVersion), false);
  const result = assessDaemonStartupCompatibility({ ...healthy, apiVersion });
  assert.equal(result.ok, false, `${String(apiVersion)} must stay a refusal`);
  if (!result.ok) {
    assert.equal(result.code, "unsupported_api", `${String(apiVersion)} must keep its refusal code`);
    assert.ok(result.diagnostic.length > 0, "every refusal must stay actionable");
    assert.match(result.diagnostic, /"coven\.daemon\.v1"/, "the diagnostic must name the contract Cave wanted");
  }
}

// A well-formed but newer contract is refused AND tells the user the daemon is
// ahead of this build, so the next step points at the client, not the daemon.
{
  const newer = assessDaemonStartupCompatibility({ ...healthy, apiVersion: "coven.daemon.v2" });
  assert.equal(newer.ok, false);
  if (!newer.ok) {
    assert.match(newer.diagnostic, /"coven\.daemon\.v2"/, "the diagnostic must name the contract the daemon published");
    assert.match(newer.diagnostic, /Update Cave/, "a newer daemon contract must point at the client");
  }
}

// A missing apiVersion is named as such, and the advice stays actionable.
{
  const missing = assessDaemonStartupCompatibility({ ...healthy, apiVersion: undefined });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.diagnostic, /no apiVersion field/, "a missing contract must be named as missing");
    assert.match(missing.diagnostic, /Update Coven/, "the refusal must keep its next step");
  }
}

// The diagnostic builder itself is stable and source-pinned.
assert.match(unsupportedDaemonApiDiagnostic("coven.daemon.v2"), /"coven\.daemon\.v1"/);
assert.match(unsupportedDaemonApiDiagnostic("coven.daemon.v2"), /"coven\.daemon\.v2"/);
assert.match(unsupportedDaemonApiDiagnostic(undefined), /no apiVersion field/);
assert.match(unsupportedDaemonApiDiagnostic(null), /null/);

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, covenVersion: "0.0.0" }), {
  ok: true,
  daemonVersion: "0.0.0",
  apiVersion: COVEN_DAEMON_API_VERSION,
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, covenVersion: "newest" }), {
  ok: false,
  code: "invalid_runtime_version",
  diagnostic: "The running Coven daemon did not report a valid runtime version. Update Coven, then restart the daemon.",
});

console.log("daemon-startup-contract.test.ts: ok");
