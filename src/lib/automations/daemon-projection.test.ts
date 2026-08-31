import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationProjectionEvent, ProjectedRunObservation } from "./daemon-projection.ts";
import {
  MAX_SEEN_EVENT_IDS,
  automationProjectionFreshness,
  consecutiveFailures,
  emptyAutomationProjection,
  isStaleRunObservation,
  reduceAutomationProjection,
} from "./daemon-projection.ts";

const T0 = "2026-09-01T12:00:00.000Z";
const T0_MS = new Date(T0).getTime();
const LATER = (seconds: number) => new Date(T0_MS + seconds * 1000).toISOString();

const run = (status: ProjectedRunObservation["status"], over: Partial<ProjectedRunObservation> = {}): ProjectedRunObservation => ({
  id: "run-1",
  automationId: "a1",
  status,
  startedAt: T0,
  ...over,
});

const event = (over: Partial<AutomationProjectionEvent>): AutomationProjectionEvent => ({
  schemaVersion: 1,
  id: "evt-1",
  seq: 1,
  occurredAt: T0,
  type: "run.observed",
  payload: run("running"),
  ...over,
});

describe("reduceAutomationProjection — snapshots", () => {
  it("replaces the definition state and records the observation", () => {
    const s0 = emptyAutomationProjection();
    const s1 = reduceAutomationProjection(s0, {
      kind: "snapshot",
      at: T0,
      routines: [
        { id: "a1", status: "ACTIVE" },
        { id: "a2", status: "PAUSED" },
      ],
    });
    assert.equal(s1.routineStatusById.get("a1"), "ACTIVE");
    assert.equal(s1.routineStatusById.get("a2"), "PAUSED");
    assert.equal(s1.lastSnapshotAt, T0);
    assert.equal(s1.lastObservedAt, T0);
    assert.equal(s1.counts.snapshots, 1);
  });

  it("drops routines the daemon no longer lists, but keeps their run history", () => {
    const s0 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "snapshot",
      at: T0,
      routines: [{ id: "a1", status: "ACTIVE" }],
    });
    const s1 = reduceAutomationProjection(s0, {
      kind: "runs",
      at: LATER(1),
      routineId: "a1",
      runs: [run("succeeded")],
    });
    const s2 = reduceAutomationProjection(s1, {
      kind: "snapshot",
      at: LATER(2),
      routines: [{ id: "a2", status: "ACTIVE" }],
    });
    assert.equal(s2.routineStatusById.has("a1"), false, "a removed routine leaves the definition projection");
    assert.ok(s2.newestRunByRoutine.has("a1"), "its recorded run is history, not a present-tense claim");
  });

  it("skips entries it cannot read and refuses a malformed timestamp whole", () => {
    const s0 = emptyAutomationProjection();
    const s1 = reduceAutomationProjection(s0, {
      kind: "snapshot",
      at: "not-a-date",
      routines: [{ id: "a1", status: "ACTIVE" }],
    });
    assert.equal(s1, s0, "a snapshot with no usable time changes nothing");
    const s2 = reduceAutomationProjection(s0, {
      kind: "snapshot",
      at: T0,
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed fixture
      routines: [{ id: "a1", status: "ACTIVE" }, { id: "", status: "ACTIVE" }, { id: "a2", status: "WIBBLE" }] as any,
    });
    assert.deepEqual([...s2.routineStatusById.keys()], ["a1"]);
  });
});

