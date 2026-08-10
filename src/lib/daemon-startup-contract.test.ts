// @ts-nocheck
import assert from "node:assert/strict";
import { assessDaemonStartupCompatibility } from "./daemon-startup-contract.ts";

const healthy = {
  ok: true,
  apiVersion: "v1",
  covenVersion: "1.2.3",
  daemon: { pid: 1234 },
};

assert.deepEqual(assessDaemonStartupCompatibility(healthy, "1.2.3"), {
  ok: true,
  daemonVersion: "1.2.3",
  apiVersion: "v1",
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, apiVersion: "coven.daemon.v1" }, "1.2.3"), {
  ok: true,
  daemonVersion: "1.2.3",
  apiVersion: "coven.daemon.v1",
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, covenVersion: "0.0.0" }, "1.2.3"), {
  ok: true,
  daemonVersion: "1.2.3",
  apiVersion: "v1",
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, apiVersion: "v2" }, "1.2.3"), {
  ok: false,
  code: "unsupported_api",
  diagnostic: "The running Coven daemon uses an incompatible API. Update Coven, then restart the daemon.",
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, covenVersion: "1.2.2" }, "1.2.3"), {
  ok: false,
  code: "runtime_version_mismatch",
  diagnostic: "The running Coven daemon does not match the installed runtime. Restart the daemon after updating Coven.",
});

assert.deepEqual(assessDaemonStartupCompatibility({ ...healthy, covenVersion: "newest" }, "1.2.3"), {
  ok: false,
  code: "invalid_runtime_version",
  diagnostic: "The running Coven daemon did not report a valid runtime version. Update Coven, then restart the daemon.",
});

console.log("daemon-startup-contract.test.ts: ok");
