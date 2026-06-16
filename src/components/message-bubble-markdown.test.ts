// @ts-nocheck
// Chat responses must render as formatted markdown — including GFM tables
// with inline markdown inside cells — not as the plain-text fallback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");

// StrictMode regression guard: a ref-based "same text" check poisons itself
// when the first (dev double-invoke) effect run is cancelled — run 2 then
// early-returns and the bubble is stuck on raw markdown forever.
assert.doesNotMatch(
  source,
  /lastTextRef/,
  "MarkdownContent must not gate the async markdown render on a same-text ref guard",
);

// @create-markdown/preview emits table cells as escaped plain text, so
// **bold**/`code`/[links] inside cells show literally unless each cell is
// re-rendered through the inline path.
assert.match(
  source,
  /async function renderTableBlock\(/,
  "Tables are rebuilt with per-cell inline markdown rendering",
);
assert.match(
  source,
  /async function renderInlineMd\(/,
  "Cell content renders through the inline (paragraph) markdown path",
);
assert.match(
  source,
  /text-align: \$\{alignments\[i\]\}/,
  "Rebuilt tables preserve GFM column alignments",
);
assert.match(
  source,
  /const tableRe = \/<table\[\^>\]\*>\[\\s\\S\]\*\?<\\\/table>\/g/,
  "Rendered tables substitute positionally for the renderer's own <table> output",
);

// ── CHAT-D7-08: wide tables scroll, they don't word-shatter ───────────────
// Every substituted table is wrapped in a horizontal scroll container; cells
// undo .cave-md's overflow-wrap: anywhere so unbreakable tokens grow the
// table past 100% (auto table layout) into the wrapper's scrollbar instead
// of shattering mid-word.
assert.match(
  source,
  /<div class="cave-table-scroll">\$\{tableReplacements\[tableIdx\] \?\? tableMatch\[0\]\}<\/div>/,
  "mdToHtml wraps each rendered table (including the positional fallback) in .cave-table-scroll",
);

// ── CHAT-D6-04: per-message actions must be keyboard/touch reachable ──────
// The Copy/Expand bubble actions must be mounted unconditionally (when not
// pending) and revealed by CSS — never mount-gated on a JS `hovered` state,
// which keeps them out of the DOM (and the accessibility tree) until
// onMouseEnter fires.
assert.doesNotMatch(
  source,
  /\bhovered\b/,
  "Bubble actions must not be gated on a JS hovered state — render always, reveal with CSS",
);
assert.match(
  source,
  /\{!pending \? \(\s*<div className="cave-bubble-actions">/,
  "User-bubble action row renders (below the bubble) whenever the message is not pending",
);
assert.match(
  source,
  /\{!pending && content \? \(\s*<div className="cave-bubble-actions">/,
  "Assistant bubble actions render whenever there is settled content",
);

// ── CHAT-D3-01: markdown must render progressively while streaming ────────
// The pending branch used to bail (`setHtml(null); return;`), leaving the
// user staring at raw ``` fences and **markers** until `done`, then
// re-typesetting the whole bubble at once (live-measured CLS 0.53).
const markdownContent = /function MarkdownContent\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
assert.ok(markdownContent, "MarkdownContent component exists");
assert.doesNotMatch(
  markdownContent,
  /setHtml\(null\)/,
  "The pending branch must schedule a streaming render, not bail to the plain-text fallback",
);
assert.match(
  markdownContent,
  /if \(pending\) \{[\s\S]*?mdToHtml\(/,
  "While pending, the accumulated text re-renders through mdToHtml",
);
assert.match(
  source,
  /const STREAM_RENDER_INTERVAL_MS = \d+/,
  "Streaming renders are throttled by a named interval constant",
);
assert.match(
  markdownContent,
  /STREAM_RENDER_INTERVAL_MS - \(Date\.now\(\) - lastStreamRenderRef\.current\)/,
  "The throttle is trailing-edge and persists across per-chunk effect re-runs (ref, not per-effect timer state)",
);
assert.match(
  markdownContent,
  /setTimeout\(run, wait\)/,
  "Renders inside the throttle window are deferred to a trailing timer",
);

// Out-of-order protection: mdToHtml is async; a slower earlier render must
// never overwrite a newer one. Each render takes a monotonic stamp and only
// commits if newer than the last applied stamp.
assert.match(
  markdownContent,
  /\+\+renderStampRef\.current/,
  "Each render takes a monotonically increasing stamp",
);
assert.match(
  markdownContent,
  /if \(stamp <= appliedStampRef\.current\) return;/,
  "A render result only commits if its stamp is newer than the last applied one",
);

// Streaming cursor: with rendered HTML during pending, the ▌ affordance must
// render as a SIBLING after the markdown container — never injected into the
// sanitized HTML string.
assert.match(
  markdownContent,
  /dangerouslySetInnerHTML=\{\{ __html: html \}\}\s*\/>\s*\{\/\*[\s\S]*?\*\/\}\s*\{pending \? \(\s*<span[^>]*>▌<\/span>/,
  "While pending, the streaming cursor renders as a sibling element after the markdown container",
);
assert.match(
  markdownContent,
  /\{pending && text \? \(\s*<span[^>]*>▌<\/span>/,
  "The plain-text fallback keeps its cursor for the window before the first render lands",
);

// ── CHAT-D3-03: renderCache must not grow unboundedly ─────────────────────
// The cache is keyed by the FULL markdown string; mid-stream snapshots would
// add an entry per throttle tick. Guards: (1) transient streaming renders
// skip cache writes entirely, (2) the cache is a small LRU with a hard cap.
assert.match(
  source,
  /const RENDER_CACHE_MAX = \d+/,
  "renderCache has a named size cap",
);
assert.match(
  source,
  /if \(renderCache\.size > RENDER_CACHE_MAX\) \{\s*const oldest = renderCache\.keys\(\)\.next\(\)\.value;/,
  "On overflow the least-recently-used entry is evicted",
);
assert.match(
  source,
  /if \(!opts\?\.transient\) renderCacheSet\(markdown, sanitizedHtml\);/,
  "Transient mid-stream renders never write to the cache",
);
assert.match(
  markdownContent,
  /mdToHtml\(closeTrailingFence\(text\), \{ transient: true \}\)/,
  "Streaming renders are marked transient (and auto-close a trailing unterminated fence)",
);

assert.match(
  source,
  /onOpenUrl\?: \(url: string\) => void/,
  "MessageBubble should accept a link-open callback so chat links can route into the side-panel browser",
);
assert.match(
  source,
  /wireMarkdownLinks\(containerRef\.current, onOpenUrl\)/,
  "MarkdownContent should wire rendered markdown links through the chat link-open callback",
);
assert.match(
  source,
  /event\.preventDefault\(\)[\s\S]*onOpenUrl\(href\)/,
  "Markdown link clicks should prevent normal navigation and open in the provided browser target",
);

const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
assert.match(
  css,
  /\.cave-copy-btn:focus-visible \{ opacity: 1; \}/,
  "Focused action buttons must be visible (focus-visible reveal)",
);
assert.match(
  css,
  /\.group:focus-within \.cave-copy-btn \{ opacity: 1; \}/,
  "Tabbing into a bubble's actions must reveal them (focus-within reveal)",
);
assert.match(
  css,
  /@media \(pointer: coarse\) \{\s*\.cave-bubble-actions,\s*\.cave-copy-btn-bubble \{\s*opacity: 1;/,
  "Coarse pointers have no hover — bubble action rows must be always visible there",
);
assert.match(
  css,
  /@media \(max-width: 767px\) and \(pointer: coarse\) \{[\s\S]*\.cave-bubble-actions\s*\{[\s\S]*position: static;[\s\S]*justify-content: flex-end;/,
  "Phone bubble actions should move into normal flow instead of overlaying message text",
);

// CHAT-D7-08 CSS half: the wrapper owns horizontal overflow; cells restore
// normal word wrapping so the table can exceed its container when needed.
assert.match(
  css,
  /\.cave-md \.cave-table-scroll \{\s*max-width: 100%;\s*overflow-x: auto;/,
  ".cave-table-scroll is the horizontal scroll container for rendered tables",
);
assert.match(
  css,
  /\.cave-md th,\s*\.cave-md td \{[\s\S]*?word-break: normal;\s*overflow-wrap: normal;/,
  "Table cells undo .cave-md's break-anywhere so wide content scrolls instead of word-shattering",
);

// ── Mermaid diagrams (```mermaid) via @create-markdown/preview-mermaid ────────
assert.match(
  source,
  /import\("@create-markdown\/preview-mermaid"\)/,
  "mermaid plugin is lazily imported from the @create-markdown/preview-mermaid package",
);
assert.match(
  source,
  /mermaidPlugin\(\{ theme: "dark", config: \{ securityLevel: "strict" \} \}\)/,
  "mermaid is initialized with the dark theme and a strict (safe) security level",
);
assert.match(
  source,
  /function isMermaidCodeBlock[\s\S]{0,360}=== "mermaid"/,
  "mermaid code blocks are detected by language",
);
// renderBlock placeholder must be produced for mermaid blocks...
assert.match(
  source,
  /isMermaidCodeBlock\(block\)\) \{[\s\S]{0,400}renderBlock\?\.\(block/,
  "mermaid blocks emit the plugin's placeholder instead of a Shiki code block",
);
// ...and postProcess (the SVG injection) must run AFTER sanitizeHtml so the
// SVG's embedded <style> survives.
assert.match(
  source,
  /sanitizeHtml\(html\);[\s\S]{0,300}mermaidPlugin\?\.postProcess[\s\S]{0,80}postProcess\(sanitizedHtml\)/,
  "mermaid postProcess runs after sanitize (sanitizer strips <style>, which mermaid embeds in its SVG)",
);
// Only on settled snapshots — mid-stream the fence is usually incomplete.
assert.match(
  source,
  /!opts\?\.transient && codeBlocks\.some\(isMermaidCodeBlock\)/,
  "diagrams render only on non-transient (settled) snapshots",
);
assert.match(
  css,
  /\.cave-md \.cm-mermaid-diagram \{/,
  "cave-chat.css styles the rendered mermaid diagram card",
);

console.log("message-bubble-markdown.test.ts: ok");
