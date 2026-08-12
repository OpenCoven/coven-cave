// Behavioral tests for /auto mission persistence + the ping decision.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTO_MISSION_TIMEOUT_MS,
  clearAutoMission,
  isAutoMissionArmed,
  isAutoMissionTimedOut,
  pendingAutoMissionPings,
  readAutoMission,
  touchAutoMission,
  writeAutoMission,
  type AutoMissionRecord,
} from "./auto-mission-state.ts";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

const base: AutoMissionRecord = {
  mission: "fix the failing tests",
  startedAt: "2026-01-01T00:00:00.000Z",
  notified: [],
};

// ── persistence ──────────────────────────────────────────────────────────────

test("round-trips a record through storage", () => {
  const s = fakeStorage();
  writeAutoMission("sess-1", base, s);
  assert.deepEqual(readAutoMission("sess-1", s), {
    ...base,
    completedAt: null,
    outcome: null,
    lastActivityAt: null,
    feedbackPending: false,
  });
});

test("records are per-session — another chat sees nothing", () => {
  const s = fakeStorage();
  writeAutoMission("sess-1", base, s);
  assert.equal(readAutoMission("sess-2", s), null);
});

test("missing session id, missing storage, and junk all read as null", () => {
  const s = fakeStorage();
  assert.equal(readAutoMission(null, s), null);
  assert.equal(readAutoMission("sess-1", null), null);
  s.setItem("cave:auto-mission:sess-1", "{not json");
  assert.equal(readAutoMission("sess-1", s), null);
  s.setItem("cave:auto-mission:sess-1", JSON.stringify({ notified: [] }));
  assert.equal(readAutoMission("sess-1", s), null, "a record with no mission text is not a mission");
});

test("clear removes the record", () => {
  const s = fakeStorage();
  writeAutoMission("sess-1", base, s);
  clearAutoMission("sess-1", s);
  assert.equal(readAutoMission("sess-1", s), null);
});

// ── arming ───────────────────────────────────────────────────────────────────

test("armed until completed", () => {
  assert.equal(isAutoMissionArmed(null), false);
  assert.equal(isAutoMissionArmed(base), true);
  assert.equal(isAutoMissionArmed({ ...base, completedAt: "2026-01-01T01:00:00.000Z" }), false);
});

// ── ping decision ────────────────────────────────────────────────────────────

const done = '<coven:auto-status state="done" note="fixed 3 tests" />';
const blocked = '<coven:auto-status state="blocked" note="needs npm token" />';
const working = '<coven:auto-status state="working" />';
const autoMissionSource = await readFile(
  new URL("./auto-mission-state.ts", import.meta.url),
  "utf8",
);

test("a settled done turn pings once", () => {
  const pings = pendingAutoMissionPings(base, [
    { id: "t1", role: "user", text: "go" },
    { id: "t2", role: "assistant", text: `all set. ${done}` },
  ]);
  assert.deepEqual(pings, [{ turnId: "t2", state: "done", note: "fixed 3 tests" }]);
});

test("an already-notified turn never pings again — the reload guard", () => {
  const record = { ...base, notified: ["t2"] };
  assert.deepEqual(
    pendingAutoMissionPings(record, [{ id: "t2", role: "assistant", text: done }]),
    [],
  );
});

test("a still-streaming turn does not ping — the marker may not be final", () => {
  assert.deepEqual(
    pendingAutoMissionPings(base, [{ id: "t2", role: "assistant", text: done, pending: true }]),
    [],
  );
});

test("working and clarifying never ping — only blocked and done reach the human", () => {
  assert.deepEqual(
    pendingAutoMissionPings(base, [
      { id: "t1", role: "assistant", text: working },
      { id: "t2", role: "assistant", text: '<coven:auto-status state="clarifying" />' },
    ]),
    [],
  );
});

test("a user turn carrying the marker text never pings", () => {
  assert.deepEqual(pendingAutoMissionPings(base, [{ id: "t1", role: "user", text: done }]), []);
});

test("a completed mission is disarmed — post-mission chat cannot re-ping", () => {
  const record = { ...base, completedAt: "2026-01-01T01:00:00.000Z" };
  assert.deepEqual(pendingAutoMissionPings(record, [{ id: "t9", role: "assistant", text: done }]), []);
});

test("blocked then later done both ping, in transcript order", () => {
  const pings = pendingAutoMissionPings(base, [
    { id: "t1", role: "assistant", text: blocked },
    { id: "t2", role: "user", text: "here's the token" },
    { id: "t3", role: "assistant", text: done },
  ]);
  assert.deepEqual(pings, [
    { turnId: "t1", state: "blocked", note: "needs npm token" },
    { turnId: "t3", state: "done", note: "fixed 3 tests" },
  ]);
});

test("nothing after a done is considered — the mission ended there", () => {
  const pings = pendingAutoMissionPings(base, [
    { id: "t1", role: "assistant", text: done },
    { id: "t2", role: "assistant", text: blocked },
  ]);
  assert.deepEqual(pings, [{ turnId: "t1", state: "done", note: "fixed 3 tests" }]);
});

test("no record means no pings", () => {
  assert.deepEqual(pendingAutoMissionPings(null, [{ id: "t1", role: "assistant", text: done }]), []);
});

