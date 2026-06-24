import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGroupEvent,
  parseSseBuffer,
  defaultGroupName,
  makeGroup,
  upsertGroup,
  removeGroup,
  setGroupSession,
  setGroupParticipants,
  type GroupReply,
} from "./group-chat.ts";

function baseReply(overrides: Partial<GroupReply> = {}): GroupReply {
  return {
    id: "r1",
    role: "assistant",
    familiarId: "aria",
    replyTo: "u1",
    sessionId: null,
    text: "",
    status: "queued",
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

test("applyGroupEvent: session captures the session id", () => {
  const next = applyGroupEvent(baseReply(), { kind: "session", sessionId: "sess-1" });
  assert.equal(next.sessionId, "sess-1");
});

test("applyGroupEvent: chunks append and flip status to streaming", () => {
  let r = baseReply();
  r = applyGroupEvent(r, { kind: "assistant_chunk", text: "Hel" });
  r = applyGroupEvent(r, { kind: "assistant_chunk", text: "lo" });
  assert.equal(r.text, "Hello");
  assert.equal(r.status, "streaming");
});

test("applyGroupEvent: progress sets activity but a chunk clears it", () => {
  let r = baseReply();
  r = applyGroupEvent(r, { kind: "progress", label: "Thinking", status: "running" });
  assert.equal(r.activity, "Thinking");
  assert.equal(r.status, "streaming");
  r = applyGroupEvent(r, { kind: "assistant_chunk", text: "hi" });
  assert.equal(r.activity, undefined);
});

test("applyGroupEvent: tool_use shows the tool name as activity", () => {
  const r = applyGroupEvent(baseReply(), { kind: "tool_use", name: "Read", status: "running" });
  assert.equal(r.activity, "Read…");
});

test("applyGroupEvent: done settles the reply", () => {
  let r = baseReply();
  r = applyGroupEvent(r, { kind: "assistant_chunk", text: "done text" });
  r = applyGroupEvent(r, { kind: "done", durationMs: 1200, costUsd: 0.01 });
  assert.equal(r.status, "done");
  assert.equal(r.durationMs, 1200);
  assert.equal(r.costUsd, 0.01);
  assert.equal(r.activity, undefined);
});

test("applyGroupEvent: done with isError flips to error", () => {
  const r = applyGroupEvent(baseReply(), { kind: "done", isError: true });
  assert.equal(r.status, "error");
});

test("applyGroupEvent: error captures the message", () => {
  const r = applyGroupEvent(baseReply(), { kind: "error", message: "boom" });
  assert.equal(r.status, "error");
  assert.equal(r.error, "boom");
});

test("parseSseBuffer: splits complete frames and keeps the partial tail", () => {
  const buf =
    'data: {"kind":"session","sessionId":"s1"}\n\n' +
    'data: {"kind":"assistant_chunk","text":"hi"}\n\n' +
    'data: {"kind":"assistant_chunk","text":"par';
  const { events, rest } = parseSseBuffer(buf);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "session");
  assert.equal(rest, 'data: {"kind":"assistant_chunk","text":"par');
});

test("parseSseBuffer: skips malformed frames without throwing", () => {
  const { events } = parseSseBuffer('data: not-json\n\ndata: {"kind":"error","message":"x"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "error");
});

test("defaultGroupName: friendly summaries by participant count", () => {
  assert.equal(defaultGroupName([]), "New coven");
  assert.equal(defaultGroupName(["Aria"]), "Aria");
  assert.equal(defaultGroupName(["Aria", "Boz"]), "Aria & Boz");
  assert.equal(defaultGroupName(["Aria", "Boz", "Cy", "Dot"]), "Aria, Boz +2");
});

test("makeGroup: dedupes participants and defaults the name", () => {
  const g = makeGroup("  ", ["a", "a", "b"], "2026-06-24T00:00:00.000Z", "g1");
  assert.deepEqual(g.familiarIds, ["a", "b"]);
  assert.equal(g.name, "New coven");
  assert.deepEqual(g.sessions, {});
});

test("upsertGroup: replaces by id and sorts newest-first", () => {
  const older = makeGroup("Old", ["a"], "2026-06-24T00:00:00.000Z", "g1");
  const newer = makeGroup("New", ["b"], "2026-06-24T01:00:00.000Z", "g2");
  let groups = upsertGroup([], older);
  groups = upsertGroup(groups, newer);
  assert.equal(groups[0].id, "g2");
  const edited = { ...older, name: "Edited", updatedAt: "2026-06-24T02:00:00.000Z" };
  groups = upsertGroup(groups, edited);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, "g1");
  assert.equal(groups[0].name, "Edited");
});

test("removeGroup: drops the matching id", () => {
  const g = makeGroup("X", ["a"], "2026-06-24T00:00:00.000Z", "g1");
  assert.deepEqual(removeGroup([g], "g1"), []);
});

test("setGroupSession: pins and clears a familiar's session id", () => {
  let g = makeGroup("X", ["a", "b"], "2026-06-24T00:00:00.000Z", "g1");
  g = setGroupSession(g, "a", "sess-a", "2026-06-24T01:00:00.000Z");
  assert.equal(g.sessions.a, "sess-a");
  assert.equal(g.updatedAt, "2026-06-24T01:00:00.000Z");
  g = setGroupSession(g, "a", null, "2026-06-24T02:00:00.000Z");
  assert.equal(g.sessions.a, undefined);
});

test("setGroupParticipants: drops session pins for removed familiars", () => {
  let g = makeGroup("X", ["a", "b"], "2026-06-24T00:00:00.000Z", "g1");
  g = setGroupSession(g, "a", "sess-a", "2026-06-24T01:00:00.000Z");
  g = setGroupSession(g, "b", "sess-b", "2026-06-24T01:00:00.000Z");
  g = setGroupParticipants(g, ["a", "c"], "2026-06-24T03:00:00.000Z");
  assert.deepEqual(g.familiarIds, ["a", "c"]);
  assert.equal(g.sessions.a, "sess-a");
  assert.equal(g.sessions.b, undefined);
});
