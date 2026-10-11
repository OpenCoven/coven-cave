import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldShowDockedComposer } from "./chat-composer-visibility.ts";

test("writable chats always retain their dock; flow executions remain read-only", () => {
  assert.equal(shouldShowDockedComposer({ readOnly: false }), true);
  assert.equal(shouldShowDockedComposer({ readOnly: true }), false);
});

test("scrolling and dock measurements cannot change composer mounting", () => {
  const source = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
  assert.match(source, /const showDockedComposer = shouldShowDockedComposer\(\{ readOnly: flowBackedSession \}\);/);
  assert.doesNotMatch(source, /setReleasedScrollDistance|setComposerHeight|composerDockRef/);
});
