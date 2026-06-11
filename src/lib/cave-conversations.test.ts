// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const previousHome = process.env.HOME;
const home = await mkdtemp(path.join(tmpdir(), "cave-conversations-"));
process.env.HOME = home;

const {
  deleteConversation,
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
} = await import("./cave-conversations.ts");

assert.equal(isSafeConversationSessionId("session-1"), true);
assert.equal(isSafeConversationSessionId("019e-a-valid-thread"), true);
assert.equal(isSafeConversationSessionId("../session-1"), false);
assert.equal(isSafeConversationSessionId("nested/session-1"), false);
assert.equal(isSafeConversationSessionId("nested\\session-1"), false);
assert.equal(isSafeConversationSessionId("."), false);
assert.equal(isSafeConversationSessionId(".."), false);
assert.equal(isSafeConversationSessionId(""), false);

await saveConversation({
  sessionId: "delete-me",
  familiarId: "charm",
  harness: "codex",
  title: "Delete me",
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  turns: [
    {
      id: "turn-1",
      role: "user",
      text: "remove this",
      createdAt: "2026-06-10T00:00:00.000Z",
    },
  ],
});

assert.equal((await loadConversation("delete-me"))?.turns.length, 1);
assert.equal(await deleteConversation("delete-me"), true);
assert.equal(await loadConversation("delete-me"), null);
assert.equal(await deleteConversation("delete-me"), false);

// CHAT-D5-02: a user-cancelled turn persists as an honest cancelled record —
// partial text kept, cancelled flag set, never re-flagged as an error.
await saveConversation({
  sessionId: "cancelled-turn",
  familiarId: "charm",
  harness: "claude",
  title: "Cancelled mid-stream",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
  turns: [
    {
      id: "turn-user",
      role: "user",
      text: "write me a long poem",
      createdAt: "2026-06-11T00:00:00.000Z",
    },
    {
      id: "turn-assistant",
      role: "assistant",
      text: "Roses are red, violets",
      createdAt: "2026-06-11T00:00:01.000Z",
      isError: false,
      cancelled: true,
    },
  ],
});
const cancelledConv = await loadConversation("cancelled-turn");
const cancelledTurn = cancelledConv?.turns.find((turn) => turn.id === "turn-assistant");
assert.equal(cancelledTurn?.cancelled, true, "cancelled flag must round-trip through the store");
assert.equal(cancelledTurn?.isError, false, "a user cancel is not an error");
assert.equal(cancelledTurn?.text, "Roses are red, violets", "partial streamed text must survive the save");
assert.equal(await deleteConversation("cancelled-turn"), true);

// ── CHAT-D9-02: conversation content search ──────────────────────────────────
// Appended section — searchConversations over fixture transcripts written
// directly into CONV_DIR (still pointing at the temp HOME from above).
{
  const { searchConversations, CONV_DIR } = await import("./cave-conversations.ts");
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(CONV_DIR, { recursive: true });

  const fixture = (sessionId, updatedAt, texts) =>
    JSON.stringify({
      sessionId,
      familiarId: "charm",
      harness: "codex",
      title: `Title ${sessionId}`,
      createdAt: updatedAt,
      updatedAt,
      turns: texts.map((text, i) => ({
        id: `t${i}`,
        role: i % 2 ? "assistant" : "user",
        text,
        createdAt: updatedAt,
      })),
    });

  await writeFile(
    path.join(CONV_DIR, "search-hit.json"),
    fixture("search-hit", "2026-06-11T01:00:00.000Z", [
      "let's plan the trip",
      "We should book the Kyoto ryokan in autumn.\nKyoto is busy then.",
    ]),
    "utf8",
  );
  await writeFile(
    path.join(CONV_DIR, "search-miss.json"),
    fixture("search-miss", "2026-06-11T02:00:00.000Z", ["nothing relevant here"]),
    "utf8",
  );
  await writeFile(path.join(CONV_DIR, "search-corrupt.json"), "{ not json", "utf8");

  // Body match → one hit per conversation, with snippet + match count;
  // the corrupt file alongside must be skipped, not thrown on.
  const hits = await searchConversations("kyoto");
  assert.equal(hits.length, 1, "one conversation matches 'kyoto'");
  assert.equal(hits[0].sessionId, "search-hit");
  assert.equal(hits[0].matchCount, 2, "matchCount counts every occurrence across turns");
  assert.match(hits[0].snippet, /Kyoto ryokan/, "snippet centers on the first match");
  assert.doesNotMatch(hits[0].snippet, /\n/, "snippet is single-line");
  assert.ok(hits[0].snippet.length <= 100, "snippet stays excerpt-sized");

  // No match → empty; never an error.
  assert.deepEqual(await searchConversations("zanzibar"), []);

  // Min query length 2 (whitespace doesn't count).
  assert.deepEqual(await searchConversations("k"), []);
  assert.deepEqual(await searchConversations("  k  "), []);
  assert.deepEqual(await searchConversations(""), []);

  // Result cap — most recently updated conversations win.
  for (let i = 0; i < 5; i++) {
    await writeFile(
      path.join(CONV_DIR, `cap-${i}.json`),
      fixture(`cap-${i}`, `2026-06-12T0${i}:00:00.000Z`, ["the otters convene at dawn"]),
      "utf8",
    );
  }
  const capped = await searchConversations("otters", { limit: 3 });
  assert.equal(capped.length, 3, "limit caps the hit list");
  assert.deepEqual(
    capped.map((h) => h.sessionId),
    ["cap-4", "cap-3", "cap-2"],
    "most recently updated conversations rank first",
  );

  // Oversized transcripts are skipped gracefully, not scanned.
  assert.deepEqual(
    await searchConversations("kyoto", { maxFileBytes: 10 }),
    [],
    "files above the byte cap are skipped",
  );
}

if (previousHome === undefined) {
  delete process.env.HOME;
} else {
  process.env.HOME = previousHome;
}
await rm(home, { recursive: true, force: true });

console.log("cave-conversations.test.ts: ok");
