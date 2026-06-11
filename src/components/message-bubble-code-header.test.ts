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

// ---------------------------------------------------------------------------
// CHAT-D10-04 — the shipped linear layout must cap its reading measure.
// Without a cap, assistant prose runs 150+ chars/line on wide panes
// (benchmarks: Claude.ai ~48rem, ChatGPT ~768px; we match the workbench's
// 920px content cap). The composer shell shares the same measure so the
// input lines up with the conversation column.
// ---------------------------------------------------------------------------

const linearThread = /\.cave-chat-linear \.cave-chat-thread \{[^}]*\}/.exec(css)?.[0] ?? "";
assert.match(
  linearThread,
  /max-width:\s*min\(100%,\s*920px\)/,
  "Linear thread must cap its measure at 920px on wide panes",
);
assert.match(
  linearThread,
  /margin-inline:\s*auto/,
  "Linear thread column must center inside wide panes",
);

const linearComposerShell = /\.cave-chat-linear \.cave-composer-shell \{[^}]*\}/.exec(css)?.[0] ?? "";
assert.match(
  linearComposerShell,
  /max-width:\s*920px/,
  "Linear composer shell must share the thread's 920px measure so the input aligns with the column",
);

// ---------------------------------------------------------------------------
// CHAT-D13-01 — dark-terminal chrome must pin its inks, not follow the theme.
// Code blocks and system turns keep fixed dark surfaces in BOTH modes; any
// var(--text-*) inside them flips to dark ink under [data-mode="light"] and
// becomes unreadable. The fixed --code-chrome-* properties mirror the
// dark-mode palette instead.
// ---------------------------------------------------------------------------

assert.match(css, /--code-chrome-ink:\s*oklch\(/, "Fixed dark-chrome primary ink must exist");
assert.match(css, /--code-chrome-ink-muted:\s*oklch\(/, "Fixed dark-chrome muted ink must exist");
assert.match(css, /--code-chrome-ink-faint:\s*oklch\(/, "Fixed dark-chrome faint ink must exist");
assert.match(css, /--code-chrome-accent:/, "Fixed dark-chrome accent must exist");

function ruleBlock(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Expected a rule for "${selector}"`);
  return css.slice(start, css.indexOf("}", start) + 1);
}

// Every dark-chrome block that previously leaked theme ink must now use the
// fixed properties — and none may still reference var(--text-*).
const darkChromeSelectors = [
  ".cave-code-wrap",
  ".cave-code-header",
  ".cave-code-lang",
  ".cave-code-filename",
  ".cave-ln",
  ".cave-copy-btn",
  ".cave-copy-btn:hover",
  ".cave-bubble-system",
  ".cave-bubble-system-header",
  ".cave-bubble-system-sigil",
  ".cave-bubble-system-label",
  ".cave-bubble-system-label--dim",
  ".cave-bubble-system-body",
];
for (const selector of darkChromeSelectors) {
  assert.doesNotMatch(
    ruleBlock(selector),
    /var\(--text-/,
    `${selector} is fixed dark chrome — it must not take theme ink (var(--text-*) flips dark in light mode)`,
  );
}

assert.match(
  ruleBlock(".cave-copy-btn"),
  /color:\s*var\(--code-chrome-ink-faint\)/,
  "Copy button resting ink must be the fixed faint chrome ink",
);
assert.match(
  ruleBlock(".cave-copy-btn:hover"),
  /color:\s*var\(--code-chrome-ink\)/,
  "Copy button hover ink must be the fixed primary chrome ink",
);
assert.match(
  ruleBlock(".cave-code-lang"),
  /var\(--code-chrome-accent\)/,
  "Code-header language tag must mix from the fixed chrome accent",
);
assert.match(
  ruleBlock(".cave-code-filename"),
  /color:\s*var\(--code-chrome-ink-faint\)/,
  "Code-header filename ink must be the fixed faint chrome ink",
);
assert.match(
  ruleBlock(".cave-ln"),
  /var\(--code-chrome-accent\)/,
  "Line numbers must mix from the fixed chrome accent",
);
assert.match(
  ruleBlock(".cave-bubble-system-label"),
  /color:\s*var\(--code-chrome-ink-muted\)/,
  "System-turn header label ink must be the fixed muted chrome ink",
);
assert.match(
  ruleBlock(".cave-bubble-system-body"),
  /color:\s*var\(--code-chrome-ink-muted\)/,
  "System-turn body ink must be the fixed muted chrome ink",
);

// The fixed dark surfaces must be near-opaque so they stay self-consistent
// over a light --bg-base (a 60%-alpha wash goes muddy), and must not mix
// with theme surfaces.
for (const selector of [".cave-code-wrap", ".cave-bubble-system"]) {
  const block = ruleBlock(selector);
  assert.match(
    block,
    /background:\s*oklch\([^)]*\/\s*9\d%\)/,
    `${selector} surface must be a near-opaque fixed dark oklch`,
  );
  assert.doesNotMatch(
    block,
    /var\(--bg-/,
    `${selector} surface must not mix with theme backgrounds`,
  );
}
