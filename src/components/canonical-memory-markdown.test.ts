import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanonicalMemoryMarkdown } from "./canonical-memory-markdown.tsx";

function render(content: string, mode: "rendered" | "raw" = "rendered"): string {
  return renderToStaticMarkup(
    createElement(CanonicalMemoryMarkdown, { content, mode }),
  );
}

function assertNoActiveContent(markup: string): void {
  assert.doesNotMatch(markup, /<script\b/i);
  assert.doesNotMatch(markup, /<img\b/i);
  assert.doesNotMatch(markup, /<svg\b/i);
  assert.doesNotMatch(markup, /<iframe\b/i);
  assert.doesNotMatch(markup, /javascript:/i);
}

test("raw HTML stays escaped text and never becomes active markup", () => {
  const markup = render("<script>alert('private')</script>");
  assertNoActiveContent(markup);
  assert.match(
    markup,
    /&lt;script&gt;alert\(&#x27;private&#x27;\)&lt;\/script&gt;/,
  );
});

test("remote images become inert alt text", () => {
  const markup = render("![private](https://tracker.invalid/private.png)");
  assertNoActiveContent(markup);
  assert.match(markup, /\[Image: private\]/);
  assert.doesNotMatch(markup, /tracker\.invalid/);
});

test("safe links preserve only the intended navigation behavior", () => {
  const https = render("[safe](https://example.com/memory)");
  assert.match(
    https,
    /<a href="https:\/\/example\.com\/memory" target="_blank" rel="noopener noreferrer">safe<\/a>/,
  );

  const http = render("[safe](http://example.com/memory)");
  assert.match(
    http,
    /<a href="http:\/\/example\.com\/memory" target="_blank" rel="noopener noreferrer">safe<\/a>/,
  );

  const fragment = render("[section](#verification)");
  assert.match(fragment, /<a href="#verification">section<\/a>/);
  assert.doesNotMatch(fragment, /target="_blank"/);

  const unsafe = render("[unsafe](javascript:alert(1))");
  assertNoActiveContent(unsafe);
  assert.match(unsafe, />unsafe</);
  assert.doesNotMatch(unsafe, /<a\b/);
});

test("Mermaid stays plain code without diagram or DOM post-processing", () => {
  const markup = render("```mermaid\ngraph TD; A-->B\n```");
  assertNoActiveContent(markup);
  assert.match(markup, /<pre><code[^>]*>graph TD; A--&gt;B<\/code><\/pre>/);
});

test("raw mode is React-escaped text", () => {
  const markup = render(
    "<img src=x onerror=alert(1)>\n<script>alert(2)</script>",
    "raw",
  );
  assertNoActiveContent(markup);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
});

test("lists, tables, and callouts use escaped semantic elements", () => {
  const markup = render(
    [
      "- <b>first</b>",
      "- second",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| private | <script>never</script> |",
      "",
      "> [!NOTE]",
      "> <em>review locally</em>",
    ].join("\n"),
  );
  assertNoActiveContent(markup);
  assert.match(markup, /<ul>/);
  assert.match(markup, /<li>.*&lt;b&gt;first&lt;\/b&gt;.*<\/li>/);
  assert.match(markup, /<table>/);
  assert.match(markup, /<thead>/);
  assert.match(markup, /<tbody>/);
  assert.match(markup, /&lt;script&gt;never&lt;\/script&gt;/);
  assert.match(markup, /<aside[^>]*>/);
  assert.match(markup, /&lt;em&gt;review locally&lt;\/em&gt;/);
});
