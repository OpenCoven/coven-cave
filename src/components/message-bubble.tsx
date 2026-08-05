"use client";

// Only the shared markdown/code sheet: MarkdownBlock/SyntaxBlock render on
// non-chat surfaces (settings memory tab, journal, github, command palette),
// which must not pull the whole chat stylesheet (#3264). The bubble/turn
// chrome (.cave-bubble-*) lives in cave-chat.css, imported by the chat
// surfaces that render <MessageBubble> itself (chat-view, group-chat-view).
import "@/styles/cave-md.css";

/**
 * MessageBubble — full Markdown/HTML rendering for Cave chat turns.
 *
 * SSR safety: @create-markdown/preview's main entry contains
 * `class extends HTMLElement` which crashes Node prerender.
 * We dynamically import it client-side only; SSR gets a plain
 * whitespace-pre-wrap fallback. Once hydrated, the async Shiki
 * render fires and swaps in the highlighted HTML.
 *
 * API path: @create-markdown/core `parse(md)` →
 * @create-markdown/preview `renderAsync(blocks, { customRenderers })`.
 * Chat keeps Cave's Shiki-powered code chrome/table-cell fixes as scoped
 * custom renderers, but the preview package owns the markdown document
 * structure and final HTML wrapper.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { parse } from "@create-markdown/core";
import type { Block } from "@create-markdown/core";
import type { PreviewPlugin } from "@create-markdown/preview";
import { getShikiHighlighter } from "@/lib/shiki-highlighter";
import { Icon } from "@/lib/icon";
import {
  parseCitations,
  renderCitedBody,
  renderCitationReferences,
  type Citation,
} from "@/lib/citations";
import { InlineCitationPreviews } from "@/components/ui/citation";
import { classifyDiffLines, parseFenceInfo, type DiffLine } from "@/lib/message-code-fences";
import {
  deriveReadingBlock,
  provenanceLabel,
  provenanceTitle,
  canCompare,
  type ReadingBlock,
} from "@/lib/code-reading";
import { getFeedback, setFeedback, recordFeedbackAnalytics, type Feedback, type FeedbackContext } from "@/lib/message-feedback";
import { SpeakBubble, type SpeakBubbleController } from "@/components/speak-bubble";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverSeparator } from "@/components/ui/popover";
// Lazy: the reader is a modal opened by an explicit click, and it carries its
// own stylesheet. Loading it eagerly puts both on the / route's first paint for
// every session, including the ones that never expand a message.
const MessageReader = dynamic(
  () => import("@/components/message-reader").then((m) => m.MessageReader),
  { ssr: false },
);
import type { BatchTool } from "@/lib/chat-tool-batches";
import { copyText } from "@/lib/clipboard";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { decorateResponseHtml } from "@/lib/response-status-tokens";
import { resolveShikiLang, diffContentLang } from "@/lib/code-lang";
import { unwrapPreviewShell } from "@/lib/markdown-preview-shell";
import { loadMarkdownPreview } from "@/lib/markdown-preview";
import {
  cacheRenderedMarkdown as renderCacheSet,
  createMarkdownRenderGate,
  getRenderedMarkdown as renderCacheGet,
  normalizePseudoLists,
  scanFenceFilenames,
  stabilizeStreamingMarkdown,
  type MarkdownRenderGate,
} from "@/lib/message-markdown-stream";
import { CodeReadingContext, FileLinkResolverContext, useWireCopyButtons } from "./message-dom-wiring";
export { CodeReadingContext, FileLinkResolverContext } from "./message-dom-wiring";
export type { CodeReading, CodeReadingRequest } from "./message-dom-wiring";
export type { FileLinkResolver } from "./message-dom-wiring";

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ONE_DAY = 24 * 60 * 60 * 1000;

export function fmtBubbleTime(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return Date.now() - d.getTime() > ONE_DAY ? dateFmt.format(d) : timeFmt.format(d);
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Parse fence info → { lang, filename }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Render a single code block with Shiki + chrome
// ---------------------------------------------------------------------------

/**
 * Blocks at/above this many lines get a "Show more" footer (CHAT-D7-03).
 * Tuned to the CSS clamp on .cave-code-wrap (max-height: min(60vh, 520px)):
 * at 12px mono / 1.6em rows plus header + footer + pre padding, 24 lines is
 * the first count guaranteed to overflow the 520px cap, so the toggle never
 * appears on a block that has nothing to expand. Shorter blocks on short
 * viewports (60vh < 520px) may still clip — inner scroll covers those.
 */
const CODE_EXPAND_MIN_LINES = 24;

function plainTextFromHtmlLine(line: string): string {
  const doc = new DOMParser().parseFromString(line, "text/html");
  return doc.body.textContent ?? "";
}

// ── Language-aware diff rendering ────────────────────────────────────────────
// A structured diff names its file in the `+++ b/<path>` header; when that
// file has a real grammar we highlight the diff's CONTENT in that language
// and re-attach the +/- markers as muted chrome, so an edit card or Review
// modal reads like code with add/remove strips instead of a flat wall of
// uniformly "inserted"-colored lines. Diffs whose target has no resolvable
// grammar keep the bundled `diff` grammar (whole-line coloring) below.

function plainCodeHtml(code: string): string {
  return `<pre class="shiki mood-c-dark cave-code-plain" tabindex="0"><code>${escHtml(code)}</code></pre>`;
}

