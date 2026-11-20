import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFECYCLE_STALE_AFTER_MS,
  lifecycleCommandMessage,
  lifecycleControl,
  lifecycleFreshnessNote,
  lifecycleStateLabel,
  lifecycleView,
  newLifecycleAdoptionKey,
  parseLifecycleCommandResult,
  parseLifecycleDetail,
  parseLifecycleOverview,
  LIFECYCLE_ADOPTION_KEY_PATTERN,
  type AutomationLifecycleCache,
} from "./lifecycle.ts";

const readAt = "2026-10-18T12:00:00.000Z";
const readMs = Date.parse(readAt);
const overview = {
  kind: "available" as const,
  readAt,
  records: [
    { id: "nightly", kind: "present" as const, state: "active" as const, revision: 4, timezone: "America/Chicago" },
    { id: "weekly", kind: "present" as const, state: "paused" as const, revision: 2, timezone: "UTC" },
    { id: "old", kind: "present" as const, state: "disabled" as const, revision: 7, timezone: "UTC" },
    { id: "gone", kind: "absent" as const },
    { id: "huge", kind: "unreadable" as const },
  ],
};

test("the browser re-validates the overview and fails closed", () => {
  assert.deepEqual(parseLifecycleOverview(overview), overview);
  for (const kind of ["invalid", "unsupported", "unavailable"]) {
    assert.deepEqual(parseLifecycleOverview({ kind }), { kind });
  }
  const broken = [
    null, "available", { kind: "available", readAt, records: "x" },
    { kind: "available", readAt: "yesterday", records: [] },
    { ...overview, records: [...overview.records, overview.records[0]] },
    { ...overview, records: [{ ...overview.records[0], state: "running" }] },
    { ...overview, records: [{ ...overview.records[0], revision: 0 }] },
    { ...overview, records: [{ ...overview.records[0], id: "has space" }] },
    { ...overview, records: [{ ...overview.records[0], timezone: "<script>" }] },
    { ...overview, records: Array.from({ length: 101 }, (_, index) => ({ id: `a${index}`, kind: "absent" })) },
  ];
  for (const value of broken) assert.deepEqual(parseLifecycleOverview(value), { kind: "unavailable" }, JSON.stringify(value)?.slice(0, 80));
});

test("detail and command answers are validated the same way", () => {
  const health = { nextDueAt: readAt, lastPlannedAt: null, lastStartedAt: null, lastSuccessAt: null, consecutiveFailures: 0, quarantined: false };
  const detail = { kind: "available", readAt, record: overview.records[0], health };
  assert.deepEqual(parseLifecycleDetail(detail), detail);
  assert.deepEqual(parseLifecycleDetail({ ...detail, health: null }), { ...detail, health: null });
  assert.deepEqual(parseLifecycleDetail({ ...detail, health: { ...health, consecutiveFailures: -1 } }), { kind: "unavailable" });
  assert.deepEqual(parseLifecycleDetail({ ...detail, record: undefined }), { kind: "unavailable" });

  assert.deepEqual(parseLifecycleCommandResult({ kind: "committed", revision: 5, replayed: false }), { kind: "committed", revision: 5, replayed: false });
  assert.deepEqual(parseLifecycleCommandResult({ kind: "conflict", currentRevision: 6 }), { kind: "conflict", currentRevision: 6 });
  assert.deepEqual(parseLifecycleCommandResult({ kind: "conflict", currentRevision: null }), { kind: "conflict", currentRevision: null });
  assert.deepEqual(parseLifecycleCommandResult({ kind: "rejected", code: "ILLEGAL_TRANSITION" }), { kind: "rejected", code: "ILLEGAL_TRANSITION" });
  assert.deepEqual(parseLifecycleCommandResult({ kind: "unknown" }), { kind: "unknown" });
  // A free-text or unknown code never reaches the page.
  assert.deepEqual(parseLifecycleCommandResult({ kind: "rejected", code: "Something broke at /Users/val" }), { kind: "unavailable" });
  assert.deepEqual(parseLifecycleCommandResult({ kind: "committed", revision: 0, replayed: false }), { kind: "unavailable" });
  assert.deepEqual(parseLifecycleCommandResult(undefined), { kind: "unavailable" });
});

test("a live read gives the canonical state and the revision to send", () => {
  const cache: AutomationLifecycleCache = { lastGood: overview, latest: "available" };
  const active = lifecycleView(cache, "nightly", readMs + 1_000);
  assert.deepEqual(active, { state: "active", revision: 4, timezone: "America/Chicago", freshness: "live", readAt });
  assert.deepEqual(lifecycleControl(active), { command: "pause", label: "Pause", expectedRevision: 4, disabledReason: null });
  const paused = lifecycleView(cache, "weekly", readMs);
  assert.deepEqual(lifecycleControl(paused), { command: "activate", label: "Resume", expectedRevision: 2, disabledReason: null });
  assert.equal(lifecycleStateLabel(paused), "Paused");
  assert.equal(lifecycleFreshnessNote(active, (iso) => iso), null);
});