describe("reduceAutomationProjection — run histories", () => {
  it("follows the newest run by its own start time, not array order", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "runs",
      at: T0,
      routineId: "a1",
      runs: [run("running", { id: "old", startedAt: T0 }), run("succeeded", { id: "new", startedAt: LATER(60) })],
    });
    assert.equal(s1.newestRunByRoutine.get("a1")?.id, "new");
  });

  it("counts consecutive failures from ordered history and stops at a success", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "runs",
      at: T0,
      routineId: "a1",
      runs: [
        run("failed", { id: "r3", startedAt: LATER(30) }),
        run("failed", { id: "r2", startedAt: LATER(20) }),
        run("succeeded", { id: "r1", startedAt: LATER(10) }),
      ],
    });
    assert.equal(s1.consecutiveFailuresByRoutine.get("a1"), 2);
  });

  it("clears a routine's run state on an authoritative empty history", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "runs",
      at: T0,
      routineId: "a1",
      runs: [run("failed")],
    });
    const s2 = reduceAutomationProjection(s1, { kind: "runs", at: LATER(5), routineId: "a1", runs: [] });
    assert.equal(s2.newestRunByRoutine.has("a1"), false);
    assert.equal(s2.consecutiveFailuresByRoutine.has("a1"), false);
  });

  it("ignores entries it cannot read and refuses malformed input whole", () => {
    const s0 = emptyAutomationProjection();
    const s1 = reduceAutomationProjection(s0, {
      kind: "runs",
      at: T0,
      routineId: "a1",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed fixture
      runs: [{ id: "bad", automationId: "a1", status: "time-travelled", startedAt: T0 }] as any,
    });
    assert.equal(s1.newestRunByRoutine.size, 0, "an unreadable run never becomes state");
    const s2 = reduceAutomationProjection(s0, { kind: "runs", at: "nope", routineId: "a1", runs: [] });
    assert.equal(s2, s0);
    const s3 = reduceAutomationProjection(s0, { kind: "runs", at: T0, routineId: "", runs: [run("failed")] });
    assert.equal(s3, s0);
  });
});

describe("reduceAutomationProjection — changefeed events", () => {
  it("applies a known run.observed payload and advances the cursor", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "event",
      event: event({ id: "evt-1", seq: 7, payload: run("succeeded", { startedAt: LATER(10) }) }),
    });
    assert.equal(s1.lastSeq, 7);
    assert.equal(s1.lastEventId, "evt-1");
    assert.equal(s1.newestRunByRoutine.get("a1")?.id, "run-1");
    assert.equal(s1.lastObservedAt, T0);
    assert.equal(s1.counts.eventsAccepted, 1);
  });

  it("deduplicates a replayed canonical event id without applying it twice", () => {
    const s0 = emptyAutomationProjection();
    const s1 = reduceAutomationProjection(s0, { kind: "event", event: event({ id: "evt-1" }) });
    const s2 = reduceAutomationProjection(s1, { kind: "event", event: event({ id: "evt-1" }) });
    // The duplicate is a real occurrence on the feed, so the counter moves and
    // a new state comes back — but nothing else may change.
    assert.equal(s2.counts.eventsDuplicate, 1);
    assert.equal(s2.counts.eventsAccepted, 1, "the duplicate did not apply twice");
    assert.equal(s2.lastSeq, s1.lastSeq, "the duplicate advanced no cursor");
    assert.equal(s2.newestRunByRoutine, s1.newestRunByRoutine, "no run state was re-touched");
  });

  it("refuses an impossible sequence regression", () => {
    const s0 = emptyAutomationProjection();
    const s1 = reduceAutomationProjection(s0, {
      kind: "event",
      event: event({ id: "evt-2", seq: 10, type: "heartbeat", payload: undefined }),
    });
    const s2 = reduceAutomationProjection(s1, { kind: "event", event: event({ id: "evt-1", seq: 9, payload: run("failed") }) });
    assert.equal(s2.counts.eventsRefused, 1);
    assert.equal(s2.lastSeq, 10, "state never moves backwards");
    assert.equal(s2.newestRunByRoutine.size, 0, "the regressed payload was not applied");
  });

  it("refuses a malformed envelope whole", () => {
    const s0 = emptyAutomationProjection();
    for (const bad of [
      event({ schemaVersion: 2 as 1 }),
      event({ id: "" }),
      event({ seq: 0 }),
      event({ seq: 1.5 }),
      event({ occurredAt: "not-a-date" }),
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed fixture
      null as any,
    ]) {
      const s1 = reduceAutomationProjection(s0, { kind: "event", event: bad });
      assert.equal(s1.counts.eventsRefused, 1, `refused: ${JSON.stringify(bad)}`);
      assert.equal(s1.lastSeq, 0, "refused events advance no cursor");
    }
  });

  it("fails closed on an unknown event type: cursor advances, state does not", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "event",
      event: event({ id: "evt-9", seq: 3, type: "coven.something.cave-never-heard-of", payload: { hostile: true } }),
    });
    assert.equal(s1.lastSeq, 3, "the delivery is real and moves the cursor");
    assert.equal(s1.counts.eventsUnhandled, 1);
    assert.equal(s1.newestRunByRoutine.size, 0, "an unread payload is never guessed into state");
  });

  it("counts unhandled when a known type carries an unreadable payload", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "event",
      event: event({ id: "evt-4", seq: 2, payload: { status: "running" } }),
    });
    assert.equal(s1.counts.eventsAccepted, 1);
    assert.equal(s1.counts.eventsUnhandled, 1);
    assert.equal(s1.newestRunByRoutine.size, 0);
  });

  it("keeps the dedupe window bounded and still stops evicted replays", () => {
    let state = emptyAutomationProjection();
    // Heartbeat-shaped events exercise only the cursor and the dedupe window,
    // leaving run state untouched for the replay assertions below.
    for (let seq = 1; seq <= MAX_SEEN_EVENT_IDS + 10; seq++) {
      state = reduceAutomationProjection(state, {
        kind: "event",
        event: event({ id: `evt-${seq}`, seq, type: "heartbeat", payload: undefined }),
      });
    }
    assert.equal(state.seenEventIds.size, MAX_SEEN_EVENT_IDS, "the window never grows past its cap");
    assert.equal(state.counts.eventsUnhandled, MAX_SEEN_EVENT_IDS + 10);
    // The oldest id fell out of the window — but its sequence is far behind
    // the cursor, so the regression guard stops the replay instead.
    const replayed = reduceAutomationProjection(state, {
      kind: "event",
      event: event({ id: "evt-1", seq: 1, payload: run("failed") }),
    });
    assert.equal(replayed.counts.eventsRefused, 1);
    assert.equal(replayed.newestRunByRoutine.size, 0);
  });
});

