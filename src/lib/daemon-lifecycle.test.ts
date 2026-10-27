// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAEMON_LIFECYCLE_STATES,
  describeDaemonLifecycle,
  mergeDaemonLifecycle,
  projectDaemonLifecycle,
  type DaemonLifecycleEvidence,
} from "./daemon-lifecycle.ts";

function evidence(overrides: Partial<DaemonLifecycleEvidence> = {}): DaemonLifecycleEvidence {
  return {
    targetMode: "local",
    availability: "offline",
    runtime: "unknown",
    serviceConflict: null,
    operation: null,
    previouslyReady: false,
    reason: null,
    ...overrides,
  };
}

test("every documented state is projected from evidence, never from a bare flag", () => {
  const cases: Array<[string, Partial<DaemonLifecycleEvidence>, string]> = [
    ["unconfigured hub", { targetMode: "unconfigured-hub", availability: "misconfigured" }, "misconfigured"],
    ["status unavailable", { availability: "status-unavailable" }, "unknown"],
    ["incompatible runtime", { availability: "incompatible" }, "incompatible"],
    ["healthy owned daemon", { availability: "online" }, "ready"],
    [
      "healthy daemon the service does not own",
      { availability: "online", serviceConflict: { label: "launchd" } },
      "foreign-owned",
    ],
    ["hub rejects credentials", { targetMode: "hub", availability: "unauthorized" }, "unauthorized"],
    ["endpoint answers but is unhealthy", { availability: "unhealthy" }, "unhealthy"],
    [
      "manual start in flight",
      { operation: { kind: "start", startedAt: "2026-10-27T00:00:00.000Z" } },
      "starting",
    ],
    [
      "automatic recovery in flight",
      { operation: { kind: "recovery", startedAt: "2026-10-27T00:00:00.000Z" } },
      "recovering",
    ],
    [
      "manual start after a previous ready instance",
      { operation: { kind: "start", startedAt: "2026-10-27T00:00:00.000Z" }, previouslyReady: true },
      "recovering",
    ],
    ["offline with a missing runtime", { availability: "offline", runtime: "missing" }, "missing"],
    ["offline with a present runtime", { availability: "offline", runtime: "present" }, "stopped"],
    ["offline with unknown runtime", { availability: "offline", runtime: "unknown" }, "stopped"],
    ["unreachable endpoint", { availability: "unreachable" }, "unreachable"],
    ["hub unreachable", { targetMode: "hub", availability: "unreachable" }, "unreachable"],
  ];
  for (const [name, input, expected] of cases) {
    const projected = projectDaemonLifecycle(evidence(input));
    assert.equal(projected.state, expected, name);
    assert.ok(DAEMON_LIFECYCLE_STATES.includes(projected.state), `${name} is a documented state`);
    assert.deepEqual(projected.evidence, evidence(input), `${name} keeps the evidence that proved it`);
  }
});

test("ready needs health evidence: an in-flight operation never wins over a confirmed endpoint", () => {
  const operation = { kind: "start" as const, startedAt: "2026-10-27T00:00:00.000Z" };
  assert.equal(projectDaemonLifecycle(evidence({ availability: "online", operation })).state, "ready");
  assert.equal(
    projectDaemonLifecycle(evidence({ availability: "unhealthy", operation })).state,
    "starting",
    "a daemon still booting answers unhealthy; the operation owns that window",
  );
  assert.equal(
    projectDaemonLifecycle(evidence({ availability: "incompatible", operation })).state,
    "incompatible",
    "incompatibility is never retried blindly, even mid-start",
  );
  assert.equal(
    projectDaemonLifecycle(evidence({ targetMode: "unconfigured-hub", availability: "misconfigured", operation })).state,
    "misconfigured",
  );
});

test("the projection carries the probe reason only for non-ready states", () => {
  const stopped = projectDaemonLifecycle(evidence({ reason: "daemon offline" }));
  assert.equal(stopped.reason, "daemon offline");
  const ready = projectDaemonLifecycle(evidence({ availability: "online", reason: "stale" }));
  assert.equal(ready.reason, undefined);
});

test("merge rejects an older generation and accepts a newer or equal one", () => {
  const current = { ...projectDaemonLifecycle(evidence({ availability: "online" })), generation: 5, observedAt: "2026-10-27T00:00:05.000Z" };
  const stale = { ...projectDaemonLifecycle(evidence()), generation: 4, observedAt: "2026-10-27T00:00:04.000Z" };
  const newer = { ...projectDaemonLifecycle(evidence()), generation: 6, observedAt: "2026-10-27T00:00:06.000Z" };
  assert.equal(mergeDaemonLifecycle(current, stale), current, "a stale result cannot mutate newer state");
  assert.equal(mergeDaemonLifecycle(current, newer), newer);
  assert.equal(mergeDaemonLifecycle(null, stale), stale, "the first observation always lands");
  const same = { ...newer, generation: 6 };
  assert.equal(mergeDaemonLifecycle(newer, same), same, "a same-generation refresh replaces its predecessor");
});

test("every state has a user-facing label and tone", () => {
  const seen = new Set<string>();
  for (const state of DAEMON_LIFECYCLE_STATES) {
    const presentation = describeDaemonLifecycle({ state });
    assert.ok(presentation.label.trim(), `${state} has a label`);
    assert.ok(["danger", "success", "warning", "neutral"].includes(presentation.tone), `${state} tone`);
    seen.add(presentation.label);
  }
  assert.deepEqual(describeDaemonLifecycle({ state: "ready" }), { label: "Running", tone: "success" });
  assert.deepEqual(describeDaemonLifecycle({ state: "starting" }), { label: "Starting…", tone: "warning" });
  assert.deepEqual(describeDaemonLifecycle({ state: "recovering" }), { label: "Reconnecting…", tone: "warning" });
  assert.deepEqual(describeDaemonLifecycle({ state: "missing" }), { label: "Runtime missing", tone: "danger" });
  assert.deepEqual(
    describeDaemonLifecycle({ state: "foreign-owned" }),
    { label: "Running outside the service", tone: "warning" },
  );
  assert.deepEqual(describeDaemonLifecycle({ state: "unknown" }), { label: "Status unavailable", tone: "warning" });
});
