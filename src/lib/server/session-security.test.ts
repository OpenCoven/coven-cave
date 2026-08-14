import assert from "node:assert/strict";
import test from "node:test";

import { isValidSessionId } from "./session-id.ts";

test("accepts daemon session identifiers including Hermes and OpenCode IDs", () => {
  for (const sessionId of [
    "20260721_192314_1d8d4e",
    "e9e772b0-a282-4d1d-96dc-14e6fa3dfe7a",
    "ses_01jz2a4tq9qf3w5mn8y7abc123",
    "session-1",
  ]) {
    assert.equal(isValidSessionId(sessionId), true, sessionId);
  }
});

test("rejects session identifiers that could escape an API path", () => {
  for (const sessionId of ["", "../session", "session/next", "session?x=1", "ses_abc%2fprivate", "session id", "x".repeat(257)]) {
    assert.equal(isValidSessionId(sessionId), false, sessionId);
  }
});
