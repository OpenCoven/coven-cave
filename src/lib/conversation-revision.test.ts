import assert from "node:assert/strict";
import test from "node:test";
import { sameConversationRevision } from "./conversation-revision.ts";

const conversation = {
  updatedAt: "2026-08-24T12:00:00.000Z",
  activeLeafId: "turn-2",
  turns: [{ id: "turn-1" }, { id: "turn-2" }],
};

test("matching persisted revision fields identify an unchanged conversation", () => {
  assert.equal(
    sameConversationRevision(conversation, {
      ...conversation,
      turns: [{ different: "objects are not traversed" }, { id: "turn-2" }],
    }),
    true,
  );
});

test("timestamp, active leaf, and turn-count changes invalidate the revision", () => {
  assert.equal(
    sameConversationRevision(conversation, {
      ...conversation,
      updatedAt: "2026-08-24T12:00:01.000Z",
    }),
    false,
  );
  assert.equal(
    sameConversationRevision(conversation, {
      ...conversation,
      activeLeafId: "turn-1",
    }),
    false,
  );
  assert.equal(
    sameConversationRevision(conversation, {
      ...conversation,
      turns: [{ id: "turn-1" }],
    }),
    false,
  );
});

test("legacy payloads without a timestamp fail open to a full refresh", () => {
  assert.equal(
    sameConversationRevision(
      { activeLeafId: "turn-2", turns: conversation.turns },
      conversation,
    ),
    false,
  );
});
