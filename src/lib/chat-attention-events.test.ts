import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  attentionClearedSessionId,
} from "./chat-attention-events.ts";

test("validates session-scoped clear events", () => {
  assert.equal(CHAT_ATTENTION_CLEAR_EVENT, "cave:chat-attention-clear");
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-1" },
  })), "session-1");
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "  session-2  " },
  })), "session-2");
});

test("rejects wrong event types and invalid detail payloads", () => {
  assert.equal(attentionClearedSessionId(new Event(CHAT_ATTENTION_CLEAR_EVENT)), null);
  assert.equal(attentionClearedSessionId(new CustomEvent("cave:not-chat-attention-clear", {
    detail: { sessionId: "session-3" },
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: null,
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "" },
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "   " },
  })), null);
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: 123 },
  })), null);
});

console.log("chat-attention-events.test.ts: ok");
