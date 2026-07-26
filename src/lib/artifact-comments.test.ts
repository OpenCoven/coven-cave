// @ts-nocheck
import assert from "node:assert/strict";
import { buildCommentsPrompt, clampFabX, normalizeExcerpt, commentsStorageKey } from "./artifact-comments.ts";

// ── normalizeExcerpt collapses whitespace and clamps long selections ─────────
assert.equal(normalizeExcerpt("  hello   world\n\nfoo "), "hello world foo");
const long = "x".repeat(400);
const norm = normalizeExcerpt(long);
assert.ok(norm.length <= 281, "long excerpts are clamped");
assert.ok(norm.endsWith("…"), "clamped excerpts get an ellipsis");

// ── buildCommentsPrompt folds comments into a revision request ───────────────
const empty = buildCommentsPrompt([]);
assert.equal(empty, "", "no comments → empty prompt (callers guard the send)");

const blankOnly = buildCommentsPrompt([{ id: "1", excerpt: "  ", note: "  " }]);
assert.equal(blankOnly, "", "comments with no excerpt and no note are dropped");

const prompt = buildCommentsPrompt([
  { id: "1", excerpt: "The intro paragraph", note: "Too long — tighten it" },
  { id: "2", excerpt: "section two", note: "" },
]);
assert.match(prompt, /2 comments/, "counts the comments");
assert.match(prompt, /revise it to address each one/, "asks for a revision addressing each");
assert.match(prompt, /summarize the changes/, "asks for a change summary on completion");
assert.match(prompt, /1\. On: “The intro paragraph”/, "quotes the first excerpt");
assert.match(prompt, /Comment: Too long — tighten it/, "includes the note");
assert.match(prompt, /2\. On: “section two”/, "quotes the second excerpt");
assert.match(prompt, /Comment: \(please reconsider this passage\)/, "a note-less comment still flags the passage");

const one = buildCommentsPrompt([{ id: "1", excerpt: "a", note: "b" }]);
assert.match(one, /1 comment\b/, "singular for a single comment");

// custom document label
const labeled = buildCommentsPrompt([{ id: "1", excerpt: "a", note: "b" }], { documentLabel: "the spec" });
assert.match(labeled, /on the spec\./, "honours a custom document label");

// ── storage key is namespaced per turn ───────────────────────────────────────
assert.equal(commentsStorageKey("t_123"), "cave:artifact-comments:v1:t_123");

// ── clampFabX keeps the fab pill fully inside the viewport ───────────────────
assert.equal(clampFabX(500, 1000), 500, "mid-viewport positions pass through");
assert.equal(clampFabX(990, 1000), 940, "right-edge positions are pulled in (margin + half-width)");
assert.equal(clampFabX(1500, 1000), 940, "positions past the edge are clamped, not lost");
assert.equal(clampFabX(10, 1000), 60, "left-edge positions are pulled in symmetrically");
assert.equal(clampFabX(-50, 1000), 60, "negative positions are clamped");
assert.equal(clampFabX(50, 100), 50, "degenerate narrow viewports fall back to center");
assert.equal(clampFabX(300, 1000, 20, 10), 300, "honours custom half-width/margin");
assert.equal(clampFabX(995, 1000, 20, 10), 970, "custom bounds clamp accordingly");

console.log("artifact-comments.test.ts: ok");
