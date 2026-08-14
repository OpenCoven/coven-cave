// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDaemonDiagnosticBundle,
  clearDaemonDiagnosticEventsForTests,
  createDaemonDiagnosticContext,
  daemonDiagnosticContextFromRequest,
  DAEMON_DIAGNOSTIC_CORRELATION_HEADER,
  DAEMON_DIAGNOSTIC_MAX_EVENTS,
  listDaemonDiagnosticEvents,
  parseNativeDaemonDiagnosticEvents,
  recordDaemonDiagnosticEvent,
  seedNativeDaemonDiagnosticEvents,
} from "./daemon-diagnostics.ts";

const STARTUP_CORRELATION = "11111111-1111-4111-8111-111111111111";
const NATIVE_CORRELATION = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

clearDaemonDiagnosticEventsForTests();
const context = createDaemonDiagnosticContext({
  correlationId: STARTUP_CORRELATION,
  generation: 7,
});
const secret = ["ghp", "1234567890abcdefghijklmnopqrstuv"].join("_");
for (let index = 0; index < DAEMON_DIAGNOSTIC_MAX_EVENTS + 5; index += 1) {
  recordDaemonDiagnosticEvent(context, {
    component: "daemon",
    operation: "health-request",
    phase: "response",
    attempt: index + 1,
    durationMs: index,
    outcome: index % 2 === 0 ? "succeeded" : "failed",
    versions: { daemon: "0.2.5" },
    endpoint: {
      kind: "local-socket",
      classification: index % 2 === 0 ? "online" : "transport-error",
      status: index % 2 === 0 ? 200 : 0,
    },
    error: index % 2 === 0 ? null : {
      classification: "socket-error",
      code: "EACCES",
      message: `failed at /Users/Example Person/.coven/coven.sock?token=${secret}`,
    },
  });
}

const retained = listDaemonDiagnosticEvents();
assert.equal(retained.length, DAEMON_DIAGNOSTIC_MAX_EVENTS, "retention is bounded");
assert.equal(retained[0]?.attempt, 6, "the bounded ring drops the oldest events first");
assert.equal(
  retained.every((event) => event.correlationId === context.correlationId && event.generation === 7),
  true,
  "one correlation and operation generation follow the retained lifecycle",
);
assert.deepEqual(
  retained.at(-1)?.endpoint,
  { kind: "local-socket", classification: "online", status: 200 },
  "endpoint kind, classification, and status remain structured",
);

const bundle = JSON.stringify(buildDaemonDiagnosticBundle({
  events: [
    ...retained,
    {
      ...retained[0],
      eventId: `${secret}:unsafe-export-event`,
      correlationId: secret,
      versions: { daemon: `/Users/Example Person/bin?token=${secret}` },
      error: {
        classification: "os-error",
        code: "EACCES",
        message: `failed at /Users/Example Person/private?token=${secret}`,
      },
    },
  ],
  generatedAt: "2026-08-10T00:00:00.000Z",
  runtime: {
    platform: "darwin",
    architecture: "arm64",
    nodeVersion: "v24.18.1",
    caveVersion: "0.2.5",
  },
}));
assert.match(bundle, /coven-cave-daemon-diagnostics/, "the export carries a manifest");
assert.match(bundle, /"included":false/, "telemetry is explicitly excluded");
assert.equal(
  /ghp_|Example Person|\/Users\/|coven\.sock|access_token|token=/.test(bundle),
  false,
  "exported events exclude secrets and personal paths",
);
assert.notEqual(
  createDaemonDiagnosticContext({ correlationId: secret }).correlationId,
  secret,
  "secret-shaped request values cannot become correlation IDs",
);
const maliciousRequestContext = daemonDiagnosticContextFromRequest(new Request("http://cave.local", {
  headers: { [DAEMON_DIAGNOSTIC_CORRELATION_HEADER]: secret },
}));
assert.notEqual(
  maliciousRequestContext.correlationId,
  secret,
  "request headers accept only UUID-shaped correlations",
);
const previousNativeCorrelation = process.env.COVEN_CAVE_CORRELATION_ID;
process.env.COVEN_CAVE_CORRELATION_ID = NATIVE_CORRELATION;
assert.equal(
  daemonDiagnosticContextFromRequest(new Request("http://cave.local")).correlationId,
  NATIVE_CORRELATION,
  "sidecar API requests inherit the native startup or recovery correlation",
);
if (previousNativeCorrelation === undefined) {
  delete process.env.COVEN_CAVE_CORRELATION_ID;
} else {
  process.env.COVEN_CAVE_CORRELATION_ID = previousNativeCorrelation;
}

clearDaemonDiagnosticEventsForTests();
seedNativeDaemonDiagnosticEvents({
  COVEN_CAVE_CORRELATION_ID: NATIVE_CORRELATION,
  COVEN_CAVE_DIAGNOSTIC_GENERATION: "3",
  COVEN_CAVE_DIAGNOSTIC_OPERATION: "sidecar-recovery",
  COVEN_CAVE_DIAGNOSTIC_ATTEMPT: "2",
  COVEN_CAVE_NATIVE_VERSION: "0.2.5",
  COVEN_CAVE_NATIVE_PROTOCOL_VERSION: "1",
});
const nativeEvents = listDaemonDiagnosticEvents();
assert.deepEqual(
  nativeEvents.map(({ component, correlationId, generation, operation, attempt, phase }) => ({
    component,
    correlationId,
    generation,
    operation,
    attempt,
    phase,
  })),
  [
    {
      component: "tauri",
      correlationId: NATIVE_CORRELATION,
      generation: 3,
      operation: "sidecar-recovery",
      attempt: 2,
      phase: "sidecar-handoff",
    },
    {
      component: "sidecar",
      correlationId: NATIVE_CORRELATION,
      generation: 3,
      operation: "sidecar-recovery",
      attempt: 2,
      phase: "process-boot",
    },
  ],
  "the native handoff seeds both Tauri and sidecar events with one correlation",
);

const parsedNative = parseNativeDaemonDiagnosticEvents(`${JSON.stringify({
  schemaVersion: 1,
  eventId: `${NATIVE_CORRELATION}:3:native:startup:failed:1`,
  correlationId: NATIVE_CORRELATION,
  generation: 3,
  timestampUnixMs: 1_786_320_000_000,
  component: "tauri",
  operation: "sidecar-recovery",
  phase: "startup",
  attempt: 2,
  durationMs: 42,
  outcome: "failed",
  process: { pid: 42, platformBirthId: null },
  versions: { cave: "0.2.5", protocol: "1" },
  endpoint: { kind: "loopback-http", classification: "startup-failed", status: null },
  error: {
    classification: "os-error",
    code: 13,
    message: `failed at /Users/Example Person/private?token=${secret}`,
  },
})}\n`);
assert.equal(parsedNative.length, 1, "native JSONL events use the shared event contract");
assert.equal(
  /ghp_|Example Person|\/Users\/|token=/.test(JSON.stringify(parsedNative)),
  false,
  "native evidence is sanitized again at the export boundary",
);

const diagnosticsRoute = await readFile(
  new URL("../../app/api/daemon/diagnostics/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  diagnosticsRoute,
  /content-disposition[\s\S]*coven-cave-daemon-diagnostics\.json/i,
  "the diagnostic bundle is user-exportable with a stable filename",
);
assert.match(
  diagnosticsRoute,
  /buildDaemonDiagnosticBundle/,
  "the export route uses the redacted manifest builder",
);

console.log("daemon-diagnostics.test.ts: ok");
