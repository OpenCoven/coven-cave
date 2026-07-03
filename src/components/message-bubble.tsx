"use client";

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
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { parse } from "@create-markdown/core";
import type { Block } from "@create-markdown/core";
import type { PreviewPlugin } from "@create-markdown/preview";
import type { Highlighter } from "shiki";
import moodCTheme from "@/styles/shiki/mood-c-dark.json";
import { Icon } from "@/lib/icon";
import { getFeedback, setFeedback, recordFeedbackAnalytics, type Feedback, type FeedbackContext } from "@/lib/message-feedback";
import { copyText } from "@/lib/clipboard";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { SHIKI_LANGS, resolveShikiLang } from "@/lib/code-lang";
import { parseFileRef } from "@/lib/file-ref";
import { toggleCodeBlockCollapse } from "@/lib/code-block-collapse";
import { wireMermaidDiagrams } from "./mermaid-viewer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The bundled grammar list lives in code-lang.ts alongside the
// extension→grammar resolver, so the highlighter's loaded langs and the
// resolution table can never drift apart.
const LANGS = SHIKI_LANGS;

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
// Shiki singleton — lazy, client-only
// ---------------------------------------------------------------------------

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        themes: [moodCTheme as Parameters<typeof createHighlighter>[0]["themes"][number]],
        langs: [...LANGS],
      });
    })();
  }
  return highlighterPromise;
}

// ---------------------------------------------------------------------------
// Parse fence info → { lang, filename }
// ---------------------------------------------------------------------------

function parseFenceInfo(info: string): { lang: string; filename?: string } {
  if (!info) return { lang: "text" };
  // Support `lang:filename.ext` syntax
  const colonIdx = info.indexOf(":");
  if (colonIdx > 0) {
    return { lang: info.slice(0, colonIdx).trim(), filename: info.slice(colonIdx + 1).trim() };
  }
  return { lang: info.trim() };
}

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

async function renderCodeBlock(
  code: string,
  info: string,
): Promise<string> {
  const { lang, filename } = parseFenceInfo(info);

  let highlighted: string;
  try {
    const hl = await getHighlighter();
    highlighted = hl.codeToHtml(code, {
      // resolveShikiLang maps both fence names (`typescript`) AND bare file
      // extensions (`ts`, `tsx`, `rs`) to a loadable grammar — without it the
      // Projects file preview, which passes raw extensions, fell back to the
      // unhighlighted "text" grammar for every file.
      lang: resolveShikiLang(lang),
      theme: "mood-c-dark",
    });
  } catch (err) {
    console.error("[renderCodeBlock] Shiki highlight failed", err);
    highlighted = `<pre><code>${escHtml(code)}</code></pre>`;
  }

  const lines = code.split("\n");
  const showLineNums = lines.length > 5;
  const isDiff = lang === "diff";

  // Build line-numbered version by splitting Shiki's output into lines.
  // Shiki wraps each token in <span>; the outer <pre><code> contains one
  // line per logical source line (separated by \n in the token stream).
  // We post-process to wrap each line in a <span class="cave-line"> for
  // gutter rendering.
  const lineWrapped = highlighted.replace(
    /(<pre[^>]*>)([\s\S]*)(<\/pre>)/,
    (_match, open, inner, close) => {
      const codeInner = inner.replace(/(<code[^>]*>)([\s\S]*)(<\/code>)/, (_m2: string, co: string, codeContent: string, cc: string) => {
        const rawLines = codeContent.split("\n");
        // Remove trailing empty line Shiki adds
        if (rawLines[rawLines.length - 1] === "") rawLines.pop();
        const wrappedLines = rawLines.map((line: string, i: number) => {
          // CHAT-D8-03: `+++ b/file` / `--- a/file` headers are metadata, not
          // additions/deletions — exclude them from the +/- gutter strips and
          // mute `@@` hunk headers instead of leaving them content-colored.
          const plainLine = plainTextFromHtmlLine(line);
          const gutterClass = isDiff
            ? /^@@/.test(plainLine)
              ? " cave-diff-meta"
              : /^(\+\+\+ |--- )/.test(plainLine)
              ? ""
              : line.includes('<span class="shiki-diff add"') || /^\+/.test(plainLine)
              ? " cave-diff-add"
              : /^-/.test(plainLine)
              ? " cave-diff-del"
              : ""
            : "";
          const lineNum = showLineNums
            ? `<span class="cave-ln" aria-hidden="true">${i + 1}</span>`
            : "";
          // data-line lets surfaces (e.g. the Projects search) scroll a code
          // block to a specific 1-based line. Harmless to chat code blocks.
          return `<span class="cave-line${gutterClass}" data-line="${i + 1}">${lineNum}${line}</span>`;
        });
        return `${co}${wrappedLines.join("")}${cc}`;
      });
      return `${open}${codeInner}${close}`;
    },
  );

  const labelHtml = `<span class="cave-code-lang">${escHtml(lang)}</span>`;
  const filenameHtml = filename
    ? `<span class="cave-code-filename" title="${escHtml(filename)}">${escHtml(filename)}</span>`
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
  const headerHtml = `<div class="cave-code-header">${collapseBtn}${labelHtml}${filenameHtml}${linesHtml}<button type="button" class="cave-copy-btn cave-copy-btn-mounted">Copy</button></div>`;
  const expandHtml = lines.length >= CODE_EXPAND_MIN_LINES
    ? `<div class="cave-code-expand"><button type="button" class="cave-code-expand-btn">Show more</button></div>`
    : "";

  return `<div class="cave-code-wrap">${headerHtml}${lineWrapped}${expandHtml}</div>`;
}

