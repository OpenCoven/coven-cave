import assert from "node:assert/strict";
import test from "node:test";
import { shouldRouterPromoteSession } from "./chat-router-promotion.ts";

test("null→B: sessionless creation promotes into null compose view", () => {
  assert.equal(shouldRouterPromoteSession(null, null), true);
});

test("A→B: replacement on A promotes into view still on A", () => {
  assert.equal(shouldRouterPromoteSession("sess-a", "sess-a"), true);
});

test("stale C→B refusal: prev moved to C while origin is A — no promotion", () => {
  assert.equal(shouldRouterPromoteSession("sess-c", "sess-a"), false);
});

test("duplicate no-op: after first A→B promoted view to B, second call sees prev=B, origin=A", () => {
  assert.equal(shouldRouterPromoteSession("sess-b", "sess-a"), false);
});

test("null origin does not promote into a non-null view", () => {
  assert.equal(shouldRouterPromoteSession("sess-b", null), false);
});