describe("automationProjectionFreshness", () => {
  it("is offline before anything authoritative has happened", () => {
    assert.equal(automationProjectionFreshness(emptyAutomationProjection(), T0_MS), "offline");
  });

  it("is live within the threshold and stale beyond it", () => {
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "snapshot",
      at: T0,
      routines: [],
    });
    assert.equal(automationProjectionFreshness(s1, T0_MS + 60_000), "live");
    assert.equal(automationProjectionFreshness(s1, T0_MS + 121_000), "stale");
    assert.equal(
      automationProjectionFreshness(s1, T0_MS + 121_000, { staleAfterMs: 1_000 }),
      "stale",
      "the threshold is the caller's product decision",
    );
  });

  it("says degraded when the newest contact was a failure within the threshold", () => {
    const observed = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "snapshot",
      at: T0,
      routines: [],
    });
    const failed = reduceAutomationProjection(observed, {
      kind: "unavailable",
      at: LATER(10),
      reason: "daemon request failed: connect ECONNREFUSED",
    });
    assert.equal(automationProjectionFreshness(failed, T0_MS + 20_000), "degraded");
    // …and stale once even that failure is old — nothing authoritative for two
    // minutes means the cached projection may no longer be trusted as current.
    assert.equal(automationProjectionFreshness(failed, T0_MS + 300_000), "stale");
  });

  it("returns to live once a newer observation supersedes the failure", () => {
    const observed = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "snapshot",
      at: T0,
      routines: [],
    });
    const failed = reduceAutomationProjection(observed, {
      kind: "unavailable",
      at: LATER(10),
      reason: "down",
    });
    const recovered = reduceAutomationProjection(failed, {
      kind: "snapshot",
      at: LATER(20),
      routines: [],
    });
    assert.equal(automationProjectionFreshness(recovered, T0_MS + 25_000), "live");
  });

  it("is offline — not degraded — when it has never observed and only failures exist", () => {
    const failed = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "unavailable",
      at: T0,
      reason: "daemon offline",
    });
    assert.equal(automationProjectionFreshness(failed, T0_MS + 1_000), "offline");
    assert.equal(failed.lastFailure?.reason, "daemon offline", "the reason stays available to explain why");
  });
});