/**
 * Highlight a snippet to a *bare* Shiki `<pre class="shiki">…</pre>` — no
 * cave-code-wrap header, copy button, or line gutters. For surfaces that
 * already supply their own chrome (e.g. the in-chat Canvas artifact viewer,
 * which has its own header + actions) and just want colored code. Reuses the
 * same lazy singleton as the chat code blocks, so no extra Shiki/WASM load.
 */
export async function highlightToHtml(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, { lang: resolveShikiLang(lang), theme: "mood-c-dark" });
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
      <pre className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] ${className ?? ""}`}>
        {text}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`cave-syntax-block text-[12px] ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}


// ---------------------------------------------------------------------------
// Public: MarkdownBlock — renders full markdown (prose + code) via @create-markdown/preview
// ---------------------------------------------------------------------------

export function MarkdownBlock({ text, className }: { text: string; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useWireCopyButtons(html);

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
      <pre className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] ${className ?? ""}`}>
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

/**
 * renderCache LRU — keyed by the FULL markdown string. Capped (CHAT-D3-03):
 * an unbounded Map keyed by entire messages grows for the whole session.
 * Map iteration order is insertion order, so refreshing recency on get and
 * evicting the first key on overflow gives a small LRU for free.
 */
const RENDER_CACHE_MAX = 200;
const renderCache = new Map<string, string>();

function renderCacheGet(key: string): string | undefined {
  const value = renderCache.get(key);
  if (value !== undefined) {
    renderCache.delete(key);
    renderCache.set(key, value);
  }
  return value;
}

function renderCacheSet(key: string, value: string) {
  if (renderCache.has(key)) renderCache.delete(key);
  renderCache.set(key, value);
  if (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
}

/** Streaming markdown re-renders at most once per this many ms (trailing). */
const STREAM_RENDER_INTERVAL_MS = 200;

/**
 * Mid-stream nicety: if the accumulated text ends inside an unterminated
 * code fence, close it before rendering so the partial block highlights as
 * code instead of pulling the rest of the snapshot into a runaway open
 * block. Only applied to transient streaming snapshots — the final settled
 * render gets the text verbatim.
 */
function closeTrailingFence(markdown: string): string {
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
  }
  return inFence ? `${markdown}\n\`\`\`` : markdown;
}

/**
 * Scan markdown for fence openers in order, returning the filename suffix for
 * each (or null when the fence had no `:filename`). Used to re-attach filename
 * labels after we strip them so @create-markdown/core can parse the fence.
 */
