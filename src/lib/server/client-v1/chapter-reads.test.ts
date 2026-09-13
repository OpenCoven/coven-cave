import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ConversationFile } from "../../cave-conversations.ts";
import { paginateClientV1Chapters, projectClientV1Chapters } from "./chapter-reads.ts";
import { CLIENT_V1_LIMITS } from "./contract.ts";
import { decodeClientV1Cursor } from "./pagination.ts";

type GoldenCase = {
  id: string;
  conversationId: string;
  turns: { id: string; createdAt: string }[];
  expected?: { id: string; date: string; firstTurnId: string; lastTurnId: string; turnCount: number }[];
  expectedError?: string;
};

const golden = JSON.parse(readFileSync(
  new URL("../../../../docs/fixtures/familiar-continuity-v1.json", import.meta.url),
  "utf8",
)) as { contract: string; algorithm: string; cases: GoldenCase[] };
assert.equal(golden.contract, "cave.familiar-continuity-v1");
assert.equal(golden.algorithm, "utc-day-v1");
assert.ok(golden.cases.length > 0);

for (const vector of golden.cases) {
  test(`producer-owned chapter golden: ${vector.id}`, () => {
    const index = projectClientV1Chapters({
      sessionId: vector.conversationId,
      familiarId: "golden-fixture",
      harness: "fixture",
      updatedAt: "2026-09-09T00:00:00Z",
      turns: vector.turns.map((turn) => ({ ...turn, role: "user", text: "" })),
    });
    if (vector.expectedError) {
      assert.equal(index.status, "unavailable", vector.id);
      assert.deepEqual(index.chapters, [], vector.id);
      return;
    }
    assert.ok(vector.expected, `${vector.id} must declare an expected result`);
    assert.deepEqual(index.chapters.map(({ id, day, firstTurnId, lastTurnId, turnCount }) => ({
      id, date: day, firstTurnId, lastTurnId, turnCount,
    })), vector.expected, vector.id);
    if (vector.turns.length > 0) assert.equal(index.status, "complete", vector.id);
  });
}

const conversation: ConversationFile = {
  sessionId: "one", familiarId: "same-name", harness: "claude", updatedAt: "2026-09-09T00:00:00Z",
  activeLeafId: "c",
  turns: [
    { id: "a", parentId: null, role: "user", text: "private text", createdAt: "2026-09-08T23:00:00Z" },
    { id: "abandoned", parentId: "a", role: "assistant", text: "not on branch", createdAt: "2026-09-09T00:00:00Z" },
    { id: "b", parentId: "a", role: "assistant", text: "reply", createdAt: "2026-09-08T23:00:00Z" },
    { id: "c", parentId: "b", role: "user", text: "next day", createdAt: "2026-09-09T00:00:00Z" },
  ],
};

test("chapter headers preserve branch order, stable anchors, counts and no text", () => {
  const index = projectClientV1Chapters(conversation);
  assert.equal(index.status, "complete");
  assert.equal(index.contextStatus, "context-unverified");
  assert.equal(index.chapters.length, 2);
  assert.deepEqual(index.chapters[0], {
    id: JSON.stringify(["utc-day-v1", "one", "a"]), conversationId: "one",
    firstTurnId: "a", lastTurnId: "b", day: "2026-09-08", turnCount: 2,
  });
  assert.ok(!JSON.stringify(index).includes("private text"));
  assert.ok(!JSON.stringify(index).includes("abandoned"));
});

test("bounded chapter cursors reject principal, conversation, edit, branch and deleted-anchor changes", () => {
  const first = paginateClientV1Chapters(conversation, "principal", { limit: 1, after: null })!;
  assert.equal(first.cursor.hasMore, true);
  assert.ok(first.cursor.next!.length <= 512);
  const after = decodeClientV1Cursor(first.cursor.next!);
  assert.equal(paginateClientV1Chapters(conversation, "principal", { limit: 1, after })!.data.chapters[0].firstTurnId, "c");
  for (const changed of [
    { ...conversation, sessionId: "two" },
    { ...conversation, activeLeafId: "abandoned" },
    { ...conversation, turns: conversation.turns.slice(1) },
    { ...conversation, turns: conversation.turns.map((turn) => ({ ...turn, text: "edited" })) },
  ]) assert.equal(paginateClientV1Chapters(changed, "principal", { limit: 1, after }), null);
  assert.equal(paginateClientV1Chapters(conversation, "different-principal", { limit: 1, after }), null);
});

test("broken metadata produces unavailable, never an invented complete empty transcript", () => {
  for (const changed of [
    { ...conversation, activeLeafId: "gone" },
    { ...conversation, turns: [] },
    { ...conversation, turns: conversation.turns.map((turn) => ({ ...turn, createdAt: "2026-02-30T00:00:00Z" })) },
    { ...conversation, turns: conversation.turns.map((turn) => ({ ...turn, createdAt: undefined })) },
    { ...conversation, turns: [...conversation.turns, conversation.turns[0]] },
    { ...conversation, turns: conversation.turns.map((turn) => ({ ...turn, parentId: "c" })) },
  ]) assert.equal(projectClientV1Chapters(changed as ConversationFile).status, "unavailable");
});

test("missing or malformed active leaves never certify mixed branches", () => {
  for (const activeLeafId of [undefined, null, "", 0, false, {}, []]) {
    const raw: unknown = { ...conversation, activeLeafId };
    assert.equal(projectClientV1Chapters(raw as ConversationFile).status, "unavailable");
  }
  assert.equal(projectClientV1Chapters({
    ...conversation, turns: [{ ...conversation.turns[0], id: "bad-parent", parentId: "" }],
    activeLeafId: "bad-parent",
  }).status, "unavailable");
});

