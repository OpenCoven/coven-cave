// @ts-nocheck
// The Expand reader's rail model (Reader.dc.html 3a): the contents list and
// the reading estimate under it, both read off the answer's own markdown.
import assert from "node:assert/strict";
import test from "node:test";

import {
  READER_WPM,
  outlineBaseLevel,
  readerOutline,
  readingStats,
} from "./reader-outline.ts";

test("headings are indexed in document order with their level", () => {
  const outline = readerOutline("# Summary\n\ntext\n\n## Findings\n\n### 1. Grid\n");

  assert.deepEqual(
    outline.map((h) => [h.level, h.text]),
    [
      [1, "Summary"],
      [2, "Findings"],
      [3, "1. Grid"],
    ],
  );
});

test("a `#` inside a fenced block is code, not a heading", () => {
  const outline = readerOutline("## Real\n\n```bash\n# not a heading\necho hi\n```\n\n## Also real\n");

  assert.deepEqual(outline.map((h) => h.text), ["Real", "Also real"]);
});

test("a tilde fence hides its `#` lines too", () => {
  const outline = readerOutline("## Real\n\n~~~\n# still code\n~~~\n");

  assert.deepEqual(outline.map((h) => h.text), ["Real"]);
});

test("inline markdown is stripped from the rail label", () => {
  const outline = readerOutline("## The `grid` rule is [broken](http://x.test) and **wrong**\n");

  assert.equal(outline[0].text, "The grid rule is broken and wrong");
});

test("a closing hash run is not part of the label", () => {
  assert.equal(readerOutline("## Verdict ##\n")[0].text, "Verdict");
});

test("repeated headings get distinct anchors", () => {
  const outline = readerOutline("## Notes\n\n## Notes\n\n## Notes\n");

  assert.deepEqual(outline.map((h) => h.id), ["notes", "notes-2", "notes-3"]);
  assert.equal(new Set(outline.map((h) => h.id)).size, 3, "ids must be unique to anchor");
});

test("a heading of only punctuation still yields a usable anchor", () => {
  assert.equal(readerOutline("## ???\n")[0].id, "section");
});

test("prose with no headings yields no outline", () => {
  assert.deepEqual(readerOutline("just a paragraph, no structure at all"), []);
});

test("a hash with no space is not a heading", () => {
  assert.deepEqual(readerOutline("#hashtag not a heading\n"), []);
});

test("reading stats count words and round to whole minutes", () => {
  const words = Array.from({ length: READER_WPM * 3 }, () => "word").join(" ");

  assert.deepEqual(readingStats(words), { words: READER_WPM * 3, minutes: 3 });
});

test("a short answer still reads as one minute, never zero", () => {
  assert.equal(readingStats("three short words").minutes, 1);
});

test("fenced code is not tokenised into fake words", () => {
  const withCode = readingStats("one two three\n\n```js\nconst a = 1; const b = 2; const c = 3;\n```\n");

  assert.equal(withCode.words, 3, "the fence contributes no words of its own");
});

test("the base level is the shallowest heading present", () => {
  assert.equal(outlineBaseLevel(readerOutline("## A\n\n### B\n")), 2);
  assert.equal(outlineBaseLevel([]), 6, "an empty outline has no shallower level to report");
});
