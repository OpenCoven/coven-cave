import assert from "node:assert/strict";
import test from "node:test";
import { shouldRouterPromoteSession } from "./chat-router-promotion.ts";

test("valid A→B replacement promotes while router still owns A", () => {
  assert.equal(shouldRouterPromoteSession(
    { sessionId: "sess-a", composeInstance: 4 },
    { newSessionId: "sess-b", expectedSessionId: "sess-a", composeInstance: 4 },
  ), true);
});

test("stale A→B replacement cannot promote after navigation to a fresh compose", () => {
  assert.equal(shouldRouterPromoteSession(
    { sessionId: null, composeInstance: 5 },
    { newSessionId: "sess-b", expectedSessionId: "sess-a", composeInstance: 4 },
  ), false);
});

test("stale A→B replacement cannot promote after navigation to C", () => {
  assert.equal(shouldRouterPromoteSession(
    { sessionId: "sess-c", composeInstance: 4 },
    { newSessionId: "sess-b", expectedSessionId: "sess-a", composeInstance: 4 },
  ), false);
});

test("current null-origin compose promotes its newly created session", () => {
  assert.equal(shouldRouterPromoteSession(
    { sessionId: null, composeInstance: 5 },
    { newSessionId: "sess-b", expectedSessionId: null, composeInstance: 5 },
  ), true);
});

test("stale old compose nonce cannot promote into the current null compose", () => {
  assert.equal(shouldRouterPromoteSession(
    { sessionId: null, composeInstance: 5 },
    { newSessionId: "sess-b", expectedSessionId: null, composeInstance: 4 },
  ), false);
});
