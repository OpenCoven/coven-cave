import assert from "node:assert/strict";
import test from "node:test";

import {
  createGroupRetiredTranscriptStore,
  mergeRetiredRunIntoTranscript,
} from "./group-chat-retired-transcript";
import type { GroupReply, GroupUserTurn } from "./group-chat";

function makeUserTurn(id: string, text: string): GroupUserTurn {
  return {
    id,
    role: "user",
    text,
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

function makeReply(id: string, replyTo: string, patch: Partial<GroupReply> = {}): GroupReply {
  return {
    id,
    role: "assistant",
    familiarId: "nova",
    replyTo,
    sessionId: null,
    text: "",
    status: "queued",
    createdAt: "2026-08-06T00:00:01.000Z",
    ...patch,
  };
}

test("mergeRetiredRunIntoTranscript inserts a late reply into its original thread without disturbing newer turns", () => {
  const firstUser = makeUserTurn("u-1", "First");
  const secondUser = makeUserTurn("u-2", "Second");
  const newerReply = makeReply("r-2", secondUser.id, { status: "done", text: "newer" });
  const retiredReply = makeReply("r-1", firstUser.id, { status: "done", text: "completed" });

  const merged = mergeRetiredRunIntoTranscript(
    [firstUser, secondUser, newerReply],
    firstUser,
    retiredReply,
  );

  assert.deepEqual(
    merged.map((turn) => turn.id),
    [firstUser.id, retiredReply.id, secondUser.id, newerReply.id],
  );
  assert.equal((merged[1] as GroupReply).text, "completed");
});

test("retired transcript persistence skips a stale terminal from an older retry owner", () => {
  const saved: Array<{ groupId: string; turns: string[] }> = [];
  const userTurn = makeUserTurn("u-1", "Retry me");
  const oldReply = makeReply("r-1", userTurn.id, { status: "error", text: "old failure" });
  const newReply = makeReply("r-1", userTurn.id, { status: "done", text: "fresh completion" });
  const store = createGroupRetiredTranscriptStore({
    loadTranscript: () => [userTurn, newReply],
    saveTranscript: (groupId, turns) => {
      saved.push({ groupId, turns: turns.map((turn) => turn.id) });
    },
  });

  store.registerRun({ groupId: "g-1", scopeId: 1, runId: "run-old", userTurn, reply: oldReply });
  store.registerRun({ groupId: "g-1", scopeId: 2, runId: "run-new", userTurn, reply: newReply });

  assert.equal(store.persistRetiredRun("run-old"), false);
  assert.equal(saved.length, 0);
  assert.equal(store.persistRetiredRun("run-new"), true);
  assert.deepEqual(saved, [{ groupId: "g-1", turns: [userTurn.id, newReply.id] }]);
});
