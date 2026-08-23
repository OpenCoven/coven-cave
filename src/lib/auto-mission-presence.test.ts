import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_MISSION_ROW_MAX,
  armedAutoMissionsFor,
  autoMissionRowPresentation,
} from "./auto-mission-presence.ts";
import { autoMissionKey, type AutoMissionRecord, type AutoMissionStorage } from "./auto-mission-state.ts";

function record(over: Partial<AutoMissionRecord> = {}): AutoMissionRecord {
  return {
    mission: "rewrite the token tests",
    startedAt: "2026-08-23T10:00:00.000Z",
    notified: [],
    completedAt: null,
    outcome: null,
    lastActivityAt: 0,
    feedbackPending: false,
    ...over,
  };
}

function storageWith(entries: Record<string, AutoMissionRecord>): AutoMissionStorage {
  const map = new Map<string, string>();
  for (const [sessionId, value] of Object.entries(entries)) {
    map.set(autoMissionKey(sessionId), JSON.stringify(value));
  }
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

test("an armed mission on a running session is reported with its text and start time", () => {
  const storage = storageWith({
    "sess-a": record({ mission: "rewrite the token tests", startedAt: "2026-08-23T09:55:00.000Z" }),
  });
  const found = armedAutoMissionsFor(["sess-a"], storage);
  assert.deepEqual(found.get("sess-a"), {
    sessionId: "sess-a",
    mission: "rewrite the token tests",
    startedAt: "2026-08-23T09:55:00.000Z",
  });
});

test("a settled mission is not reported — the surface must not claim finished work is in flight", () => {
  for (const outcome of ["done", "failed", "timed-out", "cancelled"] as const) {
    const storage = storageWith({
      "sess-a": record({ completedAt: "2026-08-23T10:20:00.000Z", outcome }),
    });
    assert.equal(
      armedAutoMissionsFor(["sess-a"], storage).size,
      0,
      `a ${outcome} mission must not be reported as in flight`,
    );
  }
});

test("only the session ids handed in are consulted", () => {
  // sess-b is armed but is NOT running, so nothing may name it. This is the
  // whole staleness guard: liveness comes from the caller, not the record.
  const storage = storageWith({
    "sess-a": record({ mission: "running one" }),
    "sess-b": record({ mission: "stale one" }),
  });
  const found = armedAutoMissionsFor(["sess-a"], storage);
  assert.deepEqual([...found.keys()], ["sess-a"]);
  assert.equal(found.get("sess-a")?.mission, "running one");
});

test("sessions with no mission record are absent rather than present-and-empty", () => {
  const storage = storageWith({ "sess-a": record() });
  const found = armedAutoMissionsFor(["sess-a", "sess-plain"], storage);
  assert.equal(found.has("sess-plain"), false);
  assert.equal(found.size, 1);
});

test("a blank mission is not reported — it would blank the row's title", () => {
  const storage = storageWith({ "sess-a": record({ mission: "   " }) });
  assert.equal(armedAutoMissionsFor(["sess-a"], storage).size, 0);
});

test("a storage that throws yields no missions instead of taking the chrome down", () => {
  const exploding: AutoMissionStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {},
    removeItem() {},
  };
  assert.deepEqual([...armedAutoMissionsFor(["sess-a"], exploding).keys()], []);
});

test("absent storage yields no missions", () => {
  assert.equal(armedAutoMissionsFor(["sess-a"], null).size, 0);
});

test("the row names the mission, tags it, and says it is in progress", () => {
  const view = autoMissionRowPresentation({
    sessionId: "sess-a",
    mission: "rewrite the token tests",
    startedAt: "2026-08-23T09:55:00.000Z",
  });
  assert.equal(view.title, "rewrite the token tests");
  assert.equal(view.tag, "Mission");
  assert.equal(view.description, "Auto mission in progress — rewrite the token tests");
});

test("a multi-line mission is collapsed to one line", () => {
  const view = autoMissionRowPresentation({
    sessionId: "sess-a",
    mission: "  rewrite\n the   token\ttests  ",
    startedAt: "2026-08-23T09:55:00.000Z",
  });
  assert.equal(view.title, "rewrite the token tests");
});

test("an over-long mission is clipped to the row budget with an ellipsis", () => {
  const long = "z".repeat(AUTO_MISSION_ROW_MAX + 40);
  const view = autoMissionRowPresentation({
    sessionId: "sess-a",
    mission: long,
    startedAt: "2026-08-23T09:55:00.000Z",
  });
  assert.equal(view.title.length, AUTO_MISSION_ROW_MAX);
  assert.equal(view.title.endsWith("…"), true);
  assert.equal(view.title.startsWith("z".repeat(AUTO_MISSION_ROW_MAX - 1)), true);
});

test("a mission exactly at the budget is left whole", () => {
  const exact = "y".repeat(AUTO_MISSION_ROW_MAX);
  const view = autoMissionRowPresentation({
    sessionId: "sess-a",
    mission: exact,
    startedAt: "2026-08-23T09:55:00.000Z",
  });
  assert.equal(view.title, exact);
  assert.equal(view.title.includes("…"), false);
});
