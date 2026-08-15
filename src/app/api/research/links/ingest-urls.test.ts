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

// ── urls[] entries are classified, not scanned ───────────────────────────────
// chat-view posts `{ urls, source: "chat" }` with no text, so everything below
// is the live in-app path.

test("a paper URL pasted into chat canonicalizes like the command spelling", () => {
  assert.deepEqual(
    collectIngestUrls({ urls: ["https://arxiv.org/abs/2401.12345"] }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("the same paper saved from chat and from the paste box is ONE resource", () => {
  assert.deepEqual(
    collectIngestUrls({
      urls: ["https://arxiv.org/pdf/2401.12345v2.pdf"],
      text: "hf papers read 2401.12345",
    }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("a wrapper URL that merely embeds a paper URL passes through untouched", () => {
  // It is somebody else's page: rewriting it would replace the resource, and
  // dropping it would lose the paste. Both happened while urls[] was scanned
  // with the free-text matcher.
  const wrapper = "https://www.google.com/url?q=https://arxiv.org/abs/2401.12345";
  assert.deepEqual(collectIngestUrls({ urls: [wrapper] }), [wrapper]);
  assert.deepEqual(
    collectIngestUrls({ urls: [wrapper], text: "hf papers read 2401.12345" }),
    ["https://huggingface.co/papers/2401.12345", wrapper],
  );
});

test("non-string junk is ignored", () => {
  assert.deepEqual(collectIngestUrls({ urls: [1, null, ""], text: 42 as unknown as string }), []);
});
