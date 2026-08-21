// @ts-nocheck
// Route tests for DELETE /api/chat/conversation/[id]/turns/[turnId].
//
// COVEN_CAVE_HOME (and the CONV_DIR derived from it) is computed once at
// module load by cave-conversations.ts, so it must be set BEFORE route.ts is
// imported — a static import would hoist above the assignment and point every
// call at the real ~/.coven store. Hence the dynamic import below, matching
// the sibling test for /chat/conversation/[id].
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "conversation-turn-route-"));
const TMP_COVEN = mkdtempSync(join(tmpdir(), "conversation-turn-route-coven-"));
process.env.COVEN_CAVE_HOME = TMP;
process.env.COVEN_HOME = TMP_COVEN;

const CONV_DIR = join(TMP, "conversations");

const { DELETE } = await import("./route.ts");

function turn(id: string, parentId: string | null, seconds: number, text = id) {
  return {
    id,
    parentId,
    role: id.startsWith("u") ? "user" : "assistant",
    text,
    createdAt: `2026-06-01T00:00:${String(seconds).padStart(2, "0")}.000Z`,
  };
}

function writeConversation(id: string, turns: unknown[], extra: Record<string, unknown> = {}) {
  mkdirSync(CONV_DIR, { recursive: true });
  writeFileSync(
    join(CONV_DIR, `${id}.json`),
    JSON.stringify({
      sessionId: id,
      familiarId: "milo",
      harness: "claude",
      title: "Test chat",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      turns,
      ...extra,
    }),
  );
}

function readConversation(id: string) {
  return JSON.parse(readFileSync(join(CONV_DIR, `${id}.json`), "utf8"));
}

function call(id: string, turnId: string) {
  return DELETE(new Request(`http://127.0.0.1/api/chat/conversation/${id}/turns/${turnId}`), {
    params: Promise.resolve({ id, turnId }),
  });
}

test("deleting a turn persists to the conversation file", async () => {
  writeConversation("sess-basic", [turn("u1", null, 1), turn("a1", "u1", 2)], {
    activeLeafId: "a1",
  });

  const res = await call("sess-basic", "a1");
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.deleted, true);

  // The durable file is the point of the whole change — an in-memory response
  // would look identical to the client-side splice this replaces.
  const stored = readConversation("sess-basic");
  assert.deepEqual(stored.turns.map((t) => t.id), ["u1"]);
  assert.equal(stored.activeLeafId, "u1", "the leaf follows the deletion to the parent");
  assert.notEqual(stored.updatedAt, "2026-06-01T00:00:00Z", "the chat is marked touched");
});

test("deleting a turn keeps the replies that followed it", async () => {
  writeConversation(
    "sess-splice",
    [turn("u1", null, 1), turn("a1", "u1", 2), turn("u2", "a1", 3), turn("a2", "u2", 4)],
    { activeLeafId: "a2" },
  );

  await call("sess-splice", "a1");

  const stored = readConversation("sess-splice");
  assert.deepEqual(stored.turns.map((t) => t.id), ["u1", "u2", "a2"]);
  assert.equal(stored.turns.find((t) => t.id === "u2").parentId, "u1");
  assert.equal(stored.activeLeafId, "a2", "an unrelated leaf is untouched");
});

test("a repeated delete succeeds without changing anything", async () => {
  writeConversation("sess-retry", [turn("u1", null, 1), turn("a1", "u1", 2)], {
    activeLeafId: "a1",
  });

  await call("sess-retry", "a1");
  const after = readConversation("sess-retry");

  // A client whose first response was lost retries. Reporting failure here
  // would make a successful delete look broken.
  const res = await call("sess-retry", "a1");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.deleted, false);
  assert.deepEqual(readConversation("sess-retry"), after, "the second call writes nothing");
});

test("an unknown conversation is a 404, not a silent success", async () => {
  const res = await call("sess-absent", "a1");
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.ok, false);
});

test("an invalid session id is refused before any load", async () => {
  const res = await DELETE(new Request("http://127.0.0.1/x"), {
    params: Promise.resolve({ id: "../escape", turnId: "a1" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid session id");
});

test("an empty turn id is refused", async () => {
  writeConversation("sess-badturn", [turn("u1", null, 1)]);
  const res = await DELETE(new Request("http://127.0.0.1/x"), {
    params: Promise.resolve({ id: "sess-badturn", turnId: "" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "invalid turn id");
});

test("deleting the pending first turn clears the stub marker", async () => {
  // Left set, the sessions list keeps reporting a phantom failed run for a
  // turn that no longer exists.
  writeConversation("sess-stub", [turn("u1", null, 1)], {
    activeLeafId: "u1",
    pendingUserTurnId: "u1",
  });

  await call("sess-stub", "u1");

  const stored = readConversation("sess-stub");
  assert.deepEqual(stored.turns, []);
  assert.equal(stored.pendingUserTurnId, undefined);
  assert.equal(stored.activeLeafId, undefined, "no leaf is left pointing at a removed turn");
});

test("deleting every turn leaves the conversation itself in place", async () => {
  writeConversation("sess-empty", [turn("u1", null, 1)], { activeLeafId: "u1" });

  await call("sess-empty", "u1");

  // Removing the last message is not the same request as deleting the chat —
  // that is what DELETE /api/chat/conversation/[id] is for, and it also
  // sacrifices the session.
  const stored = readConversation("sess-empty");
  assert.equal(stored.sessionId, "sess-empty");
  assert.deepEqual(stored.turns, []);
});