describe("isStaleRunObservation", () => {
  it("flags an in-flight run whose start is older than the threshold", () => {
    assert.equal(
      isStaleRunObservation(run("running", { startedAt: T0 }), T0_MS + 3 * 60 * 60_000, { staleAfterMs: 2 * 60 * 60_000 }),
      true,
    );
    assert.equal(
      isStaleRunObservation(run("running", { startedAt: T0 }), T0_MS + 60_000, { staleAfterMs: 2 * 60 * 60_000 }),
      false,
    );
    assert.equal(
      isStaleRunObservation(run("queued", { startedAt: T0 }), T0_MS + 3 * 60 * 60_000, { staleAfterMs: 2 * 60 * 60_000 }),
      true,
      "queued is in flight too",
    );
  });

  it("never flags terminal outcomes, however old", () => {
    // A finished run is a final fact; age does not make it suspect.
    assert.equal(
      isStaleRunObservation(run("succeeded", { startedAt: T0 }), T0_MS + 30 * 24 * 60 * 60_000, { staleAfterMs: 60_000 }),
      false,
    );
    assert.equal(
      isStaleRunObservation(run("cancelled", { startedAt: T0 }), T0_MS + 30 * 24 * 60 * 60_000, { staleAfterMs: 60_000 }),
      false,
    );
  });

  it("treats an in-flight run with an unusable start time as stale, not live", () => {
    assert.equal(isStaleRunObservation(run("running", { startedAt: "garbage" }), T0_MS, { staleAfterMs: 60_000 }), true);
  });
});

describe("consecutiveFailures", () => {
  it("counts the failure streak at the head of history", () => {
    assert.equal(consecutiveFailures([run("failed"), run("failed"), run("failed")]), 3);
    assert.equal(consecutiveFailures([]), 0);
    assert.equal(consecutiveFailures([run("succeeded"), run("failed")]), 0);
  });
});

describe("boundary — the projection is a view, not a ledger", () => {
  it("starts empty: nothing exists until the daemon says so", () => {
    const s = emptyAutomationProjection();
    assert.equal(s.newestRunByRoutine.size, 0);
    assert.equal(s.routineStatusById.size, 0);
    assert.equal(s.lastObservedAt, null);
    assert.equal(s.lastSeq, 0);
  });

  it("carries no authored outcomes: a stale running run stays running, stale", () => {
    // The core boundary proof: ten hours of silence does NOT let the
    // projection conclude the run succeeded, failed, or was cancelled. It
    // keeps the daemon's last word and flags it stale for as-of rendering.
    const s1 = reduceAutomationProjection(emptyAutomationProjection(), {
      kind: "runs",
      at: T0,
      routineId: "a1",
      runs: [run("running", { startedAt: T0 })],
    });
    const tenHoursLater = T0_MS + 10 * 60 * 60_000;
    const newest = s1.newestRunByRoutine.get("a1");
    assert.equal(newest?.status, "running", "the daemon's last word is kept verbatim");
    assert.equal(isStaleRunObservation(newest!, tenHoursLater, { staleAfterMs: 2 * 60 * 60_000 }), true, "flagged stale for the view");
    assert.equal(
      automationProjectionFreshness(reduceAutomationProjection(s1, { kind: "unavailable", at: LATER(60), reason: "down" }), tenHoursLater),
      "stale",
    );
  });
});