function renderCodeBlockFrame({
  code,
  lang,
  filename,
  highlighted,
  isDiff,
  diffLines,
  block,
}: {
  code: string;
  lang: string;
  filename?: string;
  highlighted: string;
  isDiff: boolean;
  diffLines: DiffLine[] | null;
  /** Provenance-classified view of the fence (cave-f6mu9). */
  block: ReadingBlock;
}): string {
  const lines = code.split("\n");
  const showLineNums = lines.length > 5;

  // Both the plain and Shiki passes flow through this exact frame. Syntax
  // highlighting can therefore change token color without changing the code
  // card's header, gutters, line metrics, controls, or scroll geometry.
  const lineWrapped = highlighted.replace(
    /(<pre[^>]*>)([\s\S]*)(<\/pre>)/,
    (_match, open, inner, close) => {
      const focusableOpen = open.includes("tabindex=")
        ? open
        : open.replace("<pre", '<pre tabindex="0"');
      const codeInner = inner.replace(/(<code[^>]*>)([\s\S]*)(<\/code>)/, (_m2: string, co: string, codeContent: string, cc: string) => {
        const rawLines = codeContent.split("\n");
        // Remove trailing empty line Shiki adds.
        if (rawLines[rawLines.length - 1] === "") rawLines.pop();
        const wrappedLines = rawLines.map((line: string, i: number) => {
          let content = line;
          let gutterClass = "";
          const dl = diffLines?.[i];
          if (dl) {
            // Language-aware diff: meta/@@ rows were blanked for the grammar —
            // restore the raw text as muted chrome. +/- markers come back as a
            // dim leading span, so the DOM text (what Copy reads) stays
            // byte-identical to the raw diff.
            if (dl.kind === "meta" || dl.kind === "hunk") {
              content = `<span>${escHtml(dl.raw)}</span>`;
              gutterClass = " cave-diff-meta";
            } else {
              const marker = dl.marker ? `<span class="cave-diff-marker">${dl.marker}</span>` : "";
              content = `${marker}${line}`;
              gutterClass = dl.kind === "add" ? " cave-diff-add" : dl.kind === "del" ? " cave-diff-del" : "";
            }
          } else if (isDiff) {
            // CHAT-D8-03: `+++ b/file` / `--- a/file` headers are metadata, not
            // additions/deletions — exclude them from the +/- gutter strips and
            // mute `@@` hunk headers instead of leaving them content-colored.
            const plainLine = plainTextFromHtmlLine(line);
            gutterClass = /^@@/.test(plainLine)
              ? " cave-diff-meta"
              : /^(\+\+\+ |--- )/.test(plainLine)
              ? ""
              : line.includes('<span class="shiki-diff add"') || /^\+/.test(plainLine)
              ? " cave-diff-add"
              : /^-/.test(plainLine)
              ? " cave-diff-del"
              : "";
          }
          const lineNum = showLineNums
            ? `<span class="cave-ln" aria-hidden="true">${i + 1}</span>`
            : "";
          // data-line lets surfaces (e.g. the Projects search) scroll a code
          // block to a specific 1-based line. Harmless to chat code blocks.
          return `<span class="cave-line${gutterClass}" data-line="${i + 1}">${lineNum}${content}</span>`;
        });
        return `${co}${wrappedLines.join("")}${cc}`;
      });
      return `${focusableOpen}${codeInner}${close}`;
    },
  );

  const labelHtml = `<span class="cave-code-lang">${escHtml(lang)}</span>`;
  // The path reads dir-then-name with the directory muted, so the eye lands on
  // the file the block claims to be without losing where it lives.
  const filenameHtml = filename
    ? `<span class="cave-code-filename" title="${escHtml(filename)}">${
        block.dir ? `<span class="cave-code-dir">${escHtml(block.dir)}/</span>` : ""
      }${escHtml(block.name ?? filename)}</span>`
    : "";

  // ── Reading chrome (cave-f6mu9) ───────────────────────────────────────────
  // The provenance pill is the load-bearing part: it tells the reader whether
  // this block is backed by a file (openable, comparable), a patch (appliable)
  // or merely quoted (neither). Every action below is gated on it, so a
  // control never offers something the block cannot deliver.
  const provHtml = `<span class="cave-code-prov cave-code-prov--${block.provenance}" title="${escHtml(
    provenanceTitle(block.provenance),
  )}">${escHtml(provenanceLabel(block.provenance))}</span>`;
  // Filled in by the working-tree check after render (wireCodeReading); hidden
  // until then so a block never claims freshness it has not verified.
  const staleHtml = `<span class="cave-code-stale" hidden></span>`;
  const readHtml = `<button type="button" class="cave-code-read-btn" aria-label="Read this code block">Read</button>`;
  const compareHtml = canCompare(block.provenance)
    ? `<button type="button" class="cave-code-compare-btn" aria-label="Compare with the working tree">Compare</button>`
    : "";
  // Collapse toggle (chevron) folds the block down to just this header so a
  // long code dump can be tucked away; blocks render expanded by default. The
  // line count hints at size while collapsed.
  const lineCount = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const collapseBtn = `<button type="button" class="cave-code-collapse-btn" aria-label="Collapse code" aria-expanded="true"><svg class="cave-code-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const linesHtml = lineCount > 1 ? `<span class="cave-code-lines" aria-hidden="true">${lineCount} lines</span>` : "";
  // No data-code attribute (CHAT-D7-04): wireCopyButtons reads the code text
  // back out of the rendered DOM at click time instead of carrying a second
  // copy of every block's source in an attribute.
  const headerHtml = `<div class="cave-code-header">${collapseBtn}${labelHtml}${provHtml}${filenameHtml}${staleHtml}${linesHtml}${readHtml}${compareHtml}<button type="button" class="cave-copy-btn cave-copy-btn-mounted">Copy</button></div>`;
  const expandHtml = lines.length >= CODE_EXPAND_MIN_LINES
    ? `<div class="cave-code-expand"><button type="button" class="cave-code-expand-btn">Show more</button></div>`
    : "";

  // Provenance/path/lang ride on the wrap rather than on each button: the
  // wiring layer reads the code text back out of the DOM at click time
  // (CHAT-D7-04), and the same rule applies here — one carrier, no second copy
  // of the block's identity to drift out of sync.
  const dataAttrs = [
    `data-code-provenance="${escHtml(block.provenance)}"`,
    `data-code-lang="${escHtml(block.lang)}"`,
    block.path ? `data-code-path="${escHtml(block.path)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="cave-code-wrap" ${dataAttrs}>${headerHtml}${lineWrapped}${expandHtml}</div>`;
}

async function renderCodeBlock(
  code: string,
  info: string,
  { highlightCode = true }: { highlightCode?: boolean } = {},
): Promise<string> {
  const { lang, filename } = parseFenceInfo(info);
  const block = deriveReadingBlock(info);
  // One classifier decides "is this a patch", so the rendering and the
  // provenance pill can never disagree — `patch` and `DIFF` are diffs too, and
  // before this they got the "patch" pill with none of the diff parsing.
  const isDiff = block.isDiff;
  const diffLang = isDiff ? diffContentLang(code) : "text";
  let diffLines = isDiff && diffLang !== "text" ? classifyDiffLines(code) : null;
  const doc = diffLines ? diffLines.map((line) => line.content).join("\n") : code;

  let highlighted: string;
  if (!highlightCode) {
    highlighted = plainCodeHtml(doc);
  } else {
    try {
      // Language-aware diffs feed the grammar the diff's content with markers
      // stripped and meta rows blanked — one line per original line, so the
      // highlighted output stays index-aligned with the classification.
      const resolvedLang = diffLines ? diffLang : resolveShikiLang(lang);
      const hl = await getShikiHighlighter(resolvedLang);
      highlighted = hl.codeToHtml(doc, {
        // resolveShikiLang maps both fence names (`typescript`) AND bare file
        // extensions (`ts`, `tsx`, `rs`) to a loadable grammar.
        lang: resolvedLang,
        theme: "mood-c-dark",
      });
    } catch (err) {
      console.error("[renderCodeBlock] Shiki highlight failed", err);
      // Fallback renders the ORIGINAL code (markers intact) — drop the
      // language-aware line map so markers aren't re-attached twice.
      highlighted = plainCodeHtml(code);
      diffLines = null;
    }
  }

  return renderCodeBlockFrame({
    code,
    lang,
    filename,
    highlighted,
    isDiff,
    diffLines,
    block,
  });
}

