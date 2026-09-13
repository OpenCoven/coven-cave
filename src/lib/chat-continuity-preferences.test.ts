import assert from "node:assert/strict";
import { test } from "node:test";
import { continuitySourceId, parseContinuityReference, resolveContinuityReturn } from "./chat-continuity-preferences.ts";

const reference = { sourceId: "source-a", familiarId: "nova", conversationId: "exact", anchorId: null };
const sessions = [{ id: "exact", familiarId: "nova", archived_at: null }, { id: "newest", familiarId: "nova", archived_at: null }];
test("installation identity scopes preferences even at an unchanged origin", () => {
  const first = continuitySourceId("installation-a", "http://cave.test");
  const second = continuitySourceId("installation-b", "http://cave.test");
  assert.notEqual(first, second);
  assert.equal(continuitySourceId(undefined, "http://cave.test"), "");
  assert.equal(continuitySourceId("", "http://cave.test"), "");
  assert.equal(resolveContinuityReturn({ ...reference, sourceId: first }, second, "nova", sessions, false), null);
});
test("return resolves only the exact chat, never substitutes newest or another source/familiar", () => {
  assert.equal(resolveContinuityReturn(reference, "source-a", "nova", sessions, false), "exact");
  assert.equal(resolveContinuityReturn(reference, "source-b", "nova", sessions, false), null);
  assert.equal(resolveContinuityReturn(reference, "source-a", "sage", sessions, false), null);
  assert.equal(resolveContinuityReturn(reference, "source-a", "nova", sessions.slice(1), false), null);
  assert.equal(resolveContinuityReturn(reference, "source-a", "nova", [{ ...sessions[0], familiarId: "sage" }], false), null);
  assert.equal(resolveContinuityReturn(reference, "source-a", "nova", [{ ...sessions[0], archived_at: "2026-09-09" }], false), null);
});
test("explicit deep-link or new-chat intent wins over a saved return", () => {
  assert.equal(resolveContinuityReturn(reference, "source-a", "nova", sessions, true), null);
});
test("stored preferences whitelist references; malformed and cross-chat anchors are rejected", () => {
  assert.deepEqual(parseContinuityReference(JSON.stringify({ ...reference, text: "must not persist" })), reference);
  assert.equal(parseContinuityReference("broken"), null);
  assert.equal(parseContinuityReference(JSON.stringify({ ...reference, anchorId: '["utc-day-v1","other","turn"]' })), null);
  assert.equal(parseContinuityReference(JSON.stringify({ ...reference, anchorId: '["utc-day-v1","exact","turn"]' }))?.anchorId, '["utc-day-v1","exact","turn"]');
});
