import assert from "node:assert/strict";
import { test } from "node:test";

import { arxivIdFromUrl, hfPaperUrl, isArxivPaperId, parseHfPaperReferences } from "./hf-papers.ts";

test("recognises both command spellings", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("hf paper read 2401.12345"), ["2401.12345"]);
});

test("strips a version suffix to the canonical id", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345v2"), ["2401.12345"]);
});

test("recognises HF and arXiv URLs", () => {
  assert.deepEqual(parseHfPaperReferences("https://huggingface.co/papers/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/abs/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/pdf/2401.12345"), ["2401.12345"]);
});

test("collapses every spelling of one paper to a single id", () => {
  const text = [
    "hf papers read 2401.12345",
    "https://huggingface.co/papers/2401.12345",
    "https://arxiv.org/pdf/2401.12345v3",
  ].join("\n");
  assert.deepEqual(parseHfPaperReferences(text), ["2401.12345"]);
});

test("does NOT match a bare id with no command or URL", () => {
  assert.deepEqual(parseHfPaperReferences("the figure on 2401.12345 is wrong"), []);
});

test("does NOT match an over-long number", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.1234567"), []);
});

// ── arxivIdFromUrl: the classifier, for values that already ARE URLs ─────────

test("classifies the canonical paper URLs, version suffix and all", () => {
  assert.equal(arxivIdFromUrl("https://huggingface.co/papers/2401.12345"), "2401.12345");
  assert.equal(arxivIdFromUrl("https://www.huggingface.co/papers/2401.12345"), "2401.12345");
  assert.equal(arxivIdFromUrl("https://arxiv.org/abs/2401.12345"), "2401.12345");
  assert.equal(arxivIdFromUrl("http://arxiv.org/abs/2401.12345v2"), "2401.12345");
  assert.equal(arxivIdFromUrl("https://arxiv.org/pdf/2401.12345.pdf"), "2401.12345");
  assert.equal(arxivIdFromUrl("  https://arxiv.org/pdf/2401.1234  "), "2401.1234");
});

test("a URL that merely EMBEDS a paper URL is not that paper", () => {
  // The whole reason this exists next to the free-text scanner: these are
  // ordinary pastes, and the scanner matches every one of them.
  const wrappers = [
    "https://www.google.com/url?q=https://arxiv.org/abs/2401.12345",
    "https://r.jina.ai/https://arxiv.org/abs/2401.12345",
    "https://web.archive.org/web/2024/https://arxiv.org/abs/2401.12345",
    "https://example.com/notes#https://huggingface.co/papers/2401.12345",
  ];
  for (const url of wrappers) {
    assert.equal(arxivIdFromUrl(url), null, `must refuse ${url}`);
    assert.deepEqual(
      parseHfPaperReferences(url),
      ["2401.12345"],
      "the free-text scanner still matches — that is why the classifier exists",
    );
  }
});

test("refuses look-alike hosts, wrong paths, and unparseable input", () => {
  const bad = [
    "https://arxiv.org.evil.com/abs/2401.12345",
    "https://evil.com/arxiv.org/abs/2401.12345",
    "https://huggingface.co.evil.com/papers/2401.12345",
    "https://huggingface.co/spaces/2401.12345",
    "https://arxiv.org/abs/2401.12345/../../secret",
    "https://arxiv.org/abs/2401.1234567",
    "ftp://arxiv.org/abs/2401.12345",
    "arxiv.org/abs/2401.12345",
    "not a url",
    "",
  ];
  for (const url of bad) {
    assert.equal(arxivIdFromUrl(url), null, `must refuse ${JSON.stringify(url)}`);
  }
});

test("canonical URL and id guard", () => {
  assert.equal(hfPaperUrl("2401.12345"), "https://huggingface.co/papers/2401.12345");
  assert.equal(isArxivPaperId("2401.12345"), true);
  assert.equal(isArxivPaperId("2401.1234567"), false);
  assert.equal(isArxivPaperId("../etc/passwd"), false);
});
