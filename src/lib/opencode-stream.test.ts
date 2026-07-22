// @ts-nocheck
import assert from "node:assert/strict";
import { parseOpenCodeRunEvent } from "./opencode-stream.ts";

assert.deepEqual(
  parseOpenCodeRunEvent({ type: "text", sessionID: "ses_123", part: { text: "Hello" } }),
  { kind: "text", sessionId: "ses_123", text: "Hello" },
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "tool_use", sessionID: "ses_123", part: { id: "prt_1", tool: "bash", state: { input: { command: "pwd" }, output: "ok", status: "completed" } } }),
  { kind: "tool", sessionId: "ses_123", id: "prt_1", name: "bash", input: { command: "pwd" }, output: "ok", isError: false },
);
assert.deepEqual(
  parseOpenCodeRunEvent({ type: "text" }),
  { kind: "other", sessionId: undefined },
  "malformed events never produce assistant text",
);
console.log("opencode-stream.test.ts: ok");
