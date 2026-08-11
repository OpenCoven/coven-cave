// @ts-nocheck
import assert from "node:assert/strict";
import {
  assessDaemonStartupCompatibility,
  COVEN_DAEMON_API_VERSION,
  isSupportedDaemonApiVersion,
} from "./daemon-startup-contract.ts";

const healthy = {
  ok: true,
  apiVersion: COVEN_DAEMON_API_VERSION,
  covenVersion: "1.2.3",
  daemon: { pid: 1234 },
};

assert.equal(isSupportedDaemonApiVersion(COVEN_DAEMON_API_VERSION), true);

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

for (const apiVersion of ["1", "v1", "coven.daemon.v2", ` ${COVEN_DAEMON_API_VERSION} `, null, 1]) {
  assert.equal(isSupportedDaemonApiVersion(apiVersion), false);
  assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, apiVersion }), {
    ok: false,
    code: "unsupported_api",
    diagnostic: "The running Coven daemon uses an incompatible API. Update Coven, then restart the daemon.",
  });
}

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
