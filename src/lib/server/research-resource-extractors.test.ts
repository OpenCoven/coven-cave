import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractResearchResource,
  htmlToDeterministicMarkdown,
  RESEARCH_EXTRACTOR_VERSIONS,
  ResearchResourceExtractionError,
} from "./research-resource-extractors.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

function hasCode(code: ResearchResourceExtractionError["code"]) {
  return (error: unknown) => error instanceof ResearchResourceExtractionError
    && error.code === code && error.retryable === false;
}

test("plain text and Markdown use strict UTF-8 and deterministic newline normalization", async () => {
  const plain = await extractResearchResource({
    bytes: bytes("alpha\r\nbeta\rgamma\n"),
    contentType: "text/plain; charset=UTF-8",
  });
  assert.equal(text(plain.normalizedBytes), "alpha\nbeta\ngamma\n");
  assert.equal(plain.normalizedMediaType, "text/plain; charset=utf-8");
  assert.deepEqual(plain.normalizationReceipt, RESEARCH_EXTRACTOR_VERSIONS.text);

  const markdown = await extractResearchResource({
    bytes: bytes("# Heading\r\n\r\nBody"),
    contentType: "text/markdown",
  });
  assert.equal(text(markdown.normalizedBytes), "# Heading\n\nBody");
  assert.equal(markdown.normalizedMediaType, "text/markdown; charset=utf-8");
  assert.deepEqual(markdown.normalizationReceipt, RESEARCH_EXTRACTOR_VERSIONS.markdown);

  await assert.rejects(
    () => extractResearchResource({ bytes: Uint8Array.from([0xc3, 0x28]), contentType: "text/plain" }),
    hasCode("invalid_utf8"),
  );
});

test("JSON is strictly parsed and emitted as canonical JSON", async () => {
  const first = await extractResearchResource({
    bytes: bytes('{ "z": 1, "a": { "y": true, "b": null } }'),
    contentType: "application/json; charset=utf-8",
  });
  const second = await extractResearchResource({
    bytes: bytes('{"a":{"b":null,"y":true},"z":1}'),
    contentType: "application/problem+json",
  });
  assert.deepEqual(first.normalizedBytes, second.normalizedBytes);
  assert.equal(text(first.normalizedBytes), '{"a":{"b":null,"y":true},"z":1}');
  assert.equal(first.normalizedMediaType, "application/json");
  assert.deepEqual(first.normalizationReceipt, RESEARCH_EXTRACTOR_VERSIONS.json);
  await assert.rejects(
    () => extractResearchResource({ bytes: bytes("{broken"), contentType: "application/json" }),
    hasCode("malformed_json"),
  );
});

