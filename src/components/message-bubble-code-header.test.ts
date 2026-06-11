// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.doesNotMatch(
  css,
  /\.cave-code-header::before/,
  "Terminal code chrome should not inject traffic lights before the language label",
);

assert.match(
  css,
  /\.cave-code-header::after[\s\S]*box-shadow:/,
  "Terminal code chrome should render traffic lights after the language label",
);

assert.match(
  css,
  /\.cave-code-lang[\s\S]*order:\s*0/,
  "The language label should be first in terminal code headers",
);

assert.match(
  css,
  /\.cave-code-header::after[\s\S]*order:\s*1/,
  "Traffic lights should sit immediately to the right of the language label",
);

assert.match(
  css,
  /\.cave-code-header \.cave-copy-btn[\s\S]*order:\s*3[\s\S]*margin-left:\s*auto/,
  "The copy button should stay at the far edge after the label and traffic lights",
);

// ---------------------------------------------------------------------------
// Copy buttons must be WIRED, not just rendered. renderCodeBlock emits the
// <button class="cave-copy-btn" data-code> markup, but the click handler only
// attaches via wireCopyButtons after the HTML lands in the DOM. Every
// component that injects this HTML (MarkdownContent, SyntaxBlock,
// MarkdownBlock) must run the post-render wiring — otherwise Copy silently
// does nothing in tool blocks, the inspector pane, comux previews, and the
// markdown expand modal (audit finding CHAT-D7-01).
// ---------------------------------------------------------------------------

const source = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function useWireCopyButtons\([\s\S]*?wireCopyButtons\(containerRef\.current\)/,
  "A shared post-render hook should wire copy buttons once the injected HTML lands",
);

const syntaxBlock = /export function SyntaxBlock\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  syntaxBlock,
  /useWireCopyButtons\(/,
  "SyntaxBlock must wire its copy buttons (tool I/O, inspector pane, comux preview)",
);
assert.match(
  syntaxBlock,
  /ref=\{containerRef\}/,
  "SyntaxBlock must attach the wiring ref to its dangerouslySetInnerHTML container",
);

const markdownBlock = /export function MarkdownBlock\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  markdownBlock,
  /useWireCopyButtons\(/,
  "MarkdownBlock must wire its copy buttons (inspector pane, markdown expand modal)",
);
assert.match(
  markdownBlock,
  /ref=\{containerRef\}/,
  "MarkdownBlock must attach the wiring ref to its dangerouslySetInnerHTML container",
);

const markdownContent = /function MarkdownContent\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  markdownContent,
  /useWireCopyButtons\(/,
  "MarkdownContent must keep wiring its copy buttons (chat message bubbles)",
);
