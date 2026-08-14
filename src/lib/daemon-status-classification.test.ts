// @ts-nocheck
import assert from "node:assert/strict";
import {
  classifyDaemonConnectionTravelCadence,
  classifyDaemonFailureAvailability,
  classifyDaemonStatusPoll,
  describeDaemonAvailability,
} from "./daemon-status-classification.ts";

for (const [name, input, expected] of [
  [
    "online",
    { running: true, availability: "online" },
    { label: "Running", tone: "success" },
  ],
  [
    "offline",
    { running: false, availability: "offline" },
    { label: "Offline", tone: "danger" },
  ],
  [
    "unreachable",
    { running: false, availability: "unreachable" },
    { label: "Unreachable", tone: "danger" },
  ],
  [
    "unhealthy",
    { running: false, availability: "unhealthy" },
    { label: "Unhealthy", tone: "danger" },
  ],
  [
    "unauthorized",
    { running: false, availability: "unauthorized" },
    { label: "Authorization required", tone: "danger" },
  ],
  [
    "misconfigured",
    { running: false, availability: "misconfigured" },
    { label: "Configuration required", tone: "warning" },
  ],
  [
    "status unavailable",
    { running: false, availability: "status-unavailable" },
    { label: "Status unavailable", tone: "warning" },
  ],
  [
    "incompatible",
    { running: false, availability: "incompatible" },
    { label: "Incompatible", tone: "danger" },
  ],
  [
    "legacy running payload",
    { running: true },
    { label: "Running", tone: "success" },
  ],
  [
    "legacy stopped payload",
    { running: false },
    { label: "Offline", tone: "danger" },
  ],
  [
    "online classification without running proof",
    { running: false, availability: "online" },
    { label: "Unhealthy", tone: "danger" },
  ],
  [
    "running flag contradicted by failure classification",
    { running: true, availability: "incompatible" },
    { label: "Unhealthy", tone: "danger" },
  ],
] as const) {
  assert.deepEqual(describeDaemonAvailability(input), expected, name);
}

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

for (const [name, payload, expected] of [
  [
    "hub unreachable",
    {
      running: false,
      availability: "unreachable",
      target: { mode: "hub" },
    },
    "hub-unreachable",
  ],
  [
    "hub online",
    {
      running: true,
      availability: "online",
      target: { mode: "hub" },
    },
    "hub-reachable",
  ],
  [
    "hub unauthorized",
    {
      running: false,
      availability: "unauthorized",
      target: { mode: "hub" },
    },
    "hub-reachable",
  ],
  [
    "hub unhealthy",
    {
      running: false,
      availability: "unhealthy",
      target: { mode: "hub" },
    },
    "hub-reachable",
  ],
  [
    "hub offline remains a definite reachable-hub answer",
    {
      running: false,
      availability: "offline",
      target: { mode: "hub" },
    },
    "hub-reachable",
  ],
  [
    "local target clears outage cadence without triggering replay",
    {
      running: false,
      availability: "offline",
      target: { mode: "local" },
    },
    "non-hub",
  ],
  [
    "unconfigured hub clears outage cadence without triggering replay",
    {
      running: false,
      availability: "misconfigured",
      target: { mode: "unconfigured-hub" },
    },
    "non-hub",
  ],
  [
    "status-unavailable without a target stays unknown",
    {
      running: false,
      availability: "status-unavailable",
      reason: "Daemon connection status is temporarily unavailable",
    },
    "unknown",
  ],
  [
    "status-unavailable with a hub target still stays unknown",
    {
      running: false,
      availability: "status-unavailable",
      reason: "Daemon connection status is temporarily unavailable",
      target: { mode: "hub" },
    },
    "unknown",
  ],
  [
    "null payload stays unknown",
    null,
    "unknown",
  ],
  [
    "missing target stays unknown",
    {
      running: false,
      availability: "online",
    },
    "unknown",
  ],
  [
    "invalid target stays unknown",
    {
      running: false,
      availability: "online",
      target: { mode: "remote" },
    },
    "unknown",
  ],
  [
    "auth-expired 401 without payload stays unknown",
    undefined,
    "unknown",
  ],
] as const) {
  assert.equal(classifyDaemonConnectionTravelCadence(payload), expected, name);
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

assert.deepEqual(
  classifyDaemonStatusPoll({
    responseStatus: 200,
    responseOk: true,
    payload: { running: true, target: { mode: "local" } },
  }),
  { kind: "running", targetMode: "local" },
  "a healthy local target preserves its mode",
);

assert.deepEqual(
  classifyDaemonStatusPoll({
    responseStatus: 200,
    responseOk: true,
    payload: { running: true, target: { mode: "hub" } },
  }),
  { kind: "running", targetMode: "hub" },
  "a healthy hub target preserves its mode",
);

for (const availability of ["offline", "unreachable", "unhealthy", "unauthorized", "misconfigured", "status-unavailable", "incompatible"]) {
  assert.equal(
    classifyDaemonStatusPoll({
      responseStatus: 200,
      responseOk: true,
      payload: {
        running: true,
        availability,
        reason: `contradictory ${availability} status`,
        target: { mode: "hub" },
      },
    }).kind,
    "unavailable",
    `running cannot override ${availability}`,
  );
}

for (const [name, target] of [
  ["missing target", undefined],
  ["missing target mode", {}],
  ["unknown target mode", { mode: "remote" }],
  ["unconfigured hub target", { mode: "unconfigured-hub" }],
]) {
  assert.equal(
    classifyDaemonStatusPoll({
      responseStatus: 200,
      responseOk: true,
      payload: { running: true, ...(target === undefined ? {} : { target }) },
    }).kind,
    "unavailable",
    name,
  );
}

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
  [
    "Cave home temporarily busy",
    {
      responseStatus: 200,
      responseOk: true,
      payload: {
        running: false,
        availability: "status-unavailable",
        reason: "Cave home is temporarily busy; status will retry automatically",
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