test("HTML extraction drops active, metadata, and hidden content and emits stable reviewed Markdown", async () => {
  const html = `<!doctype html>
    <html><head><title>  A &amp; B  </title><meta name="secret" content="x">
    <style>.hidden { display:none }</style></head><body>
      <script>stealCredentials()</script><noscript>fallback secret</noscript>
      <h1>Visible &amp; useful</h1>
      <div hidden>hidden attribute</div>
      <section aria-hidden="true">aria secret</section>
      <p>Read <a href="/guide?q=1">the guide</a> and <a href="javascript:evil()">plain label</a>.</p>
      <ul><li>First</li><li><strong>Second</strong></li></ul>
      <img src="https://tracker.example/pixel" onerror="evil()">
    </body></html>`;
  const direct = htmlToDeterministicMarkdown(html, "https://example.com/start");
  assert.equal(direct.title, "A & B");
  assert.match(direct.markdown, /^# Visible & useful/m);
  assert.match(direct.markdown, /\[the guide\]\(https:\/\/example\.com\/guide\?q=1\)/);
  assert.match(direct.markdown, /plain label/);
  assert.match(direct.markdown, /- First/);
  for (const forbidden of [
    "stealCredentials", "fallback secret", "hidden attribute", "aria secret",
    "tracker.example", "javascript:", "secret\" content",
  ]) assert.doesNotMatch(direct.markdown, new RegExp(forbidden));

  const extracted = await extractResearchResource({
    bytes: bytes(html),
    contentType: "text/html",
    sourceUrl: "https://example.com/start",
  });
  const repeated = await extractResearchResource({
    bytes: bytes(html),
    contentType: "application/xhtml+xml",
    sourceUrl: "https://example.com/start",
  });
  assert.deepEqual(extracted.normalizedBytes, repeated.normalizedBytes);
  assert.equal(text(extracted.normalizedBytes), direct.markdown);
  assert.equal(extracted.normalizedMediaType, "text/markdown; charset=utf-8");
  assert.deepEqual(extracted.normalizationReceipt, RESEARCH_EXTRACTOR_VERSIONS.html);
  assert.equal(extracted.title, "A & B");

  assert.equal(
    htmlToDeterministicMarkdown("<p>safe</p><script>unterminated secret").markdown,
    "safe",
  );
});

test("missing or generic content types sniff only strict textual formats", async () => {
  const genericJson = await extractResearchResource({
    bytes: bytes("{\"ok\":true}"),
    contentType: "application/octet-stream",
  });
  assert.equal(genericJson.normalizedMediaType, "application/json");

  const genericHtml = await extractResearchResource({
    bytes: bytes("<!doctype html><html><body><p>Readable</p></body></html>"),
  });
  assert.equal(genericHtml.normalizedMediaType, "text/markdown; charset=utf-8");
  assert.equal(text(genericHtml.normalizedBytes), "Readable");

  const genericText = await extractResearchResource({ bytes: bytes("ordinary text") });
  assert.equal(genericText.normalizedMediaType, "text/plain; charset=utf-8");
  await assert.rejects(
    () => extractResearchResource({ bytes: Uint8Array.from([0, 1, 2]), contentType: "application/octet-stream" }),
    hasCode("unsupported_media"),
  );
  await assert.rejects(
    () => extractResearchResource({ bytes: bytes("%PDF-not-sniffed") }),
    hasCode("unsupported_media"),
  );
});

test("unsupported media and independent raw/normalized limits fail nonretryably", async () => {
  await assert.rejects(
    () => extractResearchResource({ bytes: bytes("GIF89a"), contentType: "image/gif" }),
    hasCode("unsupported_media"),
  );
  await assert.rejects(
    () => extractResearchResource(
      { bytes: bytes("123456"), contentType: "text/plain" },
      { limits: { maxTextInputBytes: 5 } },
    ),
    hasCode("input_too_large"),
  );
  await assert.rejects(
    () => extractResearchResource(
      { bytes: bytes("123456"), contentType: "text/plain" },
      { limits: { maxNormalizedBytes: 5 } },
    ),
    hasCode("normalized_too_large"),
  );
});

test("the pinned PDF adapter is byte-deterministic with exact contiguous page boundaries", async () => {
  const pdf = await readFile(new URL("../../../tests/fixtures/sample-paper.pdf", import.meta.url));
  const first = await extractResearchResource({ bytes: pdf, contentType: "application/pdf" });
  const second = await extractResearchResource({ bytes: pdf, contentType: "application/pdf" });
  assert.deepEqual(first.normalizedBytes, second.normalizedBytes);
  assert.deepEqual(first.pageBoundaries, second.pageBoundaries);
  assert.equal(first.normalizedMediaType, "text/plain; charset=utf-8");
  assert.deepEqual(first.normalizationReceipt, RESEARCH_EXTRACTOR_VERSIONS.pdf);
  assert.ok(first.pageBoundaries && first.pageBoundaries.length > 0);
  let expectedStart = 0;
  for (const [index, boundary] of first.pageBoundaries!.entries()) {
    assert.equal(boundary.page, index + 1);
    assert.equal(boundary.start, expectedStart);
    assert.ok(boundary.end > boundary.start);
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(
      first.normalizedBytes.slice(boundary.start, boundary.end),
    ));
    expectedStart = boundary.end;
  }
  assert.equal(expectedStart, first.normalizedBytes.byteLength);
  assert.match(text(first.normalizedBytes), /HYPERSPECTRAL FIXTURE/i);
});

test("PDF page and normalized-byte limits are enforced independently", async () => {
  const pdf = await readFile(new URL("../../../tests/fixtures/sample-paper.pdf", import.meta.url));
  await assert.rejects(
    () => extractResearchResource(
      { bytes: pdf, contentType: "application/pdf" },
      { limits: { maxPdfPages: 0 } },
    ),
    hasCode("pdf_page_limit"),
  );
  await assert.rejects(
    () => extractResearchResource(
      { bytes: pdf, contentType: "application/pdf" },
      { limits: { maxPdfPageBytes: 4 } },
    ),
    hasCode("pdf_page_too_large"),
  );
  await assert.rejects(
    () => extractResearchResource({ bytes: bytes("not a pdf"), contentType: "application/pdf" }),
    hasCode("malformed_pdf"),
  );
});
