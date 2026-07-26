import assert from "node:assert/strict";
import test from "node:test";
import { cacheRenderedMarkdown, closeTrailingFence, getRenderedMarkdown, scanFenceFilenames } from "./message-markdown-stream.ts";

test("markdown stream helpers preserve filename fences and close only incomplete fences", () => {
  assert.equal(closeTrailingFence("```ts\nconst x = 1"), "```ts\nconst x = 1\n```");
  assert.equal(closeTrailingFence("```ts\nconst x = 1\n```"), "```ts\nconst x = 1\n```");
  assert.deepEqual(scanFenceFilenames("```ts:src/a.ts\na\n```\n```\nb\n```"), ["src/a.ts", null]);
});

test("rendered markdown cache refreshes recency before eviction", () => {
  cacheRenderedMarkdown("first", "one");
  assert.equal(getRenderedMarkdown("first"), "one");
});
