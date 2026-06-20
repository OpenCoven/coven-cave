// @ts-nocheck
// Library reader world-class polish: themed scrollbars, no duplicate H1,
// visible heading-jump flash, 68ch measure with adjustable type, header
// action cluster (no footer), prev/next doc nav, reduced-motion support.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/library.css", import.meta.url), "utf8");
const mobileCssStart = css.indexOf("@media (max-width: 767px) {");
const mobileCssEnd = css.indexOf("/* ── Undo delete toast", mobileCssStart);
assert.ok(mobileCssStart >= 0 && mobileCssEnd > mobileCssStart, "Library CSS should expose a mobile override block");
const mobileCss = css.slice(mobileCssStart, mobileCssEnd);

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
assert.match(
  css,
  /\.library-preview-body \.cave-md\.library-preview-md\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?width:\s*100%;/,
  "Inline Library previews span the available document pane instead of holding the old narrow measure",
);
assert.match(
  css,
  /\.library-preview-body--with-toc \.library-preview-md\s*\{[\s\S]*?max-width:\s*100%;/,
  "Inline Library previews with a ToC fill the space beside the On this page rail",
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
  /\.library-reader-backdrop\s*\{[\s\S]*?z-index:\s*320;/,
  "Reader backdrop should sit above mobile shell chrome and transient toasts",
);
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
assert.doesNotMatch(
  src,
  /READER_WIDE_KEY|readerWide|setReaderWide/,
  "Reader has no width preference state: it always opens expanded",
);
assert.doesNotMatch(
  src,
  /Widen reading width|Narrow reading width|ph:arrows-(in|out)-simple|aria-pressed=\{readerWide\}/,
  "Reader no longer renders an expand/narrow width toggle",
);
assert.match(
  src,
  /className="library-reader-modal library-reader-modal--wide"/,
  "Reader modal always opens in expanded full-width form",
);
assert.match(
  css,
  /\.library-reader-modal--wide \{[\s\S]*?width: calc\(100vw - 64px\);[\s\S]*?max-width: none;/,
  "Wide mode grows the reader to the available viewport width",
);
assert.match(
  css,
  /\.library-reader-modal--wide \.library-reader-body \.cave-md\.library-preview-md\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?width:\s*100%;/,
  "Wide mode makes every reader markdown body span the available width",
);
assert.match(
  css,
  /\.library-reader-modal--wide \.library-reader-body--with-toc \.library-preview-md\s*\{[\s\S]*?flex-basis:\s*100%;[\s\S]*?width:\s*100%;/,
  "Wide mode makes synthesis/paper markdown span the full reader width even when a ToC is present",
);
assert.match(
  mobileCss,
  /\.library-reader-backdrop\s*\{[\s\S]*?padding:\s*0;/,
  "Mobile reader backdrop should remove desktop inset padding so expanded mode can use the full phone viewport",
);
assert.match(
  mobileCss,
  /\.library-reader-modal--wide\s*\{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh;[\s\S]*?max-height:\s*100dvh;[\s\S]*?border-radius:\s*0;/,
  "Mobile reader expanded mode should fill the viewport instead of keeping desktop margins",
);
assert.match(
  mobileCss,
  /\.library-reader-header\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  "Mobile reader header should use normal grid flow so title and controls cannot overlap",
);
assert.match(
  mobileCss,
  /\.library-reader-actions\s*\{[\s\S]*?position:\s*static;[\s\S]*?justify-content:\s*flex-end;/,
  "Mobile reader actions should be in-flow and right aligned instead of absolutely overlaying the title",
);
assert.match(
  mobileCss,
  /\.library-reader-title\s*\{[\s\S]*?padding-right:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/,
  "Mobile reader title should own its full line and wrap safely for long document names",
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
