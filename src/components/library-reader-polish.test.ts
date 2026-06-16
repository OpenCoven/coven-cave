// @ts-nocheck
// Library reader world-class polish: themed scrollbars, no duplicate H1,
// visible heading-jump flash, 68ch measure with adjustable type, header
// action cluster (no footer), prev/next doc nav, reduced-motion support.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/library.css", import.meta.url), "utf8");

// ── P0: scrollbars ──
assert.match(
  css,
  /\.library-reader-body \{[\s\S]*?scrollbar-width: thin;[\s\S]*?scrollbar-color: color-mix/,
  "Reader scroll area uses the themed thin scrollbar, not the UA default",
);
assert.match(
  css,
  /\.library-reader-body::-webkit-scrollbar \{ width: 6px; \}/,
  "Reader scrollbar has webkit styling too",
);

// ── P0: duplicate H1 ──
assert.match(
  src,
  /function stripLeadingTitleHeading\(body: string, title: string\)/,
  "A leading body H1 matching the doc title is stripped before render",
);
assert.match(
  src,
  /RenderedMarkdown text=\{renderBody\} containerRef=\{readerMdRef\}/,
  "Reader renders the deduped body",
);
assert.match(
  src,
  /RenderedMarkdown text=\{renderBody\} containerRef=\{mdRef\}/,
  "Inline preview renders the deduped body as well",
);

// ── P0: heading-jump flash is actually styled ──
assert.match(
  css,
  /\.library-heading--active \{[\s\S]*?background: color-mix/,
  "The j/k heading flash class has a visible style (it was applied but unstyled)",
);

// ── P1: measure + adjustable type ──
assert.match(
  css,
  /max-width: 68ch;[\s\S]*?font-size: var\(--reader-font-size, 17px\)/,
  "Reader prose holds a ~68ch centered measure with a user-adjustable size variable",
);
assert.match(
  src,
  /READER_FONT_KEY = "cave:library:reader-font"/,
  "Reader font size persists in localStorage",
);

// ── P1: backdrop + reduced motion ──
assert.match(css, /rgba\(0, 0, 0, 0\.95\);\s*backdrop-filter: blur\(10px\)/, "Backdrop dims harder + blurs more so the page can't bleed through");
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.library-reader-modal \{\s*animation: none;/,
  "Reader entrance animation respects prefers-reduced-motion",
);

// ── P2: footer gone, actions consolidated, single close ──
assert.doesNotMatch(src, /library-reader-footer/, "Reader footer bar is removed");
assert.doesNotMatch(src, /Exit reader/, "Duplicate Exit-reader affordance is gone (X + Esc + backdrop remain)");
assert.match(src, /className="library-reader-actions"/, "Header hosts the consolidated action cluster");
assert.doesNotMatch(
  src,
  /library-reader-iconbtn"[\s\S]{0,300}Open in editor/,
  "Reader cluster has no open-in-editor button (it stays in the inline preview header)",
);
assert.match(
  src,
  /READER_WIDE_KEY = "cave:library:reader-wide"/,
  "Reader width preference persists",
);
assert.match(
  src,
  /aria-pressed=\{readerWide\}[\s\S]{0,200}ph:arrows-(in|out)-simple/,
  "Width toggle is a labeled pressed-state button",
);
assert.match(
  css,
  /\.library-reader-modal--wide \{[\s\S]*?max-width: min\(1240px/,
  "Wide mode grows the modal and unlocks the measure",
);

// ── P2: prev/next document nav ──
assert.match(src, /export type DocNav = \{ index: number; total: number; onPrev/, "DocNav contract exported");
assert.match(
  src,
  /e\.key === "ArrowLeft" && docNav && docNav\.index > 0/,
  "ArrowLeft steps to the previous document in reader mode",
);
assert.match(
  view,
  /const docNav = selectedDocIndex >= 0/,
  "library-view computes reader prev/next from the current doc list",
);

// ── P2: copy-link-to-heading ──
assert.match(src, /library-heading-anchor/, "Reader headings grow a hover copy-link anchor");
assert.match(css, /h2:hover \.library-heading-anchor/, "Anchor reveals on heading hover");

// ── Translation handoff ──
assert.match(src, /function TranslateButton/, "Reader exposes a shared Translate action helper");
assert.match(src, /translate\.google\.com\/translate/, "URL-backed articles and papers open through Google Translate");
assert.match(src, /copyText\(buildTranslationPrompt/, "Local docs and files copy a translation prompt");
assert.match(
  src,
  /<TranslateButton[\s\S]{0,240}source=\{\{ kind: "text", title: doc\.title, text: renderBody \}\}/,
  "Markdown docs include a translate action in the preview header",
);
assert.match(
  src,
  /className="library-reader-actions"[\s\S]{0,500}<TranslateButton[\s\S]{0,220}readerIcon/,
  "Reader mode includes an icon-only translate action in the consolidated header cluster",
);
assert.match(
  src,
  /<TranslateButton[\s\S]{0,220}source=\{\{ kind: "url", title, url \}\}/,
  "URL-backed article/paper previews include a translate action",
);
assert.match(
  src,
  /<TranslateButton[\s\S]{0,220}source=\{\{ kind: "file", title, path: localPath \}\}/,
  "Local PDF previews include a translate action prompt",
);

console.log("library-reader-polish.test.ts: ok");
