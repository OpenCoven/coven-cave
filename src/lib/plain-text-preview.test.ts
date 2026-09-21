import assert from "node:assert/strict";
import { stripInlineMarkdown } from "./plain-text-preview.ts";

// Harness-transcript leak seen live in the Chat launch "Pick up where you left
// off" list and the session rail.
assert.equal(
  stripInlineMarkdown("## Prior conversation **User:** Push cody/astra"),
  "Prior conversation User: Push cody/astra",
);
assert.equal(
  stripInlineMarkdown("**Not saved to Canvas yet:** its backing file is open"),
  "Not saved to Canvas yet: its backing file is open",
);
// Nested wrappers unwrap fully.
assert.equal(stripInlineMarkdown("# **Fixing the parser**"), "Fixing the parser");
assert.equal(stripInlineMarkdown("> ## Retry policy"), "Retry policy");
assert.equal(stripInlineMarkdown("- [ ] `npm test` fails"), "[ ] npm test fails");
assert.equal(stripInlineMarkdown("Read [the guide](https://x.test/g) first"), "Read the guide first");
assert.equal(stripInlineMarkdown("~~old~~ new _plan_"), "old new plan");
// A title truncated mid-span leaves a dangling marker; it is dropped.
assert.equal(stripInlineMarkdown("**User:** Merge PR #26 **"), "User: Merge PR #26");
// Content that merely contains markers survives.
assert.equal(stripInlineMarkdown("Compute 2*3 in snake_case"), "Compute 2*3 in snake_case");
assert.equal(stripInlineMarkdown("Rename foo_bar to fooBar"), "Rename foo_bar to fooBar");
assert.equal(stripInlineMarkdown("Version 1.2.3 release"), "Version 1.2.3 release");
// Whitespace collapses; empty and non-string inputs are empty.
assert.equal(stripInlineMarkdown("  a \n\n b  "), "a b");
assert.equal(stripInlineMarkdown(""), "");
assert.equal(stripInlineMarkdown(null), "");
assert.equal(stripInlineMarkdown(undefined), "");

console.log("plain-text-preview.test.ts: ok");