test("an old read, or a failed refresh after a good one, is stale and authorizes nothing", () => {
  const aged = lifecycleView({ lastGood: overview, latest: "available" }, "nightly", readMs + LIFECYCLE_STALE_AFTER_MS + 1);
  assert.equal(aged.freshness, "stale");
  assert.equal(aged.state, "active", "the last known state is still shown");
  const failed = lifecycleView({ lastGood: overview, latest: "unavailable" }, "nightly", readMs);
  assert.equal(failed.freshness, "stale");
  for (const view of [aged, failed]) {
    const control = lifecycleControl(view);
    assert.equal(control.expectedRevision, null);
    assert.match(control.disabledReason ?? "", /out of date/);
    assert.equal(lifecycleFreshnessNote(view, () => "12:00"), "Last read from Coven 12:00. It may have changed since.");
  }
});

test("without any successful read the state is unknown, never the legacy status", () => {
  const cases: [AutomationLifecycleCache, string][] = [
    [{ lastGood: null, latest: null }, "checking"],
    [{ lastGood: null, latest: "unavailable" }, "unavailable"],
    [{ lastGood: null, latest: "invalid" }, "unavailable"],
    [{ lastGood: null, latest: "unsupported" }, "unsupported"],
    // Read before this id was listed: wait for the next read.
    [{ lastGood: overview, latest: "available" }, "checking"],
  ];
  for (const [cache, freshness] of cases) {
    const view = lifecycleView(cache, "brand-new", readMs);
    assert.deepEqual(view, { state: "unknown", revision: null, timezone: null, freshness, readAt: null });
    const control = lifecycleControl(view);
    assert.equal(control.command, null);
    assert.ok(control.disabledReason);
  }
  assert.equal(lifecycleStateLabel(lifecycleView({ lastGood: null, latest: null }, "x", readMs)), "Checking");
  assert.equal(lifecycleStateLabel(lifecycleView({ lastGood: null, latest: "unavailable" }, "x", readMs)), "Not verified");
});

test("absent, unreadable and disabled definitions offer no command", () => {
  const cache: AutomationLifecycleCache = { lastGood: overview, latest: "available" };
  const absent = lifecycleView(cache, "gone", readMs);
  assert.equal(absent.freshness, "absent");
  assert.equal(lifecycleStateLabel(absent), "Not in Coven");
  assert.match(lifecycleControl(absent).disabledReason ?? "", /no definition/);
  assert.equal(lifecycleView(cache, "huge", readMs).freshness, "unreadable");
  const disabled = lifecycleControl(lifecycleView(cache, "old", readMs));
  assert.equal(disabled.command, null);
  assert.match(disabled.disabledReason ?? "", /can't be resumed directly/);
});

test("adoption keys are fresh and match the route's grammar", () => {
  const first = newLifecycleAdoptionKey();
  assert.match(first, LIFECYCLE_ADOPTION_KEY_PATTERN);
  assert.notEqual(first, newLifecycleAdoptionKey());
});

test("command outcomes are described without claiming what Coven did not report", () => {
  assert.deepEqual(lifecycleCommandMessage({ kind: "committed", revision: 5, replayed: false }, "pause", "Nightly"),
    { ok: true, message: "Paused 'Nightly' (revision 5)." });
  assert.deepEqual(lifecycleCommandMessage({ kind: "committed", revision: 3, replayed: true }, "activate", "Nightly"),
    { ok: true, message: "Resumed 'Nightly' (revision 3)." });
  const conflict = lifecycleCommandMessage({ kind: "conflict", currentRevision: 6 }, "pause", "Nightly");
  assert.equal(conflict.ok, false);
  assert.match(conflict.message, /changed in Coven \(now revision 6\)\. Nothing was applied/);
  assert.match(lifecycleCommandMessage({ kind: "rejected", code: "ILLEGAL_TRANSITION" }, "activate", "N").message, /can't resume/);
  assert.match(lifecycleCommandMessage({ kind: "rejected", code: "NOT_FOUND" }, "pause", "N").message, /no definition/);
  assert.match(lifecycleCommandMessage({ kind: "unknown" }, "pause", "N").message, /couldn't confirm/);
  assert.match(lifecycleCommandMessage({ kind: "unavailable" }, "pause", "N").message, /was not changed/);
});