test("long source anchors still produce bounded resumable chapter cursors", () => {
  const firstId = "source-anchor-".repeat(100);
  const record: ConversationFile = {
    ...conversation, activeLeafId: "next",
    turns: [
      { ...conversation.turns[0], id: firstId, parentId: null },
      { ...conversation.turns[3], id: "next", parentId: firstId },
    ],
  };
  const first = paginateClientV1Chapters(record, "principal", { limit: 1, after: null })!;
  assert.ok(first.cursor.next);
  assert.ok(first.cursor.next.length <= CLIENT_V1_LIMITS.cursorCharacters);
  const second = paginateClientV1Chapters(record, "principal", {
    limit: 1, after: decodeClientV1Cursor(first.cursor.next),
  })!;
  assert.equal(second.data.chapters[0].firstTurnId, "next");
});

function measureConversationReads(source: ConversationFile) {
  const reads = { metadata: 0, text: 0 };
  const handler: ProxyHandler<ConversationFile["turns"][number]> = {
    get(target, property, receiver) {
      if (property === "text") reads.text += 1;
      else if (property === "id" || property === "parentId" || property === "createdAt" || property === "role") {
        reads.metadata += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  };
  return {
    record: { ...source, turns: source.turns.map((turn) => new Proxy(turn, handler)) },
    reads,
  };
}

test("100k-turn, 1000-chapter pages use bounded linear metadata work and one body serialization per request", (context) => {
  const stringify = context.mock.method(JSON, "stringify");
  const turnCount = 100_000;
  const chapterCount = 1000;
  const turnsPerChapter = turnCount / chapterCount;
  const dates = Array.from({ length: chapterCount }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1) + index * 86_400_000).toISOString());
  const { record, reads } = measureConversationReads({
    sessionId: "large-exact-conversation", familiarId: "fixture", harness: "fixture",
    updatedAt: dates.at(-1)!, activeLeafId: `turn-${turnCount - 1}`,
    turns: Array.from({ length: turnCount }, (_, index) => ({
      id: `turn-${index}`, parentId: index === 0 ? null : `turn-${index - 1}`,
      role: "user", text: "fixture body never returned in headers",
      createdAt: dates[Math.floor(index / turnsPerChapter)],
    })),
  });
  const limit = CLIENT_V1_LIMITS.maxPageSize;
  let after: ReturnType<typeof decodeClientV1Cursor> | null = null;
  let revision: string | undefined;
  for (let page = 0; page < 2; page += 1) {
    const result = paginateClientV1Chapters(record, "principal", { limit, after });
    assert.ok(result);
    assert.equal(result.data.chapters.length, limit);
    assert.equal(result.data.status, "complete");
    assert.equal(result.cursor.hasMore, true);
    assert.match(result.data.sourceRevision, /^[0-9a-f]{64}$/);
    if (revision) assert.equal(result.data.sourceRevision, revision);
    revision = result.data.sourceRevision;
    for (const [index, chapter] of result.data.chapters.entries()) {
      const first = (page * limit + index) * turnsPerChapter;
      assert.equal(chapter.firstTurnId, `turn-${first}`);
      assert.equal(chapter.lastTurnId, `turn-${first + turnsPerChapter - 1}`);
      assert.equal(chapter.turnCount, turnsPerChapter);
    }
    assert.ok(!JSON.stringify(result).includes("fixture body"));
    assert.equal(reads.text, turnCount * (page + 1));
    assert.equal(stringify.mock.calls.filter(({ arguments: [value] }) =>
      value && typeof value === "object" && "turns" in value && Array.isArray(value.turns),
    ).length, page + 1);
    // Work-count regression, deliberately not a wall-clock/native p95 assertion.
    assert.ok(reads.metadata <= 40 * turnCount * (page + 1), `metadata visits: ${reads.metadata}`);
    assert.ok(result.cursor.next);
    after = decodeClientV1Cursor(result.cursor.next);
  }
});

test("standalone system echoes do not trigger repeated full branch scans", () => {
  const chainLength = 1000;
  const echoCount = 100;
  const turns: ConversationFile["turns"] = Array.from({ length: chainLength }, (_, index) => ({
    id: `turn-${index}`, parentId: index === 0 ? null : `turn-${index - 1}`,
    role: "user", text: "fixture body", createdAt: "2026-09-08T00:00:00Z",
  }));
  for (let index = 0; index < echoCount; index += 1) {
    turns.push({
      id: `echo-${String(index).padStart(3, "0")}`, parentId: null,
      role: "system", text: "fixture echo", createdAt: "2026-09-09T00:00:00Z",
    });
  }
  const { record, reads } = measureConversationReads({
    sessionId: "echo-conversation", familiarId: "fixture", harness: "fixture",
    updatedAt: "2026-09-09T00:00:00Z", activeLeafId: `turn-${chainLength - 1}`, turns,
  });
  const result = paginateClientV1Chapters(record, "principal", { limit: 1, after: null });
  assert.ok(result);
  assert.equal(result.data.chapters.length, 1);
  assert.equal(result.data.chapters[0].turnCount, chainLength);
  assert.equal(result.cursor.hasMore, true);
  assert.equal(reads.text, turns.length);
  assert.ok(reads.metadata <= 40 * turns.length, `metadata visits: ${reads.metadata}`);
});
