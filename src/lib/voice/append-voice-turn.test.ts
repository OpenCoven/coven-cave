// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-append-"));
process.env.HOME = TMP;

const { appendVoiceOriginTurn } = await import("./append-voice-turn.ts");
const { withConversationLock, loadConversation, saveConversation, deleteConversation } = await import(
  "../cave-conversations.ts"
);

const SESSION_ID = "sess-app";

function seedConv(id = SESSION_ID) {
  const dir = join(TMP, ".coven", "cave", "conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      sessionId: id,
      familiarId: "m",
      harness: "claude",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      turns: [
        { id: "t0", role: "user", text: "hello", createdAt: "2026-06-01T00:00:00Z" },
      ],
    }),
  );
}

function readConv(id = SESSION_ID) {
  const dir = join(TMP, ".coven", "cave", "conversations");
  return JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
}

function convExists(id) {
  return existsSync(join(TMP, ".coven", "cave", "conversations", `${id}.json`));
}

/**
 * Deterministic (no-sleep) barrier: hold `withConversationLock(id, ...)`
 * open until every operation under test has been *enqueued* (each call
 * synchronously chains onto `conversationLockTails` before its first
 * `await`), then release. Execution order after release is exactly
 * enqueue order — proven, not timing-dependent.
 */
function openLockBarrier(id) {
  let release;
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  const hold = withConversationLock(id, async () => {
    markEntered();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  return { entered, hold, release: () => release() };
}

test("appends a turn with origin:voice and voiceCallId stamped", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-abc",
    role: "assistant",
    text: "I'm here.",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns.length, 2);
  const t = conv.turns[1];
  assert.equal(t.role, "assistant");
  assert.equal(t.text, "I'm here.");
  assert.equal(t.origin, "voice");
  assert.equal(t.voiceCallId, "call-abc");
  assert.equal(typeof t.id, "string");
  assert.ok(t.id.length > 0);
});

test("does not mutate prior turns", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-xyz",
    role: "user",
    text: "...",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns[0].id, "t0");
  assert.equal(conv.turns[0].role, "user");
  assert.equal(conv.turns[0].text, "hello");
  assert.equal(conv.turns[0].origin, undefined);
  assert.equal(conv.turns[0].voiceCallId, undefined);
});

test("does nothing when session file is missing (matches appendTurn behavior)", async () => {
  await appendVoiceOriginTurn("no-such-session", {
    callId: "call-1",
    role: "user",
    text: "x",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const dir = join(TMP, ".coven", "cave", "conversations");
  assert.equal(existsSync(join(dir, "no-such-session.json")), false);
});

// ── Deterministic race coverage: appendTurn's withConversationLock wrap ──────
// (cave-cl4k9 fix). Both scenarios below hold the per-conversation lock open
// with `openLockBarrier`, enqueue the operations under test while it's held
// (so their execution order after release is fixed by enqueue order, never
// by timing), then release and await — no sleeps anywhere.

test("voice append racing a queued client metadata write (PATCH-shaped) preserves both the appended turn and the metadata change", async () => {
  const id = "sess-append-vs-patch";
  seedConv(id);

  const barrier = openLockBarrier(id);
  await barrier.entered;

  // Enqueued first: the voice-origin append (appendVoiceOriginTurn ->
  // appendTurn -> withConversationLock).
  const appendPromise = appendVoiceOriginTurn(id, {
    callId: "call-race",
    role: "assistant",
    text: "Racing append.",
    createdAt: "2026-06-09T12:05:00Z",
  });
  // Enqueued second: a client PATCH-shaped metadata write, using the exact
  // same load -> mutate -> save under lock shape the internal route's PATCH
  // handler uses.
  const patchPromise = withConversationLock(id, async () => {
    const conv = await loadConversation(id);
    assert.ok(conv, "the queued metadata write must see the append that ran ahead of it, never a stale/missing read");
    assert.equal(conv.turns.length, 2, "the metadata write's load must observe the already-applied append");
    conv.modelIntent = {
      model: "anthropic/claude-haiku-4-5",
      source: "session",
      applicationState: "saved",
      reason: "Saved for this chat.",
    };
    await saveConversation(conv);
  });

  barrier.release();
  await barrier.hold;
  await appendPromise;
  await patchPromise;

  const conv = readConv(id);
  assert.equal(conv.turns.length, 2, "the appended turn must survive the racing metadata write");
  assert.equal(conv.turns[1].text, "Racing append.");
  assert.equal(conv.turns[1].origin, "voice");
  assert.equal(
    conv.modelIntent?.model,
    "anthropic/claude-haiku-4-5",
    "the metadata write must survive the racing append",
  );
});

test("voice append queued behind a client DELETE sees the conversation missing and does not resurrect it", async () => {
  const id = "sess-append-vs-delete";
  seedConv(id);

  const barrier = openLockBarrier(id);
  await barrier.entered;

  // Enqueued first: a client DELETE, using the same unlocked
  // `deleteConversation` primitive under the shared per-conversation lock
  // the internal route's DELETE handler uses.
  const deletePromise = withConversationLock(id, async () => {
    await deleteConversation(id);
  });
  // Enqueued second: the voice append, queued behind the delete.
  const appendPromise = appendVoiceOriginTurn(id, {
    callId: "call-after-delete",
    role: "user",
    text: "Should not resurrect.",
    createdAt: "2026-06-09T12:06:00Z",
  });

  barrier.release();
  await barrier.hold;
  await deletePromise;
  await appendPromise;

  assert.equal(
    convExists(id),
    false,
    "an append queued behind a winning DELETE must never recreate the conversation file",
  );
});