/**
 * Highlight a snippet to a *bare* Shiki `<pre class="shiki">…</pre>` — no
 * cave-code-wrap header, copy button, or line gutters. For surfaces that
 * already supply their own chrome (e.g. the in-chat Canvas artifact viewer,
 * which has its own header + actions) and just want colored code. Reuses the
 * same lazy singleton as the chat code blocks, so no extra Shiki/WASM load.
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const resolvedLang = resolveShikiLang(lang);
  const hl = await getShikiHighlighter(resolvedLang);
  return hl.codeToHtml(code, { lang: resolvedLang, theme: "mood-c-dark" });
}

// ---------------------------------------------------------------------------
// SyntaxBlock — exported for tool I/O and other raw-code surfaces
// ---------------------------------------------------------------------------

/**
 * Detects the best language for auto-highlighting tool I/O:
 * - valid JSON → "json"
 * - looks like shell output → "bash"
 * - looks like a diff → "diff"
 * - otherwise → "text"
 */
function autoDetectLang(text: string): string {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { JSON.parse(text); return "json"; } catch { /* not json */ }
  }
  if (/^(diff --git|--- a\/|\+\+\+ b\/)/.test(trimmed)) return "diff";
  if (/^(#!\/(bin|usr)\/|\$\s|>>>\s)/.test(trimmed)) return "bash";
  return "text";
}

type SyntaxBlockProps = {
  /** Raw text content to highlight */
  text: string;
  /** Override language detection */
  lang?: string;
  /** Additional className on the outer wrapper */
  className?: string;
  /** 1-based line to scroll to and highlight once rendered (e.g. a search
   *  match). Re-running with the same value re-scrolls. */
  highlightLine?: number;
};

/**
 * Drop-in replacement for `<pre>` in tool I/O blocks, comux output, and
 * inspector pane. Uses the same Shiki singleton as MessageBubble, so the
 * highlighter is only initialised once per session.
 */
export function SyntaxBlock({ text, lang, className, highlightLine }: SyntaxBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useWireCopyButtons(html);
  const resolvedLang = lang ?? autoDetectLang(text);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    void renderCodeBlock(text, resolvedLang).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => { cancelled = true; };
  }, [text, resolvedLang]);

  // Scroll to and briefly highlight the target line once the highlighted HTML
  // is in the DOM. data-line anchors are emitted by renderCodeBlock.
  useEffect(() => {
    if (!html) return;
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll(".cave-line--active").forEach((el) => el.classList.remove("cave-line--active"));
    if (!highlightLine) return;
    const row = container.querySelector<HTMLElement>(`.cave-line[data-line="${highlightLine}"]`);
    if (!row) return;
    row.classList.add("cave-line--active");
    row.scrollIntoView({ block: "center" });
  }, [html, highlightLine, containerRef]);

  if (!html) {
    return (
      <pre className={`whitespace-pre-wrap break-words font-mono text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)] ${className ?? ""}`}>
        {text}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`cave-syntax-block text-[length:var(--text-sm)] ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---------------------------------------------------------------------------
// Public: MarkdownBlock — renders full markdown (prose + code) via @create-markdown/preview
// ---------------------------------------------------------------------------

export function MarkdownBlock({
  text,
  className,
  onOpenUrl,
}: {
  text: string;
  className?: string;
  onOpenUrl?: (url: string) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useWireCopyButtons(html, onOpenUrl);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    mdToHtml(text)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch((err) => { console.error("[MarkdownBlock] mdToHtml failed", err); });
    return () => { cancelled = true; };
  }, [text]);

  if (!html) {
    return (
      <pre className={`whitespace-pre-wrap break-words font-mono text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)] ${className ?? ""}`}>
        {text}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`cave-md ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escHtml(s: string): string {
  // Match @create-markdown/preview's escapeHtml (also escapes " and ') so the
  // regex substitution against proseHtml lines up when code contains quotes.
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
// ---------------------------------------------------------------------------
// Render markdown to HTML (async, Shiki per code block)
// ---------------------------------------------------------------------------

/** Streaming markdown re-renders at most once per this many ms (trailing). */
const STREAM_RENDER_INTERVAL_MS = 200;

/**
 * Mid-stream nicety: if the accumulated text ends inside an unterminated
 * code fence, close it before rendering so the partial block highlights as
 * code instead of pulling the rest of the snapshot into a runaway open
 * block. Only applied to transient streaming snapshots — the final settled
 * render gets the text verbatim.
 */
function coalesceAdjacentNumberedLists(blocks: Block[]): Block[] {
  const coalesced: Block[] = [];
  for (const block of blocks) {
    const normalizedBlock = block.children.length
      ? { ...block, children: coalesceAdjacentNumberedLists(block.children) }
      : block;
    const previous = coalesced[coalesced.length - 1];
    if (previous?.type === "numberedList" && normalizedBlock.type === "numberedList") {
      previous.children = [...previous.children, ...normalizedBlock.children];
      continue;
    }
    coalesced.push(normalizedBlock);
  }
  return coalesced;
}

// ---------------------------------------------------------------------------
// Table cells: @create-markdown/preview emits header/row cells as escaped
// plain text, so `**bold**`, `_em_`, `` `code` `` and [links] inside a table
// show up literally. Re-render each cell through the inline (paragraph) path
// and rebuild the table; mdToHtml substitutes these positionally for the
// renderer's own <table> output.
// ---------------------------------------------------------------------------

type RenderAsyncFn = (blocks: Block[]) => Promise<string>;

type TableBlock = {
  type: "table";
  props: {
    headers?: string[];
    rows?: string[][];
    alignments?: Array<string | null>;
  };
};

async function renderInlineMd(text: string, renderAsync: RenderAsyncFn): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const html = (await renderAsync(parse(trimmed))).trim();
  // Single paragraph (the normal cell shape) → unwrap to its inline HTML.
  const para = /^<div class="cm-preview"><p[^>]*>([\s\S]*)<\/p><\/div>$/.exec(html);
  if (para) return para[1];
  // Anything else (cell parsed as heading/list/etc.) → keep block HTML, drop wrapper.
  return html.replace(/^<div class="cm-preview">/, "").replace(/<\/div>$/, "");
}