function scanFenceFilenames(markdown: string): Array<string | null> {
  const filenames: Array<string | null> = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (!/^\s*```/.test(line)) continue;
    if (inFence) {
      inFence = false;
      continue;
    }
    const m = /^\s*```\s*[\w+.-]*(?::(\S+))?\s*$/.exec(line);
    filenames.push(m?.[1] ?? null);
    inFence = true;
  }
  return filenames;
}

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
async function getMermaidPlugin(): Promise<PreviewPlugin | null> {
  if (!mermaidPluginPromise) {
    mermaidPluginPromise = import("@create-markdown/preview-mermaid")
      .then(async ({ mermaidPlugin }) => {
        // theme "dark" matches the Cave UI; securityLevel "strict" overrides the
        // plugin's default "loose" so diagrams from untrusted chat content can't
        // smuggle scripts/click handlers (postProcess output bypasses our sanitizer).
        const plugin = mermaidPlugin({
          theme: "dark",
          config: { securityLevel: "strict", suppressErrorRendering: true },
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

async function mdToHtml(markdown: string, opts?: { transient?: boolean }): Promise<string> {
  const cached = renderCacheGet(markdown);
  if (cached !== undefined) return cached;

  const { renderAsync } = await import("@create-markdown/preview");

  // @create-markdown/core's fenced-code parser rejects any info string that
  // contains a colon (e.g. ```ts:example.ts), treating the opener as a
  // paragraph and then mis-reading the closing ``` as a new opener — which
  // cascades and swallows the rest of the message as a fake code block.
  // Pre-scan filenames (positional, one per fence opener) so we can re-attach
  // them after stripping the suffix for the parser.
  const fenceFilenames = scanFenceFilenames(markdown);
  const normalized = markdown.replace(/^(\s*```\s*[\w+.-]+):\S+/gm, "$1");

  const blocks: Block[] = coalesceAdjacentNumberedLists(parse(normalized));

  // Precompute each async code renderer result. Index-keyed (not pushed)
  // so codeReplacements[i] corresponds to the i-th code block in parse order
  // regardless of Promise.all resolution order.
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
  // Only render diagrams on settled (non-transient) snapshots — mid-stream the
  // fence is usually incomplete, so the mermaid source shows as a code block
  // until the message finishes, then swaps to the rendered diagram.
  const mermaidPlugin =
    !opts?.transient && codeBlocks.some(isMermaidCodeBlock) ? await getMermaidPlugin() : null;
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
      codeReplacements[i] = await renderCodeBlock(code, info);
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
  // Transient (mid-stream) snapshots are never requested again once the
  // stream advances past them — caching one per throttle tick would churn
  // settled entries out of the LRU for no hit-rate gain.
  if (!opts?.transient) renderCacheSet(markdown, sanitizedHtml);
  return sanitizedHtml;
}

// ---------------------------------------------------------------------------
// Post-render: wire copy + expand buttons in DOM
// ---------------------------------------------------------------------------

/**
 * Click-time code extraction (CHAT-D7-04). The block's full source used to be
 * duplicated into a `data-code` attribute on every Copy button — double the
 * memory and a giant DOM attribute for big tool outputs / file previews (the
 * SyntaxBlock path). Instead, read the text back out of the rendered block:
 * line rows are `.cave-line` spans with no newline text nodes between them,
 * so reconstruct with join("\n"); `.cave-ln` line-number spans are
 * presentation-only (aria-hidden, user-select: none) and must be excluded —
 * textContent WOULD include them, hence the clone-and-strip. Diff +/- line
 * prefixes are real token text and copy as-is, matching the old behavior of
 * copying the raw fence content. Byte-parity with the old data-code path was
 * verified for plain, line-numbered, diff, entity-heavy, empty-interior-line
 * and trailing-newline blocks.
 */
function codeTextFromWrap(btn: HTMLElement): string {
  const codeEl = btn.closest(".cave-code-wrap")?.querySelector("pre code");
  if (!codeEl) return "";
  const lineEls = Array.from(codeEl.querySelectorAll(".cave-line"));
  // Shiki-failure fallback renders a plain <pre><code> without line rows.
  if (lineEls.length === 0) return codeEl.textContent ?? "";
  return lineEls
    .map((line) => {
      const clone = line.cloneNode(true) as HTMLElement;
      for (const ln of Array.from(clone.querySelectorAll(".cave-ln"))) ln.remove();
      return clone.textContent ?? "";
    })
    .join("\n");
}

function wireCopyButtons(container: HTMLElement) {
  // Only the injected-HTML header buttons (.cave-copy-btn-mounted) need
  // wiring — the React-rendered bubble copy/expand buttons carry their own
  // onClick handlers and props.
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-copy-btn-mounted"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener("click", () => {
      void copyText(codeTextFromWrap(btn)).then((ok) => {
        if (!ok) return;
        btn.textContent = "Copied";
        btn.classList.add("cave-copy-btn--confirmed");
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("cave-copy-btn--confirmed");
        }, 2000);
      });
    });
  }
  // Collapse toggle: fold the whole block down to its header (and back).
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-code-collapse-btn"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".cave-code-wrap");
      if (!wrap) return;
      toggleCodeBlockCollapse(wrap, btn);
    });
  }
  // Show more / Show less footer on height-clamped blocks (CHAT-D7-03).
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-code-expand-btn"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".cave-code-wrap");
      if (!wrap) return;
      const expanded = wrap.classList.toggle("cave-code-wrap--expanded");
      btn.textContent = expanded ? "Show less" : "Show more";
      // Collapsing from deep in a long block would otherwise leave the
      // clamped viewport scrolled to an arbitrary middle.
      if (!expanded) wrap.scrollTop = 0;
    });
  }
}

function wireMarkdownLinks(container: HTMLElement, onOpenUrl?: (url: string) => void) {
  if (!onOpenUrl) return;
  for (const link of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if ((link as HTMLAnchorElement & { _caveLinkWired?: boolean })._caveLinkWired) continue;
    const href = link.href;
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    (link as HTMLAnchorElement & { _caveLinkWired?: boolean })._caveLinkWired = true;
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onOpenUrl(href);
    });
  }
}

// Inline file references in prose (e.g. `src/foo.ts` or `lib/bar.py:42`) become
// clickable, opening the file in the Code workspace. Match logic lives in
// @/lib/file-ref (pure + unit-tested); only inline code is considered.
function wireFilePathLinks(container: HTMLElement) {
  for (const code of Array.from(container.querySelectorAll<HTMLElement>("code"))) {
    // Inline code only — never the highlighted lines inside a fenced block.
    if (code.closest("pre") || code.closest(".cave-code-wrap")) continue;
    const flagged = code as HTMLElement & { _caveFileLink?: boolean };
    if (flagged._caveFileLink) continue;
    const ref = parseFileRef(code.textContent ?? "");
    if (!ref) continue;
    flagged._caveFileLink = true;
    const { path, line } = ref;
    code.classList.add("cave-file-link");
    code.setAttribute("role", "button");
    code.setAttribute("tabindex", "0");
    code.title = `Open ${path}${line ? `:${line}` : ""} in the Code workspace`;
    const open = () =>
      window.dispatchEvent(new CustomEvent("cave:open-project-file", { detail: { path, line } }));
    code.addEventListener("click", open);
    code.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }
}

// Wide markdown tables are cramped in the narrow chat column. Each rendered
// table (mdToHtml wraps every one in `.cave-table-scroll`) gets an "Expand"
// affordance that opens it full-size in a dismissable lightbox so it can be
// read comfortably. Wired imperatively because the markdown HTML is injected
// via dangerouslySetInnerHTML; idempotent per table via the `_caveTableWired`
// flag, like the copy/link wiring above.
function wireExpandableTables(container: HTMLElement) {
  for (const scroll of Array.from(container.querySelectorAll<HTMLElement>(".cave-table-scroll"))) {
    const flagged = scroll as HTMLElement & { _caveTableWired?: boolean };
    if (flagged._caveTableWired) continue;
    if (!scroll.querySelector("table")) continue;
    // Flag BEFORE moving the node so the wrapper insertion's own mutation
    // observer pass skips it instead of double-wrapping.
    flagged._caveTableWired = true;

    const wrap = document.createElement("div");
    wrap.className = "cave-table-block";
    scroll.parentNode?.insertBefore(wrap, scroll);
    wrap.appendChild(scroll);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cave-table-expand-btn";
    btn.title = "Expand table";
    btn.setAttribute("aria-label", "Expand table");
    btn.innerHTML = '<span class="cave-table-expand-glyph" aria-hidden="true">⤢</span> Expand';
    btn.addEventListener("click", () => openTableLightbox(scroll));
    wrap.appendChild(btn);
  }
}

function openTableLightbox(scroll: HTMLElement) {
  const table = scroll.querySelector("table");
  if (!table) return;

  const overlay = document.createElement("div");
  overlay.className = "cave-table-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Expanded table");

  const panel = document.createElement("div");
  panel.className = "cave-table-lightbox__panel";

  const bar = document.createElement("div");
  bar.className = "cave-table-lightbox__bar";
  const title = document.createElement("span");
  title.className = "cave-table-lightbox__title";
  title.textContent = "Table";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cave-table-lightbox__close focus-ring";
  close.textContent = "Close";
  bar.append(title, close);

  // cave-md scopes the table styling; the clone is detached from its turn so
  // it carries no live listeners — purely a readable, scrollable copy.
  const body = document.createElement("div");
  body.className = "cave-table-lightbox__body cave-md";
  body.appendChild(table.cloneNode(true));

  panel.append(bar, body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const dismiss = () => {
    document.body.style.overflow = prevOverflow;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      dismiss();
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });
  close.addEventListener("click", dismiss);
  document.addEventListener("keydown", onKey);
  close.focus();
}

/**
 * Shared post-render hook: wires `.cave-copy-btn` clicks inside the container
 * whenever the injected HTML changes. Every component that injects
 * renderCodeBlock/mdToHtml output via dangerouslySetInnerHTML must attach the
 * returned ref, otherwise its Copy buttons render but silently do nothing
 * (wireCopyButtons is idempotent per button via the `_wired` flag).
 *
 * `linkifyPaths` opts inline file references in prose into clickable
 * Code-workspace links; only the chat prose path enables it.
 */
function useWireCopyButtons(html: string | null, onOpenUrl?: (url: string) => void, linkifyPaths = false) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!html || !el) return;
    const wireAll = () => {
      wireCopyButtons(el);
      wireMarkdownLinks(el, onOpenUrl);
      wireMermaidDiagrams(el);
      wireExpandableTables(el);
      if (linkifyPaths) wireFilePathLinks(el);
    };
    wireAll();
    // Re-wire when nodes are added after the first pass. Components that render
    // once (e.g. the comux file/markdown preview's MarkdownBlock/SyntaxBlock,
    // vs the chat's repeatedly-re-rendering MarkdownContent) could otherwise
    // leave a code block's Copy/collapse/expand buttons unwired if the
    // highlighter populated them after this effect ran. All wiring is
    // idempotent (guarded per element), and the wiring itself only touches
    // attributes/listeners — not childList — so it never re-triggers the
    // observer into a loop.
    const observer = new MutationObserver(() => wireAll());
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [html, onOpenUrl, linkifyPaths]);
  return containerRef;
}

// ---------------------------------------------------------------------------
// MarkdownContent — progressive async render while streaming (CHAT-D3-01);
// plain fallback only until the first render lands
// ---------------------------------------------------------------------------

function MarkdownContent({ text, pending, onOpenUrl }: { text: string; pending?: boolean; onOpenUrl?: (url: string) => void }) {
  const [html, setHtml] = useState<string | null>(null);
  // linkifyPaths=true: chat prose file references (`src/foo.ts:42`) open in Code.
  const containerRef = useWireCopyButtons(html, onOpenUrl, true);
  // Out-of-order guard: mdToHtml is async and during streaming several
  // renders can be in flight at once. Every render takes a monotonically
  // increasing stamp, and a result only commits if it is newer than the
  // last committed one — a slower earlier render never overwrites a newer
  // one (including the final settled render).
  const renderStampRef = useRef(0);
  const appliedStampRef = useRef(0);
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
      const run = () => {
        lastStreamRenderRef.current = Date.now();
        const stamp = ++renderStampRef.current;
        mdToHtml(closeTrailingFence(text), { transient: true })
          .then((h) => {
            if (stamp <= appliedStampRef.current) return; // stale out-of-order render
            appliedStampRef.current = stamp;
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

    // Settled (`pending` → false): final immediate render on the verbatim
    // text, keeping the original async-cancellation discipline — once the
    // turn is done there is no starvation risk, and cancellation keeps a
    // stale effect run from committing.
    let cancelled = false;
    const stamp = ++renderStampRef.current;
    mdToHtml(text)
      .then((h) => {
        if (cancelled) return;
        if (stamp <= appliedStampRef.current) return; // stale out-of-order render
        appliedStampRef.current = stamp;
        setHtml(h);
      })
      .catch((err) => { console.error("[MarkdownContent] mdToHtml failed", err); });
    return () => { cancelled = true; };
  }, [text, pending]);

  if (!html) {
    return (
      <span className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
        {text}
        {pending && text ? (
          <span aria-hidden className="ml-1 inline-block animate-pulse text-[var(--text-secondary)]">▌</span>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="cave-md"
        // Markdown output is sanitized in mdToHtml before DOM insertion.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {/* Streaming cursor as a SIBLING of the markdown container — never
          injected into the sanitized HTML string. */}
      {pending ? (
        <span aria-hidden="true" className="ml-1 inline-block animate-pulse text-[var(--text-secondary)]">▌</span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// CopyButton — hover "Copy message" (raw markdown source)
// ---------------------------------------------------------------------------

function CopyBubble({ text }: { text: string }) {
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
      className={`cave-copy-btn cave-copy-btn-bubble${copied ? " cave-copy-btn--confirmed" : ""}`}
    >
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
   *  text span streams (progressive markdown + ▌ cursor); earlier spans
   *  render settled. */
  segments?: MessageBubbleSegment[];
  /** Branching: when a turn has siblings, render a compact ‹ index/total ›
   *  switcher. Omitted (or total <= 1) hides it. */
  branchNav?: {
    index: number; // 0-based
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
};

export function MessageBubble({ role, content, timestamp, showTimestamp = true, pending, isError, label, onEdit, onRegenerate, onReply, onOpenUrl, messageId, feedbackContext, segments, branchNav }: MessageBubbleProps) {
  const [tsVisible, setTsVisible] = useState(false);
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

  const shouldShowTs = showTimestamp || tsVisible;

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
          <MarkdownContent text={content} pending={pending} onOpenUrl={onOpenUrl} />
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
  // so they take MarkdownContent's settled path (cached render, no throttle,
  // no cursor) and the ▌ cursor shows on at most one span.
  const lastTextIdx = segments
    ? segments.reduce((acc, seg, i) => (seg.kind === "text" ? i : acc), -1)
    : -1;
  return (
    <div
      className="group relative cave-bubble-assistant"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={isError ? "text-[var(--color-warning)]" : ""}>
        {segments?.length ? (
          segments.map((seg, i) =>
            seg.kind === "text" ? (
              <MarkdownContent key={`span-${i}`} text={seg.text} pending={pending && i === lastTextIdx} onOpenUrl={onOpenUrl} />
            ) : (
              <div key={seg.key} className="my-2">{seg.node}</div>
            ),
          )
        ) : (
          <MarkdownContent text={content} pending={pending} onOpenUrl={onOpenUrl} />
        )}
      </div>
      {/* Always in the DOM (CHAT-D6-04) — visibility is CSS-gated so the
          actions are reachable by keyboard (Tab), screen readers, and touch. */}
      {!pending && content ? (
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
          {onRegenerate ? (
            <button
              type="button"
              aria-label="Regenerate response"
              title="Regenerate"
              onClick={onRegenerate}
              className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
            >
              <Icon name="ph:arrow-clockwise" width={11} aria-hidden />
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
          <ExpandBubble text={content} label={label ?? "Familiar response"} />
          <CopyBubble text={content} />
          {messageId ? (
            <>
              <button
                type="button"
                aria-label="Good response"
                aria-pressed={vote === "up"}
                onClick={() => applyVote("up")}
                className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
              >
                <Icon name="ph:thumbs-up" width={13} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Bad response"
                aria-pressed={vote === "down"}
                onClick={() => applyVote("down")}
                className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
              >
                <Icon name="ph:thumbs-down" width={13} aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className={`cave-bubble-timestamp${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
        {fmtBubbleTime(timestamp)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExpandBubble — opens the message in a full-width markdown reading view
// ---------------------------------------------------------------------------

function ExpandBubble({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Expand message"
        title="Expand"
        onClick={() => setOpen(true)}
        className="cave-copy-btn cave-copy-btn-bubble cave-copy-btn--icon"
      >
        <Icon name="ph:arrows-out-simple" width={11} aria-hidden />
      </button>
      {open ? <MarkdownExpandModal text={text} label={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MarkdownExpandModal({
  text,
  label,
  onClose,
}: {
  text: string;
  label: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // CHAT-D11-02: shared focus trap — focuses the first control on open,
  // cycles Tab/Shift+Tab inside the dialog, closes on Escape, and restores
  // focus to the Expand trigger on close. Always active: this component only
  // mounts while the modal is open.
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copy = useCallback(async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  // Portal to <body>: the chat transcript lives under `.cave-mode-fade` (which
  // sets `transform`) and `.cave-linear-turn` (`content-visibility: auto`), and
  // both establish a containing block for `position: fixed`. Rendered inline the
  // overlay is clamped to the message's turn box instead of the viewport, so the
  // "Expand" reading view never actually goes full-screen (it sits in a small
  // box with a huge empty area beside/below it). Portaling escapes those
  // ancestors so `inset-0` resolves to the real viewport. See ui/modal.tsx.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="relative flex h-[90vh] w-[92vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Expanded ${label}`}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2.5">
          <Icon name="ph:arrows-out-simple" width={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <span className="flex-1 truncate text-[12px] text-[var(--text-secondary)]">{label}</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:copy" width={11} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            aria-label="Close expanded view"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[820px]">
            <MarkdownBlock text={text} className="cave-md--expanded" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