test("auto-status syntax inside valid, malformed, and oversized result spans is inert", () => {
  const validLiteral = [
    "<coven:auto-status state='done' />",
    "<coven:auto-status state='failed' />",
  ].join(" and ");
  const valid = `<coven:result id="literal-status" state="passed" label="${validLiteral}" />`;
  const malformed = [
    "<coven:result",
    '  id="malformed-status"',
    '  state="passed"',
    '  label="Malformed"',
    `  note="${done}"`,
    "/>",
  ].join("\n");
  const oversized = [
    "<coven:result",
    '  id="oversized-status"',
    '  state="passed"',
    `  label="${"x".repeat(2_048)}`,
    '<coven:auto-status state="failed" note="must stay inert" />',
    'exact tail"',
    "/>",
  ].join("\n");

  for (const [name, text] of [
    ["valid", valid],
    ["malformed", malformed],
    ["oversized", oversized],
  ] as const) {
    assert.deepEqual(
      pendingAutoMissionPings(base, [{ id: `t-${name}`, role: "assistant", text }]),
      [],
      `${name} result protocol must own embedded auto-status syntax`,
    );
  }
});

test("a real auto-status after an opaque result span still transitions the mission", () => {
  const result = [
    "<coven:result",
    '  id="oversized-before-live"',
    '  state="passed"',
    `  label="${"x".repeat(2_048)}`,
    '<coven:auto-status state="failed" note="inert" />',
    'exact tail"',
    "/>",
  ].join("\n");

  assert.deepEqual(
    pendingAutoMissionPings(base, [
      {
        id: "t-live-after-result",
        role: "assistant",
        text: `${result}\n<coven:auto-status state="done" note="real completion" />`,
      },
    ]),
    [{
      turnId: "t-live-after-result",
      state: "done",
      note: "real completion",
    }],
  );
});

test("auto-mission watcher keeps fenced status examples inert", () => {
  const text = [
    "```xml",
    '<coven:auto-status state="done" note="literal" />',
    "```",
  ].join("\n");
  assert.deepEqual(
    pendingAutoMissionPings(base, [{ id: "t-code", role: "assistant", text }]),
    [],
  );
});

test("auto-mission watcher wires each current turn through one stage-local result scan", () => {
  assert.match(
    autoMissionSource,
    /import \{ scanChatResultProtocol \} from "\.\/chat-result-markers\.ts";/,
    "the watcher should use the shared result-protocol scanner",
  );
  assert.match(
    autoMissionSource,
    /const resultProtocol = scanChatResultProtocol\(t\.text\);\s*const \{ update \} = extractAutoStatusMarkers\(\s*t\.text,\s*resultProtocol\.markdownRangeSource,\s*resultProtocol\.protectedRanges,\s*\);/,
    "the same current turn must supply text, Markdown range source, and opaque result spans to auto-status extraction",
  );
});

// ── the watchdog: the mission that never says anything ───────────────────────

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const armed: AutoMissionRecord = { ...base, startedAt: new Date(T0).toISOString() };
const quietTurn = { id: "t1", role: "assistant", text: "thinking out loud, no marker" };

test("a mission that never emits a terminal marker times out instead of hanging forever", () => {
  assert.equal(isAutoMissionTimedOut(armed, [quietTurn], T0 + 60_000), false, "not straight away");
  assert.equal(isAutoMissionTimedOut(armed, [quietTurn], T0 + AUTO_MISSION_TIMEOUT_MS), true);
});

test("a stream still in flight is alive however long it runs", () => {
  const streaming = [{ id: "t1", role: "assistant", text: "…", pending: true }];
  assert.equal(isAutoMissionTimedOut(armed, streaming, T0 + AUTO_MISSION_TIMEOUT_MS * 10), false);
});

test("recent activity holds the deadline off — a long working mission is not cut short", () => {
  const busy = touchAutoMission(armed, T0 + AUTO_MISSION_TIMEOUT_MS - 1);
  assert.equal(isAutoMissionTimedOut(busy, [quietTurn], T0 + AUTO_MISSION_TIMEOUT_MS), false);
  assert.equal(isAutoMissionTimedOut(busy, [quietTurn], T0 + AUTO_MISSION_TIMEOUT_MS * 2), true);
});

test("an ended mission never times out", () => {
  const ended = { ...armed, completedAt: new Date(T0).toISOString(), outcome: "done" as const };
  assert.equal(isAutoMissionTimedOut(ended, [quietTurn], T0 + AUTO_MISSION_TIMEOUT_MS * 5), false);
});

test("touch is a no-op when nothing is newer, so callers can skip the write", () => {
  const touched = touchAutoMission(armed, T0 + 1000);
  assert.equal(touchAutoMission(touched, T0 + 500), touched);
});

// ── failed is terminal; blocked is not ───────────────────────────────────────

test("failed pings and ends the mission", () => {
  const turns = [
    { id: "t1", role: "assistant", text: '<coven:auto-status state="failed" note="no creds" />' },
    { id: "t2", role: "assistant", text: '<coven:auto-status state="done" />' },
  ];
  const pings = pendingAutoMissionPings(armed, turns);
  assert.deepEqual(pings.map((p) => p.state), ["failed"], "nothing after a failure still pings");
});