async function renderTableBlock(block: TableBlock, renderAsync: RenderAsyncFn): Promise<string> {
  const headers = block.props.headers ?? [];
  const rows = block.props.rows ?? [];
  const alignments = block.props.alignments ?? [];
  const alignAttr = (i: number) =>
    alignments[i] ? ` style="text-align: ${alignments[i]}"` : "";

  const ths = await Promise.all(
    headers.map(async (h, i) => `<th${alignAttr(i)}>${await renderInlineMd(h, renderAsync)}</th>`),
  );
  const trs = await Promise.all(
    rows.map(async (row) => {
      const tds = await Promise.all(
        row.map(async (cell, i) => `<td${alignAttr(i)}>${await renderInlineMd(cell, renderAsync)}</td>`),
      );
      return `<tr>${tds.join("")}</tr>`;
    }),
  );
  return `<table class="cm-table"><thead><tr>${ths.join("")}</tr></thead><tbody>${trs.join("")}</tbody></table>`;
}

// Mermaid diagrams (```mermaid fences) render via @create-markdown/preview-mermaid.
// The package + its `mermaid` peer are heavy and browser-only, so the plugin is
// imported lazily and only when a message actually contains a mermaid fence. The
// instance is a module singleton so init() (which loads mermaid) runs once.
let mermaidPluginPromise: Promise<PreviewPlugin | null> | null = null;

/** Resolve a CSS custom property to a HEX color for mermaid's theme
 *  variables. Mermaid bakes colors into SVG attributes and derives shades via
 *  khroma, which cannot parse the app's oklch()/color-mix() token values —
 *  fed those raw it produces broken near-white fills. Painting the token onto
 *  a 1×1 canvas lets the browser resolve ANY CSS color, then we read back
 *  plain rgb and emit hex. Falls back when the token is missing/unpaintable. */
function themeToken(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) return fallback;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    // Composite over black first so semi-transparent tokens (the border
    // scale is color-mix ...% transparent) resolve to their on-dark look
    // instead of reading back a premultiplied near-white.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = value; // unparseable values leave the previous fillStyle
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

async function getMermaidPlugin(): Promise<PreviewPlugin | null> {
  if (!mermaidPluginPromise) {
    mermaidPluginPromise = import("@create-markdown/preview-mermaid")
      .then(async ({ mermaidPlugin }) => {
        // Base "dark" + the app's live theme tokens, so diagrams stop shipping
        // stock mermaid purple and read as part of the surface: node fills sit
        // on the raised layer, strokes on the hairline scale, and the accent
        // appears only where mermaid marks emphasis. securityLevel "strict"
        // overrides the plugin's default "loose" so diagrams from untrusted
        // chat content can't smuggle scripts/click handlers (postProcess
        // output bypasses our sanitizer).
        const accent = themeToken("--accent-presence", "#9386d0");
        const raised = themeToken("--bg-raised", "#242327");
        const panel = themeToken("--bg-panel", "#1a1a1d");
        const textPrimary = themeToken("--text-primary", "#e6e6f0");
        const textSecondary = themeToken("--text-secondary", "#929198");
        const hairline = themeToken("--border-strong", "#807f80");
        const plugin = mermaidPlugin({
          // "base" is the only mermaid theme that honors themeVariables;
          // darkMode below keeps its derived shades on the dark ramp.
          theme: "base",
          config: {
            securityLevel: "strict", suppressErrorRendering: true,
            fontFamily:
              'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            themeVariables: {
              darkMode: true,
              background: panel,
              primaryColor: raised,
              primaryTextColor: textPrimary,
              primaryBorderColor: hairline,
              secondaryColor: panel,
              secondaryTextColor: textSecondary,
              secondaryBorderColor: hairline,
              tertiaryColor: panel,
              tertiaryTextColor: textSecondary,
              tertiaryBorderColor: hairline,
              lineColor: textSecondary,
              textColor: textPrimary,
              mainBkg: raised,
              nodeBorder: hairline,
              clusterBkg: panel,
              clusterBorder: hairline,
              titleColor: textPrimary,
              edgeLabelBackground: panel,
              actorBkg: raised,
              actorBorder: hairline,
              actorTextColor: textPrimary,
              activationBkgColor: raised,
              labelBoxBkgColor: raised,
              labelBoxBorderColor: hairline,
              noteBkgColor: panel,
              noteBorderColor: hairline,
              noteTextColor: textSecondary,
              pie1: accent,
              cScale0: accent,
            },
          },
        });
        await plugin.init?.();
        return plugin;
      })
      .catch((err) => {
        console.error("[MarkdownBlock] mermaid plugin load failed", err);
        return null;
      });
  }
  return mermaidPluginPromise;
}

function isMermaidCodeBlock(block: Block): boolean {
  if (block.type !== "codeBlock") return false;
  const cb = block as { props: { language?: string; info?: string } };
  const lang = (cb.props.language ?? cb.props.info ?? "").trim().toLowerCase();
  return lang === "mermaid";
}

