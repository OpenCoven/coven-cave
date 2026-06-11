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
 * API path: shiki `createHighlighter` → custom mood-c-dark theme JSON,
 * then renderAsync(parse(md), { plugins: [shikiPlugin()] }) from
 * @create-markdown/preview.  The shikiPlugin uses its own createHighlighter
 * internally; we pass `theme: "mood-c-dark"` which we register on the
 * same highlighter instance via a loader shim.
 *
 * Because shikiPlugin's internal highlighter can't accept custom theme
 * objects via options alone, we use shiki's `codeToHtml` directly for
 * fenced code blocks and fall back to renderAsync (without the shiki
 * plugin) for the prose/structure, then post-process to inject highlighted
 * code where Shiki returned null.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { parse } from "@create-markdown/core";
import type { Block } from "@create-markdown/core";
import type { Highlighter } from "shiki";
import moodCTheme from "@/styles/shiki/mood-c-dark.json";
import { Icon } from "@/lib/icon";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { useFocusTrap } from "@/lib/use-focus-trap";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGS = [
  "typescript","tsx","javascript","jsx","rust","swift","python","go",
  "ruby","bash","shell","json","yaml","toml","sql","html","css","scss",
  "markdown","diff","dockerfile","graphql","lua","c","cpp","java",
  "kotlin","php","scala","zig","elixir","erlang","haskell","ocaml",
  "clojure","fsharp","r","dart","vue","svelte","text",
] as const;

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

async function renderCodeBlock(
  code: string,
  info: string,
): Promise<string> {
  const { lang, filename } = parseFenceInfo(info);

  let highlighted: string;
  try {
    const hl = await getHighlighter();
    highlighted = hl.codeToHtml(code, {
      lang: LANGS.includes(lang as (typeof LANGS)[number]) ? lang : "text",
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
          const plainLine = line.replace(/<[^>]+>/g, "");
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
          return `<span class="cave-line${gutterClass}">${lineNum}${line}</span>`;
        });
        return `${co}${wrappedLines.join("")}${cc}`;
      });
      return `${open}${codeInner}${close}`;
    },
  );

  const labelHtml = `<span class="cave-code-lang">${escHtml(lang)}</span>`;
  const filenameHtml = filename
    ? `<span class="cave-code-filename">${escHtml(filename)}</span>`
    : "";
  const headerHtml = `<div class="cave-code-header">${labelHtml}${filenameHtml}<button type="button" class="cave-copy-btn cave-copy-btn-mounted" data-code="${escAttr(code)}">Copy</button></div>`;

  return `<div class="cave-code-wrap">${headerHtml}${lineWrapped}</div>`;
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
};

/**
 * Drop-in replacement for `<pre>` in tool I/O blocks, comux output, and
 * inspector pane. Uses the same Shiki singleton as MessageBubble, so the
 * highlighter is only initialised once per session.
 */
