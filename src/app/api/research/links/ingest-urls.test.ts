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

test("a raw arXiv URL with no command is rewritten to the canonical HF URL", () => {
  const urls = collectIngestUrls({ text: "https://arxiv.org/abs/2401.12345" });
  assert.deepEqual(urls, ["https://huggingface.co/papers/2401.12345"]);
});

test("non-string junk is ignored", () => {
  assert.deepEqual(collectIngestUrls({ urls: [1, null, ""], text: 42 as unknown as string }), []);
});
