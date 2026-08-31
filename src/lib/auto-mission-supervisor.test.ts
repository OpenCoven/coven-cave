import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_MISSION_TIMEOUT_MS,
  cancelAutoMission,
  readAutoMission,
  writeAutoMission,
  type AutoMissionRecord,
  type AutoMissionStorage,
} from "./auto-mission-state.ts";
import {
  observeAutoMission,
  superviseAutoMissions,
  type AutoMissionTranscript,
} from "./auto-mission-supervisor.ts";

function fakeStorage(): AutoMissionStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const done = {
  id: "done-1",
  role: "assistant",
  text: '<coven:auto-status state="done" note="finished the work" />',
  createdAt: "2026-01-01T00:01:00.000Z",
};
const blocked = {
  id: "blocked-1",
  role: "assistant",
  text: '<coven:auto-status state="blocked" note="needs a credential" />',
  createdAt: "2026-01-01T00:01:00.000Z",
};

function mission(overrides: Partial<AutoMissionRecord> = {}): AutoMissionRecord {
  return {
    mission: "finish the unattended work",
    familiarId: "sage",
    startedAt: new Date(T0).toISOString(),
    notified: [],
    completedAt: null,
    outcome: null,
    lastActivityAt: T0,
    feedbackPending: false,
    ...overrides,
  };
}

function supervisionArgs(
  storage: AutoMissionStorage,
  sessionId: string,
  transcript: AutoMissionTranscript,
  fingerprints = new Map<string, string>(),
) {
  const notifications: unknown[] = [];
  return {
    args: {
      storage,
      sessionIds: [sessionId],
      loadTranscript: async () => transcript,
      sendNotification: (notification: unknown) => {
        notifications.push(notification);
        return true;
      },
      fingerprints,
      nowMs: T0 + 1_000,
      nowIso: "2026-01-01T00:00:01.000Z",
    },
    notifications,
    fingerprints,
  };
}

test("the first durable observation can find a settled marker without resetting the deadline", () => {
  const record = mission();
  const first = observeAutoMission({
    record,
    turns: [done],
    previousFingerprint: null,
    initialObservation: true,
    nowMs: T0 + 1_000,
  });
  assert.equal(first.activityTouched, false);
  assert.equal(first.record.lastActivityAt, T0);
  assert.deepEqual(first.pings.map((ping) => ping.state), ["done"]);

  const later = observeAutoMission({
    record: first.record,
    turns: [done, { id: "progress-2", role: "assistant", text: "working" }],
    previousFingerprint: first.fingerprint,
    nowMs: T0 + 2_000,
  });
  assert.equal(later.activityTouched, true);
  assert.equal(later.record.lastActivityAt, T0 + 2_000);
});

test("a done marker is claimed once and a later supervision pass is quiet", async () => {
  const storage = fakeStorage();
  const sessionId = "session-done";
  writeAutoMission(sessionId, mission(), storage);
  const first = supervisionArgs(storage, sessionId, { turns: [done] });

  const result = await superviseAutoMissions(first.args);
  assert.equal(result.notificationCount, 1);
  assert.equal(first.notifications.length, 1);
  assert.deepEqual(readAutoMission(sessionId, storage), {
    ...mission(),
    notified: ["done-1"],
    completedAt: "2026-01-01T00:00:01.000Z",
    outcome: "done",
    feedbackPending: true,
  });
  assert.equal((first.notifications[0] as { kind: string }).kind, "agent");

  const second = supervisionArgs(storage, sessionId, { turns: [done] }, first.fingerprints);
  const rerun = await superviseAutoMissions(second.args);
  assert.equal(rerun.notificationCount, 0);
  assert.equal(second.notifications.length, 0);
});

test("blocked response-needed is claimed once, while a later done still gets its own claim", async () => {
  const storage = fakeStorage();
  const sessionId = "session-blocked";
  writeAutoMission(sessionId, mission(), storage);
  const first = supervisionArgs(storage, sessionId, { turns: [blocked] });

  await superviseAutoMissions(first.args);
  assert.equal(first.notifications.length, 1);
  assert.equal((first.notifications[0] as { kind: string }).kind, "response-needed");
  assert.equal(readAutoMission(sessionId, storage)?.completedAt, null);

  const resumed = supervisionArgs(
    storage,
    sessionId,
    { turns: [blocked, { id: "answer-1", role: "user", text: "credential supplied" }, done] },
    first.fingerprints,
  );
  const result = await superviseAutoMissions(resumed.args);
  assert.equal(result.notificationCount, 1);
  assert.equal(resumed.notifications.length, 1);
  assert.equal((resumed.notifications[0] as { kind: string }).kind, "agent");
  assert.equal(readAutoMission(sessionId, storage)?.outcome, "done");
});

test("persisted cancellation wins when a workspace read was already in flight", async () => {
  const storage = fakeStorage();
  const sessionId = "session-cancelled";
  writeAutoMission(sessionId, mission(), storage);
  let release!: (transcript: AutoMissionTranscript) => void;
  const transcript = new Promise<AutoMissionTranscript>((resolve) => {
    release = resolve;
  });
  const notifications: unknown[] = [];
  const run = superviseAutoMissions({
    storage,
    sessionIds: [sessionId],
    loadTranscript: async () => transcript,
    sendNotification: (notification: unknown) => {
      notifications.push(notification);
      return true;
    },
    fingerprints: new Map(),
    nowMs: T0 + 1_000,
    nowIso: "2026-01-01T00:00:01.000Z",
  });

  await Promise.resolve();
  assert.equal(cancelAutoMission(sessionId, storage, "2026-01-01T00:00:02.000Z")?.outcome, "cancelled");
  release({ turns: [done] });
  await run;

  assert.equal(notifications.length, 0);
  assert.equal(readAutoMission(sessionId, storage)?.outcome, "cancelled");
});

test("a quiet armed mission times out once and becomes disarmed", async () => {
  const storage = fakeStorage();
  const sessionId = "session-timeout";
  writeAutoMission(sessionId, mission(), storage);
  const run = supervisionArgs(storage, sessionId, { turns: [] });
  run.args.nowMs = T0 + AUTO_MISSION_TIMEOUT_MS;
  run.args.nowIso = "2026-01-01T00:30:00.000Z";

  const first = await superviseAutoMissions(run.args);
  assert.deepEqual(first.timedOutSessionIds, [sessionId]);
  assert.equal(first.notificationCount, 1);
  assert.equal((run.notifications[0] as { kind: string }).kind, "response-needed");
  assert.equal(readAutoMission(sessionId, storage)?.outcome, "timed-out");

  const second = supervisionArgs(storage, sessionId, { turns: [] }, run.fingerprints);
  const rerun = await superviseAutoMissions(second.args);
  assert.equal(rerun.notificationCount, 0);
  assert.equal(second.notifications.length, 0);
});
