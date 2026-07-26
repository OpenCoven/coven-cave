import assert from "node:assert/strict";
import test from "node:test";
import { groupChatTranscriptThreads } from "./group-chat-transcript.ts";

test("group-chat transcript preserves user and reply arrival order", () => {
  const threads = groupChatTranscriptThreads([
    { role: "assistant", id: "orphan", replyTo: "missing", familiarId: "f1", sessionId: null, text: "late", status: "done", createdAt: "1" },
    { role: "user", id: "u1", text: "first", createdAt: "2", targetFamiliarIds: ["f1"] },
    { role: "assistant", id: "r1", replyTo: "u1", familiarId: "f1", sessionId: null, text: "one", status: "done", createdAt: "3" },
    { role: "assistant", id: "r2", replyTo: "u1", familiarId: "f2", sessionId: null, text: "two", status: "done", createdAt: "4" },
    { role: "user", id: "u2", text: "second", createdAt: "5", targetFamiliarIds: ["f2"] },
  ]);
  assert.deepEqual(threads.map((thread) => [thread.user.id, thread.replies.map((reply) => reply.id)]), [["u1", ["r1", "r2"]], ["u2", []]]);
});
