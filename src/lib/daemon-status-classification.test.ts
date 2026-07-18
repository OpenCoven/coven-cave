// @ts-nocheck
import assert from "node:assert/strict";
import {
  classifyDaemonFailureAvailability,
  classifyDaemonStatusPoll,
} from "./daemon-status-classification.ts";

assert.equal(
  classifyDaemonFailureAvailability({
    targetMode: "local",
    responseStatus: 0,
    reason: "daemon offline",
  }),
  "offline",
  "a refused or absent local socket is definitively offline",
);

for (const [name, input, expected] of [
  [
    "local timeout",
    { targetMode: "local", responseStatus: 0, reason: "daemon timeout" },
    "unreachable",
  ],
  [
    "local permission failure",
    { targetMode: "local", responseStatus: 0, reason: "socket exists but not readable" },
    "unreachable",
  ],
  [
    "local health error",
    { targetMode: "local", responseStatus: 503, reason: "not ready" },
    "unhealthy",
  ],
  [
    "hub timeout",
    { targetMode: "hub", responseStatus: 0, reason: "hub unreachable: daemon timeout" },
    "unreachable",
  ],
  [
    "hub auth",
    { targetMode: "hub", responseStatus: 401, reason: "hub unauthorized" },
    "unauthorized",
  ],
  [
    "hub health error",
    { targetMode: "hub", responseStatus: 503, reason: "hub unhealthy" },
    "unhealthy",
  ],
  [
    "missing hub config",
    { targetMode: "unconfigured-hub", responseStatus: 0, reason: "missing URL" },
    "misconfigured",
  ],
]) {
  assert.equal(classifyDaemonFailureAvailability(input), expected, name);
}

assert.deepEqual(
  classifyDaemonStatusPoll({
    responseStatus: 200,
    responseOk: true,
    payload: {
      running: false,
      availability: "offline",
      reason: "daemon offline",
      target: { mode: "local" },
    },
  }),
  { kind: "offline", targetMode: "local" },
  "the explicit local-offline classification keeps the Start daemon path",
);

assert.deepEqual(
  classifyDaemonStatusPoll({
    responseStatus: 200,
    responseOk: true,
    payload: { running: false, reason: "daemon offline", target: { mode: "local" } },
  }),
  { kind: "offline", targetMode: "local" },
  "an older status route's exact local-offline payload remains compatible",
);

for (const [name, input] of [
  ["route HTTP failure", { responseStatus: 500, responseOk: false, payload: null }],
  ["malformed payload", { responseStatus: 200, responseOk: true, payload: { nope: true } }],
  [
    "local timeout",
    {
      responseStatus: 200,
      responseOk: true,
      payload: {
        running: false,
        availability: "unreachable",
        reason: "daemon timeout",
        target: { mode: "local" },
      },
    },
  ],
  [
    "hub unauthorized",
    {
      responseStatus: 200,
      responseOk: true,
      payload: {
        running: false,
        availability: "unauthorized",
        reason: "hub unauthorized",
        target: { mode: "hub" },
      },
    },
  ],
  [
    "unconfigured hub",
    {
      responseStatus: 200,
      responseOk: true,
      payload: {
        running: false,
        availability: "misconfigured",
        reason: "server hub URL is not configured",
        target: { mode: "unconfigured-hub" },
      },
    },
  ],
]) {
  assert.equal(classifyDaemonStatusPoll(input).kind, "unavailable", name);
}

assert.deepEqual(
  classifyDaemonStatusPoll({
    responseStatus: 0,
    responseOk: false,
    payload: null,
    error: "status request failed",
  }),
  { kind: "unavailable", reason: "status request failed" },
  "a failed browser request is unknown, not offline",
);

assert.deepEqual(
  classifyDaemonStatusPoll({ responseStatus: 401, responseOk: false, payload: null }),
  { kind: "auth-expired" },
  "the Cave access-token gate remains distinct from daemon availability",
);

console.log("daemon-status-classification.test.ts: ok");