async function mdToHtml(
  markdown: string,
  opts?: { transient?: boolean; highlightCode?: boolean; decorateResponse?: boolean },
): Promise<string> {
  const canUseCache = !opts?.transient && opts?.highlightCode !== false;
  const cacheKey = `${opts?.decorateResponse ? "response" : "document"}:${markdown}`;
  if (canUseCache) {
    const cached = renderCacheGet(cacheKey);
    if (cached !== undefined) return cached;
  }

  const { renderAsync } = await loadMarkdownPreview();

  // @create-markdown/core's fenced-code parser rejects any info string that
  // contains a colon (e.g. ```ts:example.ts), treating the opener as a
  // paragraph and then mis-reading the closing ``` as a new opener — which
  // cascades and swallows the rest of the message as a fake code block.
  // Pre-scan filenames (positional, one per fence opener) so we can re-attach
  // them after stripping the suffix for the parser.
  // Pseudo-list normalization runs first: @create-markdown/core lacks lazy
  // continuation, so wrapped list items (and `1)` / `**1. Title**` markers)
  // otherwise render as dense paragraph fragments. Fence lines pass through
  // untouched, so the positional filename scan stays aligned.
  const listNormalized = normalizePseudoLists(markdown);
  const fenceFilenames = scanFenceFilenames(listNormalized);
  const normalized = listNormalized.replace(/^(\s*```\s*[\w+.-]+):\S+/gm, "$1");

  const blocks: Block[] = coalesceAdjacentNumberedLists(parse(normalized));

  // Precompute each async code renderer result. Index-keyed (not pushed)
  // so codeReplacements[i] corresponds to the i-th code block in parse order
  // regardless of Promise.all resolution order.
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
  // Only render diagrams on settled (non-transient) snapshots — mid-stream the
  // fence is usually incomplete, so the mermaid source shows as a code block
  // until the message finishes, then swaps to the rendered diagram.
  const mermaidPlugin =
    canUseCache && codeBlocks.some(isMermaidCodeBlock) ? await getMermaidPlugin() : null;
  const codeReplacements: string[] = new Array(codeBlocks.length);
  await Promise.all(
    codeBlocks.map(async (block, i) => {
      // @create-markdown/core CodeBlock has .content (spans) and .props
      const cb = block as {
        type: "codeBlock";
        content: Array<{ text: string }>;
        props: { language?: string; info?: string };
      };
      const code = cb.content.map((s) => s.text).join("");
      if (mermaidPlugin && isMermaidCodeBlock(block)) {
        // renderBlock emits a sanitizer-safe <pre class="cm-mermaid"> placeholder;
        // postProcess swaps it for the SVG AFTER sanitizeHtml (which would
        // otherwise strip the <style> mermaid embeds inside the SVG).
        codeReplacements[i] = mermaidPlugin.renderBlock?.(block, () => "") ?? "";
        return;
      }
      const rawInfo = cb.props.info ?? cb.props.language ?? "";
      const filename = fenceFilenames[i] ?? null;
      const info = filename ? `${rawInfo}:${filename}` : rawInfo;
      codeReplacements[i] = await renderCodeBlock(code, info, {
        highlightCode: opts?.highlightCode !== false,
      });
    }),
  );

  const tableBlocks = blocks.filter((b): b is Block & TableBlock => b.type === "table");
  const tableReplacements = await Promise.all(
    tableBlocks.map(async (block) => {
      // CHAT-D7-08: wide tables scroll horizontally inside this wrapper
      // instead of word-shattering under .cave-md's overflow-wrap: anywhere.
      return `<div class="cave-table-scroll">${await renderTableBlock(block, renderAsync)}</div>`;
    }),
  );

  let codeRenderIdx = 0;
  let tableRenderIdx = 0;
  const html = await renderAsync(blocks, {
    linkTarget: "_self",
    sanitize: sanitizeHtml,
    customRenderers: {
      codeBlock: () => codeReplacements[codeRenderIdx++] ?? "",
      table: () => tableReplacements[tableRenderIdx++] ?? "",
    },
  });

  let sanitizedHtml = sanitizeHtml(html);
  // Render mermaid diagrams AFTER sanitize: the SVG (and the <style> mermaid
  // embeds inside it) must not pass through sanitizeHtml, which strips <style>.
  if (mermaidPlugin?.postProcess) {
    sanitizedHtml = await mermaidPlugin.postProcess(sanitizedHtml);
  }
  if (opts?.decorateResponse) sanitizedHtml = decorateResponseHtml(sanitizedHtml);
  // Strip the renderer's cm-preview shell so blocks land as DIRECT children
  // of .cave-md — its `> * + *` owl selector is the only block-rhythm rule,
  // and with the shell in place a list rendered flush against the paragraph
  // introducing it (no line break before bullets).
  sanitizedHtml = unwrapPreviewShell(sanitizedHtml);
  // Transient (mid-stream) snapshots are never requested again once the
  // stream advances past them — caching one per throttle tick would churn
  // settled entries out of the LRU for no hit-rate gain.
  if (canUseCache) renderCacheSet(cacheKey, sanitizedHtml);
  return sanitizedHtml;
}

// ---------------------------------------------------------------------------
// MarkdownContent — progressive async render while streaming (CHAT-D3-01);
// plain fallback only until the first render lands
// ---------------------------------------------------------------------------

type MarkdownContentProps = {
  text: string;
  pending?: boolean;
  onOpenUrl?: (url: string) => void;
  citations?: readonly Citation[];
  decorateResponse?: boolean;
  /** Immutable execution root of the transcript turn that owns this prose. */
  projectRoot?: string | null;
  /** Stable transcript turn/message identity for reader provenance. */
  messageId?: string | null;
  /** Extra classes on the markdown container — the Expand reader uses this to
   *  set its own reading scale (.cave-md--reader). Omitted in the transcript,
   *  which reads at the stream's density. */
  className?: string;
};

function MarkdownContent({
  text,
  pending,
  onOpenUrl,
  citations = [],
  decorateResponse = false,
  projectRoot = null,
  messageId = null,
  className,
}: MarkdownContentProps) {
  const cacheKey = `${decorateResponse ? "response" : "document"}:${text}`;
  const [html, setHtml] = useState<string | null>(
    () => pending ? null : renderCacheGet(cacheKey) ?? null,
  );
  // Chat prose file references (`src/foo.ts:42`) open in Code — but only when
  // the surface's resolver (FileLinkResolverContext) confirms the file exists
  // under the session's project root. No resolver ⇒ refs stay plain text.
  const fileLinkResolver = useContext(FileLinkResolverContext);
  // Same posture for code blocks (cave-f6mu9): Read/Compare stay hidden until a
  // surface supplies an inspector to receive them.
  const reading = useContext(CodeReadingContext);
  const containerRef = useWireCopyButtons(
    html,
    onOpenUrl,
    fileLinkResolver,
    reading,
    projectRoot,
    messageId,
  );
  // mdToHtml is async and several streaming renders can be in flight at once.
  // The gate orders their commits and invalidates pre-settle work synchronously
  // during render, before React runs passive-effect cleanup or the final pass.
  const renderGateRef = useRef<MarkdownRenderGate | null>(null);
  if (!renderGateRef.current) renderGateRef.current = createMarkdownRenderGate();
  const renderGate = renderGateRef.current;
  const wasPendingRef = useRef(Boolean(pending));
  if (wasPendingRef.current && !pending) {
    renderGate.settle();
  }
  useLayoutEffect(() => {
    wasPendingRef.current = Boolean(pending);
  }, [pending]);
  // Throttle bookkeeping for streaming renders. Lives in a ref because the
  // effect re-fires on every streamed chunk: a per-effect trailing debounce
  // would be reset by each chunk and never fire under a steady stream.
  const lastStreamRenderRef = useRef(0);

  useEffect(() => {
    // No "same text" guard here: the effect only re-fires when text/pending
    // change, and a ref-based guard poisons itself under StrictMode's
    // double-invoke (run 1 marks the text seen, then gets cancelled; run 2
    // early-returns and the bubble is stuck on the plain-text fallback).
    // mdToHtml memoizes per-text, so re-entry is cheap.
    if (!text) return;

    if (pending) {
      // CHAT-D3-01: render markdown progressively during the stream instead
      // of showing literal ``` fences and **markers** until `done` (which
      // then re-typesets the whole bubble at once — live-measured CLS 0.53).
      // Renders are throttled to one per STREAM_RENDER_INTERVAL_MS, trailing
      // edge; the first chunk renders immediately (lastStreamRenderRef starts
      // at 0, so the first elapsed check always passes).
      //
      // Deliberately NOT gated on a `cancelled` flag: every chunk re-runs
      // this effect, so any stream whose chunk interval is shorter than
      // mdToHtml's latency would cancel every in-flight render before it
      // commits and nothing would paint until the turn settles (starvation).
      // The stamp guard above provides ordering safety instead; a commit
      // after unmount is a no-op state update that React drops.
      const stamp = renderGate.issue();
      const run = () => {
        lastStreamRenderRef.current = Date.now();
        mdToHtml(stabilizeStreamingMarkdown(text), {
          transient: true,
          highlightCode: false,
          decorateResponse,
        })
          .then((h) => {
            if (!renderGate.apply(stamp)) return;
            setHtml(h);
          })
          .catch((err) => { console.error("[MarkdownContent] mdToHtml failed", err); });
      };
      const wait = STREAM_RENDER_INTERVAL_MS - (Date.now() - lastStreamRenderRef.current);
      if (wait <= 0) {
        run();
        return;
      }
      const timer = setTimeout(run, wait);
      return () => { clearTimeout(timer); };
    }

    // Settled (`pending` → false): paint document + code-card geometry first,
    // then enhance that stable frame with Shiki token colors. A cached final
    // render resolves immediately and never regresses to the plain stage.
    let cancelled = false;
    const cached = renderCacheGet(cacheKey);
    if (cached !== undefined) {
      const stamp = renderGate.issue();
      if (renderGate.apply(stamp)) setHtml(cached);
      return () => { cancelled = true; };
    }

    const plainStamp = renderGate.issue();
    mdToHtml(text, { highlightCode: false, decorateResponse })
      .then((plainHtml) => {
        if (cancelled) return;
        if (!renderGate.apply(plainStamp)) return;
        setHtml(plainHtml);

        const highlightedStamp = renderGate.issue();
        return mdToHtml(text, { decorateResponse }).then((highlightedHtml) => {
          if (cancelled) return;
          if (!renderGate.apply(highlightedStamp)) return;
          setHtml(highlightedHtml);
        });
      })
      .catch((err) => { console.error("[MarkdownContent] mdToHtml failed", err); });
    return () => { cancelled = true; };
  }, [cacheKey, decorateResponse, pending, renderGate, text]);

  if (!html) {
    if (!decorateResponse) {
      return (
        <span className={`whitespace-pre-wrap break-words text-[length:var(--text-md)] leading-relaxed${className ? ` ${className}` : ""}`}>
          {text}
          {pending ? "▌" : ""}
        </span>
      );
    }
    return (
      <span
        className={`cave-response-rendering${className ? ` ${className}` : ""}`}
        role="status"
        aria-label={pending ? "Familiar is writing" : "Rendering response"}
      >
        <span className="cave-response-typing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{pending ? "Writing" : "Rendering response"}</span>
      </span>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className={`cave-md${className ? ` ${className}` : ""}`}
        // Markdown output is sanitized in mdToHtml before DOM insertion.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {/* This is a separate response status, not a cursor intended to trail the
          final rendered line. Keeping it outside sanitized HTML avoids malformed
          Markdown while making its standalone placement deliberate. */}
      {pending ? (
        <span className="cave-response-typing" role="status" aria-label="Familiar is writing">
          <span className="cave-response-typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Writing</span>
        </span>
      ) : null}
      <InlineCitationPreviews
        citations={citations}
        containerRef={containerRef}
        onOpenUrl={onOpenUrl}
        projectRoot={projectRoot}
        renderedHtml={html}
      />
    </>
  );
}