export function SyntaxBlock({ text, lang, className }: SyntaxBlockProps) {
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
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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

async function mdToHtml(markdown: string, opts?: { transient?: boolean }): Promise<string> {
  const cached = renderCacheGet(markdown);
  if (cached !== undefined) return cached;

  // We render ourselves: use @create-markdown/core to parse, then manually
  // serialize to HTML so we can inject our custom Shiki code blocks.
  const { renderAsync } = await import("@create-markdown/preview");

  // @create-markdown/core's fenced-code parser rejects any info string that
  // contains a colon (e.g. ```ts:example.ts), treating the opener as a
  // paragraph and then mis-reading the closing ``` as a new opener — which
  // cascades and swallows the rest of the message as a fake code block.
  // Pre-scan filenames (positional, one per fence opener) so we can re-attach
  // them after stripping the suffix for the parser.
  const fenceFilenames = scanFenceFilenames(markdown);
  const normalized = markdown.replace(/^(\s*```\s*[\w+.-]+):\S+/gm, "$1");

  const blocks: Block[] = parse(normalized);

  // First pass: renderAsync without shiki (gives us structural HTML fast)
  const proseHtml = await renderAsync(blocks);

  // Second pass: render each code block with Shiki. Index-keyed (not pushed)
  // so codeReplacements[i] corresponds to the i-th code block in parse order
  // regardless of Promise.all resolution order.
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
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
      const rawInfo = cb.props.info ?? cb.props.language ?? "";
      const filename = fenceFilenames[i] ?? null;
      const info = filename ? `${rawInfo}:${filename}` : rawInfo;
      codeReplacements[i] = await renderCodeBlock(code, info);
    }),
  );

  // renderAsync wraps each code block in <pre>...</pre>. Walk the prose HTML
  // and substitute the N-th <pre> with the N-th replacement positionally.
  // Content-matching with a lazy regex (the previous approach) misfires when
  // multiple code blocks exist: the regex anchors on the FIRST <pre> and the
  // lazy quantifier extends across block boundaries to find the placeholder
  // text, replacing across two blocks and nesting one inside the other.
  const preRe = /<pre[^>]*>[\s\S]*?<\/pre>/g;
  let html = "";
  let lastIdx = 0;
  let replaceIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = preRe.exec(proseHtml)) !== null) {
    html += proseHtml.slice(lastIdx, match.index);
    html += codeReplacements[replaceIdx] ?? match[0];
    lastIdx = preRe.lastIndex;
    replaceIdx += 1;
  }
  html += proseHtml.slice(lastIdx);

  // Same positional substitution for tables: the i-th rendered <table> in the
  // prose corresponds to the i-th table block in parse order.
  const tableBlocks = blocks.filter((b): b is Block & TableBlock => b.type === "table");
  if (tableBlocks.length > 0) {
    const tableReplacements = await Promise.all(
      tableBlocks.map((block) => renderTableBlock(block, renderAsync)),
    );
    const tableRe = /<table[^>]*>[\s\S]*?<\/table>/g;
    let tableHtml = "";
    let tableLastIdx = 0;
    let tableIdx = 0;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableRe.exec(html)) !== null) {
      tableHtml += html.slice(tableLastIdx, tableMatch.index);
      tableHtml += tableReplacements[tableIdx] ?? tableMatch[0];
      tableLastIdx = tableRe.lastIndex;
      tableIdx += 1;
    }
    tableHtml += html.slice(tableLastIdx);
    html = tableHtml;
  }

  const sanitizedHtml = sanitizeHtml(html);
  // Transient (mid-stream) snapshots are never requested again once the
  // stream advances past them — caching one per throttle tick would churn
  // settled entries out of the LRU for no hit-rate gain.
  if (!opts?.transient) renderCacheSet(markdown, sanitizedHtml);
  return sanitizedHtml;
}

// ---------------------------------------------------------------------------
// Post-render: wire copy buttons in DOM
// ---------------------------------------------------------------------------

function wireCopyButtons(container: HTMLElement) {
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".cave-copy-btn[data-code]"))) {
    if ((btn as HTMLButtonElement & { _wired?: boolean })._wired) continue;
    (btn as HTMLButtonElement & { _wired?: boolean })._wired = true;
    const code = btn.dataset.code ?? "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code).catch(() => undefined);
      btn.textContent = "Copied";
      btn.classList.add("cave-copy-btn--confirmed");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("cave-copy-btn--confirmed");
      }, 2000);
    });
  }
}

/**
 * Shared post-render hook: wires `.cave-copy-btn` clicks inside the container
 * whenever the injected HTML changes. Every component that injects
 * renderCodeBlock/mdToHtml output via dangerouslySetInnerHTML must attach the
 * returned ref, otherwise its Copy buttons render but silently do nothing
 * (wireCopyButtons is idempotent per button via the `_wired` flag).
 */
function useWireCopyButtons(html: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (html && containerRef.current) wireCopyButtons(containerRef.current);
  }, [html]);
  return containerRef;
}

// ---------------------------------------------------------------------------
// MarkdownContent — progressive async render while streaming (CHAT-D3-01);
// plain fallback only until the first render lands
// ---------------------------------------------------------------------------

function MarkdownContent({ text, pending }: { text: string; pending?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useWireCopyButtons(html);
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
          <span className="ml-1 inline-block animate-pulse text-[var(--text-secondary)]">▌</span>
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
    await navigator.clipboard.writeText(text).catch(() => undefined);
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
};

export function MessageBubble({ role, content, timestamp, showTimestamp = true, pending, isError, label, onEdit, onRegenerate }: MessageBubbleProps) {
  const [tsVisible, setTsVisible] = useState(false);
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
        <div className="relative cave-bubble-user">
          <MarkdownContent text={content} pending={pending} />
          {/* Always in the DOM (CHAT-D6-04) — visibility is CSS-gated so the
              buttons are reachable by keyboard (Tab), screen readers, and touch. */}
          <div className="cave-bubble-actions">
            {!pending && onEdit ? (
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
            {!pending && <CopyBubble text={content} />}
          </div>
        </div>
        <div className={`cave-bubble-timestamp cave-bubble-timestamp--right${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
          {fmtBubbleTime(timestamp)}
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div
      className="group relative cave-bubble-assistant"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={isError ? "text-[var(--color-warning)]" : ""}>
        <MarkdownContent text={content} pending={pending} />
      </div>
      {/* Always in the DOM (CHAT-D6-04) — visibility is CSS-gated so the
          actions are reachable by keyboard (Tab), screen readers, and touch. */}
      {!pending && content ? (
        <div className="cave-bubble-actions">
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
          <ExpandBubble text={content} label={label ?? "Familiar response"} />
          <CopyBubble text={content} />
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
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Expanded ${label}`}
      tabIndex={-1}
    >
      <div
        className="relative flex h-[90vh] w-[92vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
