import assert from "node:assert/strict";
import test from "node:test";

import {
  createGroupRetiredTranscriptStore,
  mergeRetiredRunIntoTranscript,
} from "./group-chat-retired-transcript.ts";
import type { GroupReply, GroupUserTurn } from "./group-chat.ts";

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

test("mergeRetiredRunIntoTranscript preserves original sibling order when replies settle in reverse", () => {
  const userTurn = makeUserTurn("u-1", "Order please");
  const firstReply = makeReply("r-1", userTurn.id, {
    familiarId: "nova",
    status: "done",
    text: "first",
    slotIndex: 0,
  });
  const secondReply = makeReply("r-2", userTurn.id, {
    familiarId: "sage",
    status: "done",
    text: "second",
    slotIndex: 1,
  });

  const completedSecond = mergeRetiredRunIntoTranscript([userTurn], userTurn, secondReply);
  const merged = mergeRetiredRunIntoTranscript(completedSecond, userTurn, firstReply);

  assert.deepEqual(
    merged.map((turn) => turn.id),
    [userTurn.id, firstReply.id, secondReply.id],
  );
});

test("mergeRetiredRunIntoTranscript preserves slot order across mixed terminal outcomes", () => {
  const userTurn = makeUserTurn("u-1", "Mixed outcomes");
  const firstReply = makeReply("r-1", userTurn.id, {
    familiarId: "nova",
    status: "done",
    text: "complete",
    slotIndex: 0,
  });
  const secondReply = makeReply("r-2", userTurn.id, {
    familiarId: "sage",
    status: "error",
    text: "failed",
    error: "boom",
    slotIndex: 1,
  });

  const completedSecond = mergeRetiredRunIntoTranscript([userTurn], userTurn, secondReply);
  const merged = mergeRetiredRunIntoTranscript(completedSecond, userTurn, firstReply);

  assert.deepEqual(
    merged.map((turn) =>
      turn.role === "assistant" ? { id: turn.id, status: turn.status } : { id: turn.id },
    ),
    [
      { id: userTurn.id },
      { id: firstReply.id, status: "done" },
      { id: secondReply.id, status: "error" },
    ],
  );
});
