import assert from "node:assert/strict";
import { test } from "node:test";

import { arxivPdfUrl } from "./arxiv-url.ts";

test("builds the arXiv URL from a valid id", () => {
  assert.equal(arxivPdfUrl("2401.12345"), "https://arxiv.org/pdf/2401.12345");
  assert.equal(arxivPdfUrl("2401.1234"), "https://arxiv.org/pdf/2401.1234");
});

test("refuses anything that is not an arXiv id", () => {
  const bad = [
    "../etc/passwd",
    "2401.1234567",
    "evil.com/x",
    "",
    "2401.12345 ",
    "2401.12345/../../secret",
    "https://evil.com/2401.12345",
    "2401.12345?x=1",
    "2401.12345#frag",
  ];
  for (const value of bad) {
    assert.equal(arxivPdfUrl(value), null, `must refuse ${JSON.stringify(value)}`);
  }
});
