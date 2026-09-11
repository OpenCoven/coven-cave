import assert from "node:assert/strict";
import { test } from "node:test";

import { stripReadmeLayoutHtml } from "./github-readme-layout-html.ts";

test("strips the centred-header wrapper that READMEs leak as prose", () => {
  const readme = [
    '<div align="center">',
    "",
    "# Mori",
    "",
    "A native macOS browser chrome.",
    "",
    "</div>",
    "",
    "## What Mori is",
  ].join("\n");
  const out = stripReadmeLayoutHtml(readme);
  assert.ok(!out.includes("<div"), "opening wrapper survived");
  assert.ok(!out.includes("</div>"), "closing wrapper survived");
  assert.ok(out.includes("# Mori"));
  assert.ok(out.includes("## What Mori is"));
  // The content keeps its line positions, so the parser still sees block breaks.
  assert.equal(out.split("\n").length, readme.split("\n").length);
});

test("strips <p align>, <center>, and nested layout wrappers but keeps their text", () => {
  const out = stripReadmeLayoutHtml(
    '<center><p align="center">Built with <b>SwiftUI</b></p></center>',
  );
  assert.equal(out.trim(), "Built with <b>SwiftUI</b>");
});

test("leaves inline HTML, <br>, <hr>, and tables alone", () => {
  const source = [
    "Press <kbd>Tab</kbd> to open the palette.<br>",
    "<hr>",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "See <a href='#x'>docs</a> and <code>chrome</code>.",
  ].join("\n");
  assert.equal(stripReadmeLayoutHtml(source), source);
});

test("rewrites <img> into markdown so suppressRemoteMedia can place it", () => {
  assert.equal(
    stripReadmeLayoutHtml('<img src="https://example.com/logo.png" alt="Mori logo">'),
    "![Mori logo](https://example.com/logo.png)",
  );
  // Self-closing, attribute order reversed, single quotes.
  assert.equal(
    stripReadmeLayoutHtml("<img alt='Screenshot' src='docs/shot.png' width='400' />"),
    "![Screenshot](docs/shot.png)",
  );
  // No alt is still a valid image reference.
  assert.equal(stripReadmeLayoutHtml('<img src="a.png">'), "![](a.png)");
  // No usable src is not content — drop it rather than emit a broken link.
  assert.equal(stripReadmeLayoutHtml('<img alt="nothing">'), "");
  // A src holding markdown delimiters would terminate the syntax early, so the
  // original tag is left for the escaper rather than producing broken output.
  const spaced = '<img src="my logo.png" alt="x">';
  assert.equal(stripReadmeLayoutHtml(spaced), spaced);
});

test("unwraps <picture>/<source> around a real <img>", () => {
  const out = stripReadmeLayoutHtml([
    "<picture>",
    '  <source media="(prefers-color-scheme: dark)" srcset="dark.png">',
    '  <img src="light.png" alt="Banner">',
    "</picture>",
  ].join("\n"));
  assert.ok(!out.includes("<picture"));
  assert.ok(!out.includes("<source"));
  assert.ok(out.includes("![Banner](light.png)"));
});

test("never reaches inside a fenced code block", () => {
  const source = [
    '<div align="center">',
    "",
    "```html",
    '<div align="center">',
    '  <img src="x.png" alt="kept">',
    "</div>",
    "```",
    "",
    "</div>",
  ].join("\n");
  const out = stripReadmeLayoutHtml(source);
  const lines = out.split("\n");
  // Inside the fence the angle brackets ARE the content.
  assert.ok(lines.includes('<div align="center">'), "fenced div was stripped");
  assert.ok(lines.includes('  <img src="x.png" alt="kept">'), "fenced img was rewritten");
  assert.ok(lines.includes("</div>"), "fenced close tag was stripped");
  // Exactly the fenced copies survive: the two wrappers outside it are gone.
  assert.equal(lines.filter((line) => line === '<div align="center">').length, 1);
  assert.equal(lines.filter((line) => line === "</div>").length, 1);
});

test("a longer fence is not closed early by a shorter run inside it", () => {
  const source = [
    "````markdown",
    "```",
    '<div align="center">kept</div>',
    "```",
    "````",
    '<div align="center">stripped</div>',
  ].join("\n");
  const out = stripReadmeLayoutHtml(source);
  assert.ok(out.includes('<div align="center">kept</div>'));
  assert.ok(out.includes("stripped"));
  assert.ok(!out.includes('<div align="center">stripped'));
});

test("markdown with no angle brackets is returned untouched", () => {
  const plain = "# Title\n\nSome prose with an ![image](a.png).\n";
  assert.equal(stripReadmeLayoutHtml(plain), plain);
});