export function ProgressiveMarkdownBlock({
  text,
  pending,
}: {
  text: string;
  pending?: boolean;
}) {
  return <MarkdownContent text={text} pending={pending} />;
}

// ---------------------------------------------------------------------------
// CopyButton — hover "Copy message" (raw markdown source)
// ---------------------------------------------------------------------------

function CopyBubble({ text, response = false }: { text: string; response?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy message"}
      onClick={copy}
      className={`cave-copy-btn cave-copy-btn-bubble focus-ring${response ? " cave-response-action" : ""}${copied ? " cave-copy-btn--confirmed" : ""}`}
    >
      {response ? <Icon name="ph:copy" width={12} aria-hidden /> : null}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Public: MessageBubble
// ---------------------------------------------------------------------------

/**
 * CHAT-D4-01: one ordered display segment of an assistant turn — either a
 * prose span or an opaque block (a tool call rendered by the caller) at its
 * chronological position between spans.
 */
export type MessageBubbleSegment =
  | { kind: "text"; text: string }
  | { kind: "block"; key: string; node: ReactNode };

export type MessageBubbleProps = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  showTimestamp?: boolean;
  pending?: boolean;
  isError?: boolean;
  label?: string;
  /** CHAT-D6-01: edit-and-resend — renders an Edit action in the user bubble's
   *  revealed action row. Caller decides availability (user turns with text). */
  onEdit?: () => void;
  /** CHAT-D6-02: regenerate — renders a Regenerate action in the assistant
   *  bubble's revealed action row. Caller gates it on !busy/!pending. */
  onRegenerate?: () => void;
  /** Reply to Chat — renders a Reply action in the revealed action row of
   *  either role. Loads this turn as a quoted reply target in the composer;
   *  caller gates it on settled (non-pending) turns with text. */
  onReply?: () => void;
  onOpenUrl?: (url: string) => void;
  /** Immutable execution root recorded for this historical turn. */
  projectRoot?: string | null;
  /** Stable id for this message — enables local thumbs-up/down persistence
   *  (assistant role only). Without it the thumbs buttons are not rendered. */
  messageId?: string;
  /** Non-identifying context (e.g. the familiar id) stamped alongside a thumbs
   *  vote when it's mirrored to the local analytics store. */
  feedbackContext?: FeedbackContext;
  /** CHAT-D4-01: ordered segments — prose spans interleaved with tool blocks
   *  at their chronological position. Assistant role only; when present they
   *  replace the single MarkdownContent render. `content` must still carry
   *  the FULL text so the Copy/Expand actions are unchanged. Only the LAST
   *  text span streams (progressive markdown); earlier spans render settled. */
  segments?: MessageBubbleSegment[];
  /** The turn's tool events, forwarded to the reader's "How this was made"
   *  footer (batches, skills, error count). Assistant role only; absent turns
   *  simply have no footer — see message-reader.tsx. */
  readerTools?: readonly BatchTool[];
  /** Wall time for the whole turn, shown in the reader's footer receipt. */
  readerDurationMs?: number;
  /** Ask a follow-up about a passage selected inside the reader. Without it
   *  the reader's selection ask-bar is not rendered. */
  onAskAbout?: (quote: string) => void;
  /** The prompt that produced this answer, echoed above it in the reader. */
  readerPrompt?: { text: string; createdAt?: string };
  /** Rerun this turn from an edited prompt. Absent while busy or off the tip. */
  onRerunWith?: (prompt: string) => void;
  /** Which familiar produced the answer — the reader's Rewrite control asks it
   *  for the rewrite. Absent hides the control. */
  readerFamiliarId?: string;
  /** The owning surface already supplies a collapse control (Coven sections). */
  collapsible?: boolean;
  /** Branching: when a turn has siblings, render a compact ‹ index/total ›
   *  switcher. Omitted (or total <= 1) hides it. */
  branchNav?: {
    index: number; // 0-based
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
};

export function MessageBubble({ role, content, timestamp, showTimestamp = true, pending, isError, label, onEdit, onRegenerate, onReply, onOpenUrl, projectRoot = null, messageId, feedbackContext, segments, readerTools, readerDurationMs, onAskAbout, readerPrompt, onRerunWith, readerFamiliarId, collapsible = true, branchNav }: MessageBubbleProps) {
  const [tsVisible, setTsVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [speakState, setSpeakState] = useState<"idle" | "loading" | "playing">("idle");
  const speechRef = useRef<SpeakBubbleController | null>(null);
  const responseBodyId = useId();
  const [vote, setVote] = useState<Feedback | null>(() => (messageId ? getFeedback(messageId) : null));
  const applyVote = (v: Feedback) => {
    if (!messageId) return;
    setFeedback(messageId, v);
    const next = getFeedback(messageId);
    setVote(next);
    recordFeedbackAnalytics(messageId, v, next === null, feedbackContext);
  };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (!showTimestamp) {
      hoverTimer.current = setTimeout(() => setTsVisible(true), 600);
    }
  };
  const handleMouseLeave = () => {
    setTsVisible(false);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => {
    if (pending) setCollapsed(false);
  }, [pending]);

  const shouldShowTs = showTimestamp || tsVisible;

  // Citations: lift standard markdown footnotes out of the body so the sources
  // render as a rich footer below the message (never inside the sanitized HTML
  // pipeline). Bodies without footnotes pass through unchanged. Mid-stream the
  // definition block hasn't arrived, so this is a no-op until the turn settles.
  const cited = useMemo(() => renderCitedBody(content), [content]);
  const segmentedCitations = useMemo(
    () => (segments?.length ? parseCitations(content) : null),
    [content, segments],
  );

  if (role === "system") {
    return (
      <div className="group" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <div className="cave-bubble-system">
          <div className="cave-bubble-system-header">
            <span className="cave-bubble-system-sigil">$</span>
            {label ? (
              <span className="cave-bubble-system-label">{label}</span>
            ) : (
              <span className="cave-bubble-system-label cave-bubble-system-label--dim">system</span>
            )}
          </div>
          <pre className="cave-bubble-system-body">{content}</pre>
        </div>
        <div className={`cave-bubble-timestamp cave-bubble-timestamp--right${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
          {fmtBubbleTime(timestamp)}
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div
        className="group flex flex-col items-end"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="cave-bubble-user">
          <MarkdownContent
            text={content}
            pending={pending}
            onOpenUrl={onOpenUrl}
            projectRoot={projectRoot}
            messageId={messageId}
          />
        </div>
        {/* Action row sits BELOW the bubble (right-aligned via the items-end
            column) so it never overlays the message. Always in the DOM
            (CHAT-D6-04) — visibility is CSS-gated so the buttons are reachable
            by keyboard (Tab), screen readers, and touch. */}
        {!pending ? (
          <div className="cave-bubble-actions">
            {onReply ? (
              <button
                type="button"
                aria-label="Reply to message"
                title="Reply"
                onClick={onReply}
                className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
              >
                <Icon name="ph:arrow-bend-up-left" width={11} aria-hidden />
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                aria-label="Edit message"
                title="Edit and resend"
                onClick={onEdit}
                className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
              >
                <Icon name="ph:pencil-simple" width={11} aria-hidden />
              </button>
            ) : null}
            <CopyBubble text={content} />
          </div>
        ) : null}
        <div className={`cave-bubble-timestamp cave-bubble-timestamp--right${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
          {fmtBubbleTime(timestamp)}
        </div>
      </div>
    );
  }

  // Assistant
  // CHAT-D4-01: with segments, only the LAST text span is the live streaming
  // edge — earlier spans are settled slices that never change retroactively,
  // so they take MarkdownContent's settled path (cached render, no throttle).
  const lastTextIdx = segments
    ? segments.reduce((acc, seg, i) => (seg.kind === "text" ? i : acc), -1)
    : -1;
  const responseState = pending ? "streaming" : isError ? "error" : "complete";
  const canCollapse = collapsible && Boolean(content.trim());
  const hasMoreActions = Boolean(onReply || content || messageId);

  return (
    <div
      className="group relative cave-bubble-assistant"
      data-state={responseState}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div id={responseBodyId} className="cave-response-frame" data-state={responseState}>
        {collapsed ? (
          <div className="cave-response-collapsed" role="status">
            Response collapsed
          </div>
        ) : (
          <div className="cave-response-body">
            <div className={isError ? "text-[var(--danger-text)]" : ""}>
              {segments?.length ? (
                segments.map((seg, i) => {
                  if (seg.kind === "block") {
                    return <div key={seg.key} className="my-2">{seg.node}</div>;
                  }
                  const text = segmentedCitations
                    ? renderCitationReferences(seg.text, segmentedCitations)
                    : seg.text;
                  return (
                    <MarkdownContent
                      key={`span-${i}`}
                      text={text}
                      pending={pending && i === lastTextIdx}
                      onOpenUrl={onOpenUrl}
                      citations={cited.citations}
                      decorateResponse
                      projectRoot={projectRoot}
                      messageId={messageId}
                    />
                  );
                })
              ) : (
                <MarkdownContent
                  text={cited.body}
                  pending={pending}
                  onOpenUrl={onOpenUrl}
                  citations={cited.citations}
                  decorateResponse
                  projectRoot={projectRoot}
                  messageId={messageId}
                />
              )}
            </div>
          </div>
        )}
        {isError && !pending ? (
          <div className="cave-response-error" role="alert">
            Response interrupted
          </div>
        ) : null}
      </div>
      {/* Always in the DOM (CHAT-D6-04) — visibility is CSS-gated so the
          actions are reachable by keyboard (Tab), screen readers, and touch. */}
      {!pending && (content || isError) ? (
        <div className="cave-bubble-actions" role="group" aria-label="Response actions">
          {content ? <CopyBubble text={content} response /> : null}
          {onRegenerate ? (
            <button
              type="button"
              aria-label="Retry response"
              title="Retry"
              onClick={onRegenerate}
              className="cave-copy-btn cave-copy-btn-bubble cave-response-action focus-ring"
            >
              <Icon name="ph:arrow-clockwise" width={12} aria-hidden />
              Retry
            </button>
          ) : null}
          {canCollapse ? (
            <button
              type="button"
              aria-controls={responseBodyId}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
              className="cave-copy-btn cave-copy-btn-bubble cave-response-action focus-ring"
            >
              <Icon
                name={collapsed ? "ph:arrows-out-simple" : "ph:arrows-in-simple"}
                width={12}
                aria-hidden
              />
              {collapsed ? "Expand" : "Collapse"}
            </button>
          ) : null}
          {branchNav && branchNav.total > 1 ? (
            <span className="cave-chat-branch-nav" role="group" aria-label="Switch response branch">
              <button
                type="button"
                className="cave-chat-branch-nav__btn"
                onClick={branchNav.onPrev}
                disabled={branchNav.index <= 0}
                aria-label="Previous response"
              >
                ‹
              </button>
              <span className="cave-chat-branch-nav__count" aria-live="polite">
                {branchNav.index + 1}/{branchNav.total}
              </span>
              <button
                type="button"
                className="cave-chat-branch-nav__btn"
                onClick={branchNav.onNext}
                disabled={branchNav.index >= branchNav.total - 1}
                aria-label="Next response"
              >
                ›
              </button>
            </span>
          ) : null}
          {hasMoreActions ? (
            <OverflowMenu ariaLabel="More response actions" size="xs" className="cave-response-more">
              {onReply ? (
                <PopoverItem icon="ph:arrow-bend-up-left" onSelect={onReply}>
                  Reply
                </PopoverItem>
              ) : null}
              {content ? (
                <PopoverItem icon="ph:arrows-out-simple" onSelect={() => setReaderOpen(true)}>
                  Open reader
                </PopoverItem>
              ) : null}
              {content ? (
                <PopoverItem
                  icon={speakState === "playing" ? "ph:stop-fill" : "ph:speaker-high-fill"}
                  onSelect={() => speechRef.current?.toggle()}
                >
                  {speakState === "loading"
                    ? "Preparing audio"
                    : speakState === "playing"
                      ? "Stop reading"
                      : "Read aloud"}
                </PopoverItem>
              ) : null}
              {messageId && (onReply || content) ? <PopoverSeparator /> : null}
              {messageId ? (
                <PopoverItem
                  icon="ph:thumbs-up"
                  checked={vote === "up"}
                  onSelect={() => applyVote("up")}
                >
                  Good response
                </PopoverItem>
              ) : null}
              {messageId ? (
                <PopoverItem
                  icon="ph:thumbs-down"
                  checked={vote === "down"}
                  onSelect={() => applyVote("down")}
                >
                  Bad response
                </PopoverItem>
              ) : null}
            </OverflowMenu>
          ) : null}
          <SpeakBubble
            text={content}
            familiarId={feedbackContext?.familiarId}
            hidden
            controllerRef={speechRef}
            onStateChange={setSpeakState}
          />
        </div>
      ) : null}
      {readerOpen ? (
        <ExpandBubble
          open
          onClose={() => setReaderOpen(false)}
          text={content}
          label={label ?? "Familiar response"}
          tools={readerTools}
          durationMs={readerDurationMs}
          onAskAbout={onAskAbout}
          prompt={readerPrompt}
          onRerunWith={onRerunWith}
          familiarId={readerFamiliarId}
          projectRoot={projectRoot}
          messageId={messageId}
        />
      ) : null}
      <div className={`cave-bubble-timestamp${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
        {fmtBubbleTime(timestamp)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExpandBubble — opens the message in the reader (message-reader.tsx)
// ---------------------------------------------------------------------------

function ExpandBubble({
  open,
  onClose,
  text,
  label,
  tools,
  durationMs,
  onAskAbout,
  prompt,
  onRerunWith,
  familiarId,
  projectRoot,
  messageId,
}: {
  open: boolean;
  onClose: () => void;
  text: string;
  label: string;
  tools?: readonly BatchTool[];
  durationMs?: number;
  onAskAbout?: (quote: string) => void;
  prompt?: { text: string; createdAt?: string };
  onRerunWith?: (prompt: string) => void;
  familiarId?: string;
  projectRoot?: string | null;
  messageId?: string | null;
}) {
  const readerCited = useMemo(() => renderCitedBody(text), [text]);
  return (
    <>
      {open ? (
        <MessageReader
          text={text}
          label={label}
          tools={tools}
          durationMs={durationMs}
          onAsk={onAskAbout}
          prompt={prompt}
          onRerunWith={onRerunWith}
          familiarId={familiarId}
          onClose={onClose}
        >
          {/* MarkdownContent, not MarkdownBlock: it is the renderer that wires
              InlineCitationPreviews, so a cited answer gets the same interactive
              source chips the transcript shows instead of bare links. It also
              carries the file-link and code-reading wiring — the portal keeps
              those contexts, so they behave as they do in the stream.

              Renders the CITED body: raw `text` still carries the footnote
              definitions, so the reader would otherwise show `[^label]` markers
              inline and dump the definition block into the prose. `text` stays
              raw on the reader itself — Copy/Export hand back portable
              markdown, and the Sources tab needs those definitions to parse.

              The reader's own reading scale (.cave-md--reader in
              cave-md/prose.css): the transcript's dense 14px is right in the
              stream, wrong for a full-screen reading surface. */}
          <MarkdownContent
            text={readerCited.body}
            citations={readerCited.citations}
            projectRoot={projectRoot}
            messageId={messageId}
            className="cave-md--expanded cave-md--reader"
            decorateResponse
          />
        </MessageReader>
      ) : null}
    </>
  );
}
