import assert from "node:assert/strict";
import { chatTitleParts } from "./chat-title-parts.ts";

for (const title of ["", "A", "Short title", "a".repeat(52), "Words with  spaces"]) {
  const { head, tail } = chatTitleParts(title);
  assert.equal(head + tail, title, "short titles retain their entire text");
}
assert.deepEqual(chatTitleParts("a".repeat(35) + "b".repeat(18)), {
  head: "a".repeat(28) + "…",
  tail: "b".repeat(18),
});
for (const grapheme of ["👩🏽‍💻", "👨‍👩‍👧‍👦", "🇺🇦", "e\u0301"]) {
  assert.deepEqual(chatTitleParts(grapheme.repeat(60)), {
    head: grapheme.repeat(28) + "…",
    tail: grapheme.repeat(18),
  }, "middle shortening must not split a grapheme");
  const title = grapheme.repeat(20);
  const { head, tail } = chatTitleParts(title);
  assert.equal(head + tail, title);
  assert.equal(tail, grapheme.repeat(8));
}
console.log("chat-title-parts.test.ts: ok");
