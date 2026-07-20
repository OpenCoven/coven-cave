import assert from "node:assert/strict";
import test from "node:test";
import { lastRegenerableQuickChatMessageId } from "./quick-chat-thread-state.ts";

test("quick-chat only regenerates the latest persisted assistant response", () => {
  assert.equal(lastRegenerableQuickChatMessageId([]), null);
  assert.equal(lastRegenerableQuickChatMessageId([
    { id: "a", role: "assistant" },
    { id: "local", role: "assistant", local: true },
    { id: "u", role: "user" },
  ]), "a");
});
