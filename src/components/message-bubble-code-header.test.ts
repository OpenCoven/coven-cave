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
// <button class="cave-copy-btn cave-copy-btn-mounted"> markup, but the click
// handler only attaches via wireCopyButtons after the HTML lands in the DOM.
// Every component that injects this HTML (MarkdownContent, SyntaxBlock,
// MarkdownBlock) must run the post-render wiring — otherwise Copy silently
// does nothing in tool blocks, the inspector pane, comux previews, and the
// markdown expand modal (audit finding CHAT-D7-01).
// (Stale #398-era note removed: the buttons no longer carry a data-code
// attribute — see the CHAT-D7-04 pins below.)
// ---------------------------------------------------------------------------

const source = await readFile(new URL("./message-bubble.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function useWireCopyButtons\([\s\S]*?wireCopyButtons\(el\)/,
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
// Full-width chat (2026-06-18) — supersedes the 2026-06-13 centered-column
// decision: the thread spans the whole pane (width: 100%, max-width: 100%, no
// auto centering) so the transcript lines up with the full-width header and
// composer. The old 920px and 1180px reading-measure caps stay gone.
// ---------------------------------------------------------------------------

const linearThread = /\.cave-chat-linear \.cave-chat-thread \{[^}]*\}/.exec(css)?.[0] ?? "";
assert.match(
  linearThread,
  /width:\s*100%/,
  "Linear thread must fill the pane (width: 100%)",
);
assert.match(
  linearThread,
  /max-width:\s*100%/,
  "Linear thread must span full width (max-width: 100%)",
);
assert.doesNotMatch(
  linearThread,
  /margin-inline:\s*auto/,
  "Linear thread must not center (no margin-inline: auto)",
);
assert.doesNotMatch(
  linearThread,
  /max-width:\s*(?:min\(100%,\s*)?(?:920|1180)px/,
  "The old reading-measure caps (920px / 1180px) must stay gone",
);

const linearComposerShell = /\.cave-chat-linear \.cave-composer-shell \{[^}]*\}/.exec(css)?.[0] ?? "";
assert.match(
  linearComposerShell,
  /max-width:\s*100%/,
  "Linear composer shell must share the thread's full-width measure so the input aligns with the column",
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

// ---------------------------------------------------------------------------
// CHAT-D7-02 — the code-block header must be sticky inside the block's own
// scroll container, so the language label and Copy button stay reachable on
// long blocks (benchmarks: ChatGPT/Cursor). Sticking against page scroll
// would be a no-op: the wrap clips overflow, so the wrap itself must be the
// scroll container (see CHAT-D7-03 below) and the header sticks to its top.
// ---------------------------------------------------------------------------

const headerBlock = ruleBlock(".cave-code-header");
assert.match(headerBlock, /position:\s*sticky/, "Code-block header must be sticky");
assert.match(headerBlock, /top:\s*0/, "Sticky header must pin to the top of the wrap's scroll viewport");
assert.match(headerBlock, /z-index:\s*1/, "Sticky header must layer above the code lines it scrolls over");

// ---------------------------------------------------------------------------
// CHAT-D7-03 — huge blocks must not dominate the transcript. The wrap clamps
// to min(60vh, 520px) with inner vertical scroll (the system bubble's 320px
// cap is the in-repo precedent); blocks shorter than the cap are unaffected.
// A "Show more" footer (emitted only on blocks tall enough to clamp) lifts
// the cap via the --expanded class, toggled by the same delegated wiring as
// the copy buttons.
// ---------------------------------------------------------------------------

const wrapBlock = ruleBlock(".cave-code-wrap");
assert.match(
  wrapBlock,
  /max-height:\s*min\(60vh,\s*520px\)/,
  "Code-block wrap must clamp its height so huge blocks don't dominate the transcript",
);
assert.match(wrapBlock, /overflow-y:\s*auto/, "Clamped wrap must scroll vertically (it is the sticky header's container)");
assert.match(wrapBlock, /overflow-x:\s*hidden/, "Wrap must keep clipping horizontally — the inner <pre> owns x-scroll");
assert.match(
  ruleBlock(".cave-code-wrap--expanded"),
  /max-height:\s*none/,
  "The expanded state must lift the height clamp",
);

// CHAT-D4-07 — tool I/O is secondary context: inside .cave-tool-block the
// wrap clamps tighter (min(48vh, 360px) vs prose's 520px). The :not() guard
// keeps the Show-more toggle able to lift the clamp, and the rule reuses the
// wrap's own overflow-y: auto — no second scroll container.
const toolWrapBlock = ruleBlock(".cave-tool-block .cave-code-wrap:not(.cave-code-wrap--expanded)");
assert.match(
  toolWrapBlock,
  /max-height:\s*min\(48vh,\s*360px\)/,
  "Tool-block code wraps must clamp tighter than prose code blocks (CHAT-D4-07)",
);
assert.doesNotMatch(
  toolWrapBlock,
  /overflow/,
  "The tool clamp must not introduce a second scroll container — the wrap already scrolls",
);

const renderCodeBlockFn = /async function renderCodeBlock\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  renderCodeBlockFn,
  /cave-code-expand-btn/,
  "renderCodeBlock must emit the Show more footer button for clamp-height blocks",
);
assert.match(
  source,
  /CODE_EXPAND_MIN_LINES/,
  "The expand footer must only be emitted for blocks tall enough to actually clamp",
);

const wireFn = /function wireCopyButtons\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  wireFn,
  /cave-code-expand-btn/,
  "wireCopyButtons must wire the expand toggle alongside the copy buttons",
);
assert.match(
  wireFn,
  /cave-code-wrap--expanded/,
  "The expand toggle must flip the --expanded class on the wrap",
);

// ---------------------------------------------------------------------------
// CHAT-D7-04 — no data-code duplication. renderCodeBlock used to copy every
// block's full source into a data-code attribute (via SyntaxBlock that meant
// whole tool outputs and file previews twice in memory, as giant DOM
// attributes). The Copy buttons now read the code text out of the rendered
// DOM at click time: .cave-line rows joined with "\n", with the aria-hidden
// .cave-ln line-number spans stripped first (textContent WOULD include
// them). Byte-parity with the old data-code path was verified for plain,
// line-numbered, diff, entity-heavy and trailing-newline blocks.
// (Updated #398-era pins: wireCopyButtons used to select
// ".cave-copy-btn[data-code]" — it now selects ".cave-copy-btn-mounted".)
// ---------------------------------------------------------------------------

assert.doesNotMatch(
  source,
  /data-code=/,
  "renderCodeBlock must not duplicate block source into a data-code attribute",
);
assert.doesNotMatch(
  source,
  /dataset\.code/,
  "Copy wiring must not read from the removed data-code attribute",
);
assert.match(
  wireFn,
  /cave-copy-btn-mounted/,
  "wireCopyButtons must select the injected header buttons by their mounted class (React bubble buttons wire their own onClick)",
);
assert.match(wireFn, /codeTextFromWrap/, "Copy clicks must read the code text from the DOM at click time");

const codeTextFn = /function codeTextFromWrap\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.match(
  codeTextFn,
  /closest\("\.cave-code-wrap"\)/,
  "Click-time extraction must scope to the button's own code block",
);
assert.match(codeTextFn, /cloneNode/, "Extraction must clone line rows before stripping line numbers");
assert.match(
  codeTextFn,
  /\.cave-ln/,
  "Extraction must strip .cave-ln line-number spans (aria-hidden, but included by textContent)",
);
assert.match(
  codeTextFn,
  /join\("\\n"\)/,
  'Line rows carry no newline text nodes — extraction must rejoin them with "\\n"',
);
