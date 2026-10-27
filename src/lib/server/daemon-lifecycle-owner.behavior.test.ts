// @ts-nocheck
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  beginDaemonLifecycleOperation,
  daemonLifecycleOperation,
  localRuntimeEvidence,
  observeDaemonLifecycle,
  resetDaemonLifecycleOwnerForTests,
} from "./daemon-lifecycle-owner.ts";

beforeEach(() => resetDaemonLifecycleOwnerForTests());
afterEach(() => resetDaemonLifecycleOwnerForTests());

function probeInput(overrides = {}) {
  return {
    targetMode: "local",
    availability: "offline",
    serviceConflict: null,
    reason: "daemon offline",
    ...overrides,
  };
}

test("one operation is recorded at a time and released exactly once", () => {
  assert.equal(daemonLifecycleOperation(), null);
  const first = beginDaemonLifecycleOperation("start", () => 1_000);
  assert.deepEqual(daemonLifecycleOperation(), { kind: "start", startedAt: "1970-01-01T00:00:01.000Z" });
  const second = beginDaemonLifecycleOperation("recovery", () => 2_000);
  assert.deepEqual(
    daemonLifecycleOperation(),
    { kind: "recovery", startedAt: "1970-01-01T00:00:02.000Z" },
    "a newer operation replaces the record",
  );
  first.end();
  assert.deepEqual(
    daemonLifecycleOperation(),
    { kind: "recovery", startedAt: "1970-01-01T00:00:02.000Z" },
    "ending an older operation never clears a newer one",
  );
  second.end();
  assert.equal(daemonLifecycleOperation(), null);
  second.end();
  assert.equal(daemonLifecycleOperation(), null, "a second end is a no-op");
});

test("observations carry a monotonic generation and remember a ready daemon", () => {
  const stopped = observeDaemonLifecycle(probeInput(), { now: () => 5_000 });
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.generation, 1);
  assert.equal(stopped.observedAt, "1970-01-01T00:00:05.000Z");
  assert.equal(stopped.evidence.previouslyReady, false);

  const ready = observeDaemonLifecycle(probeInput({ availability: "online", reason: null }), { now: () => 6_000 });
  assert.equal(ready.state, "ready");
  assert.equal(ready.generation, 2);

  const operation = beginDaemonLifecycleOperation("start", () => 7_000);
  const recovering = observeDaemonLifecycle(probeInput(), { now: () => 7_500 });
  assert.equal(recovering.state, "recovering", "a start after a ready instance is a recovery");
  assert.equal(recovering.evidence.previouslyReady, true);
  assert.deepEqual(recovering.evidence.operation, { kind: "start", startedAt: "1970-01-01T00:00:07.000Z" });
  operation.end();

  const after = observeDaemonLifecycle(probeInput(), { now: () => 8_000 });
  assert.equal(after.state, "stopped");
  assert.equal(after.generation, 4);
});

test("an in-flight start before any ready instance projects starting", () => {
  const operation = beginDaemonLifecycleOperation("start", () => 1_000);
  assert.equal(observeDaemonLifecycle(probeInput()).state, "starting");
  operation.end();
  assert.equal(observeDaemonLifecycle(probeInput()).state, "stopped");
});

test("runtime evidence is probed once per window and reused by later observations", async () => {
  let probes = 0;
  let now = 10_000;
  const probe = async () => {
    probes += 1;
    return null;
  };
  assert.equal(await localRuntimeEvidence({ probe, now: () => now }), "missing");
  assert.equal(await localRuntimeEvidence({ probe, now: () => now + 1_000 }), "missing");
  assert.equal(probes, 1, "a fresh answer is reused");
  assert.equal(observeDaemonLifecycle(probeInput(), { now: () => now + 1_000 }).state, "missing");

  now += 60_000;
  const present = async () => {
    probes += 1;
    return "0.5.18";
  };
  assert.equal(await localRuntimeEvidence({ probe: present, now: () => now }), "present");
  assert.equal(probes, 2, "an expired answer is probed again");
  assert.equal(observeDaemonLifecycle(probeInput(), { now: () => now }).state, "stopped");
});

test("without a runtime probe the owner reports unknown runtime and never guesses missing", () => {
  const observed = observeDaemonLifecycle(probeInput());
  assert.equal(observed.evidence.runtime, "unknown");
  assert.equal(observed.state, "stopped");
});

test("a hub target carries no local runtime or ownership evidence", () => {
  const observed = observeDaemonLifecycle(
    probeInput({ targetMode: "hub", availability: "unauthorized", reason: "hub unauthorized: unauthorized" }),
  );
  assert.equal(observed.state, "unauthorized");
  assert.equal(observed.evidence.runtime, "unknown");
  assert.equal(observed.reason, "hub unauthorized: unauthorized");
});

test("an operation can enter and leave its stopping phase, and only the current record is touched", () => {
  const restart = beginDaemonLifecycleOperation("restart", () => 1_000);
  restart.phase("stopping");
  assert.deepEqual(daemonLifecycleOperation(), { kind: "restart", startedAt: "1970-01-01T00:00:01.000Z", phase: "stopping" });
  assert.equal(observeDaemonLifecycle(probeInput({ availability: "online", reason: null })).state, "stopping");
  restart.phase(null);
  assert.deepEqual(daemonLifecycleOperation(), { kind: "restart", startedAt: "1970-01-01T00:00:01.000Z" });
  const newer = beginDaemonLifecycleOperation("start", () => 2_000);
  restart.phase("stopping");
  assert.deepEqual(daemonLifecycleOperation(), { kind: "start", startedAt: "1970-01-01T00:00:02.000Z" }, "a stale handle cannot mark a newer operation");
  newer.end();
  restart.end();
});
