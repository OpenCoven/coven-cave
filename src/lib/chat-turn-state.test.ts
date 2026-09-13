import assert from "node:assert/strict";
import { test } from "node:test";
import { mapConversationHistoryTurns, mergeConversationHistoryProjection, type ConversationHistoryPayload, type ConversationHistoryTurn } from "./chat-turn-state.ts";

test("reviewed imports retain inert provenance through history normalization", () => {
  const reviewedExcerpt = {
    schemaVersion: 1 as const, kind: "reviewed-excerpt" as const, sourceSessionId: "side-source",
    sourceRevision: "a".repeat(64), sourceTurnIds: ["source-turn"], sourceDigest: "b".repeat(64),
    reviewedDigest: "c".repeat(64), edited: true, operationId: "reviewed-operation", inert: true as const,
  };
  const mapped = mapConversationHistoryTurns([{
    id: "import", role: "user", text: '<coven:auto-status state="done" />',
    createdAt: "2026-09-09T00:00:00Z", reviewedExcerpt,
  }]);
  assert.deepEqual(mapped[0].reviewedExcerpt, reviewedExcerpt);
  assert.equal(mapped[0].text, '<coven:auto-status state="done" />');
});
import { resolveActivePath } from "./conversation-tree.ts";
import { buildChatContinuityChapters, hasValidChatContinuityLineage } from "./chat-continuity-chapters.ts";

const history: ConversationHistoryTurn[] = [
  { id: "reply", parentId: "system", role: "assistant", text: "Original reply", createdAt: "2026-09-08T12:00:00Z" },
  { id: "echo", parentId: null, role: "system", text: "Persisted orphan echo", createdAt: "2026-09-07T13:00:00Z" },
  { id: "system", parentId: "user", role: "system", text: "Persisted system ancestor", createdAt: "2026-09-07T12:00:00Z" },
  { id: "user", parentId: null, role: "user", text: "Original request", createdAt: "2026-09-06T12:00:00Z" },
];

test("history mapping keeps default-off legacy filtering", () => {
  const legacy = mapConversationHistoryTurns(history);
  assert.deepEqual(legacy.map((turn) => turn.id), ["reply", "user"]);
  assert.deepEqual(mapConversationHistoryTurns(history, { includeSystem: false }), legacy);
  assert.deepEqual(resolveActivePath(legacy, "reply").map((turn) => turn.id), ["reply"]);
});

test("opt-in history resolves system ancestors and orphan echoes before chapter grouping", () => {
  const before = JSON.stringify(history);
  const mapped = mapConversationHistoryTurns(history, { includeSystem: true });
  assert.deepEqual(mapped.map((turn) => turn.id), history.map((turn) => turn.id));
  const path = resolveActivePath(mapped, "reply");
  assert.deepEqual(path.map((turn) => turn.id), ["user", "system", "echo", "reply"]);
  assert.deepEqual(buildChatContinuityChapters("exact", path, true).chapters.map(
    ({ id, firstTurnId, lastTurnId, turnCount }) => [id, firstTurnId, lastTurnId, turnCount],
  ), [
    [JSON.stringify(["utc-day-v1", "exact", "user"]), "user", "user", 1],
    [JSON.stringify(["utc-day-v1", "exact", "system"]), "system", "echo", 2],
    [JSON.stringify(["utc-day-v1", "exact", "reply"]), "reply", "reply", 1],
  ]);
  assert.equal(JSON.stringify(history), before);
  for (const turn of mapped) {
    const raw = history.find((candidate) => candidate.id === turn.id)!;
    assert.equal(turn.text, raw.text);
    assert.equal(turn.parentId, raw.parentId);
    assert.equal(turn.createdAt, raw.createdAt);
  }
});

test("toggle projection preserves newer streaming objects and does not resurrect removed ordinary turns", () => {
  const legacy = mapConversationHistoryTurns(history);
  const updated = { ...legacy[0], text: "Live replacement", pending: true };
  const localEcho = { id: "local", role: "system" as const, text: "Live echo", createdAt: "2026-09-09T12:00:00Z" };
  const current = [updated, localEcho];
  const before = JSON.stringify(current);
  const projected = mergeConversationHistoryProjection(current, mapConversationHistoryTurns(history, { includeSystem: true }));
  assert.deepEqual(projected.map((turn) => turn.id), ["reply", "echo", "system", "local"]);
  assert.equal(projected[0], updated);
  assert.equal(projected.at(-1), localEcho);
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(current.map((turn) => turn.id), ["reply", "local"], "off-mode send state stays unchanged");
  assert.deepEqual(
    mergeConversationHistoryProjection(projected, mapConversationHistoryTurns(history, { includeSystem: true })),
    projected,
    "a live snapshot that already contains systems must not duplicate them",
  );
});

test("mapped system rows retain equal timestamps and clock-reversed ancestor order", () => {
  const raw = history.filter((turn) => turn.id !== "echo").map((turn) => ({
    ...turn,
    createdAt: turn.id === "reply" ? "2026-09-08T12:00:00Z" : "2026-09-09T12:00:00Z",
  }));
  const path = resolveActivePath(mapConversationHistoryTurns(raw, { includeSystem: true }), "reply");
  assert.deepEqual(path.map((turn) => turn.id), ["user", "system", "reply"]);
  assert.deepEqual(buildChatContinuityChapters("exact", path, true).chapters.map(
    ({ firstTurnId, lastTurnId, turnCount }) => [firstTurnId, lastTurnId, turnCount],
  ), [["user", "system", 2], ["reply", "reply", 1]]);
});

for (const linked of [true, false]) test(`persisted absent-leaf mapping ${linked ? "refuses sibling chapter authority" : "keeps unlinked legacy source order"}`, () => {
  const raw: ConversationHistoryTurn[] = [
    { id: "root", parentId: null, role: "user", text: "Original root", createdAt: "2026-09-09T12:00:00Z" },
    { id: "childA", parentId: linked ? "root" : undefined, role: "assistant", text: "Original child A", createdAt: "2026-09-08T12:00:00Z" },
    { id: "childB", parentId: linked ? "root" : null, role: "assistant", text: "Original child B", createdAt: "2026-09-07T12:00:00Z" },
  ];
  const payload: ConversationHistoryPayload = { ok: true, conversation: { turns: raw } };
  const before = JSON.stringify(payload);
  const leaf = payload.conversation?.activeLeafId ?? "";
  const mapped = mapConversationHistoryTurns(raw, { includeSystem: true });
  const readable = leaf ? resolveActivePath(mapped, leaf) : mapped;
  const index = buildChatContinuityChapters("exact",
    hasValidChatContinuityLineage(raw, leaf) ? readable : [], true);
  assert.equal(index.status, linked ? "unavailable" : "partial");
  assert.deepEqual(index.chapters.map((chapter) => chapter.firstTurnId), linked ? [] : ["root", "childA", "childB"]);
  assert.deepEqual(readable.map(({ id, text, parentId }) => [id, text, parentId]),
    raw.map(({ id, text, parentId }) => [id, text, parentId]));
  assert.equal(Object.hasOwn(payload.conversation!, "activeLeafId"), false);
  assert.equal(JSON.stringify(payload), before);
});
