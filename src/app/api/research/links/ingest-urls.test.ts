import assert from "node:assert/strict";
import { test } from "node:test";

import { collectIngestUrls } from "./ingest-urls.ts";

test("a command with no URL still yields the canonical paper URL", () => {
  assert.deepEqual(
    collectIngestUrls({ text: "hf papers read 2401.12345" }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("a paper pasted twice in different spellings yields one URL", () => {
  assert.deepEqual(
    collectIngestUrls({ text: "hf papers read 2401.12345 https://arxiv.org/abs/2401.12345" }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("ordinary URLs still come through", () => {
  const urls = collectIngestUrls({ text: "see https://example.com/post" });
  assert.ok(urls.includes("https://example.com/post"));
});

test("explicit urls array is honoured alongside text", () => {
  const urls = collectIngestUrls({ urls: ["https://example.com/a"], text: "https://example.com/b" });
  assert.ok(urls.includes("https://example.com/a"));
  assert.ok(urls.includes("https://example.com/b"));
});

test("an unrelated arXiv URL is kept when no command references it", () => {
  const urls = collectIngestUrls({ text: "https://arxiv.org/abs/2401.12345" });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("2401.12345"));
});

test("non-string junk is ignored", () => {
  assert.deepEqual(collectIngestUrls({ urls: [1, null, ""], text: 42 as unknown as string }), []);
});
