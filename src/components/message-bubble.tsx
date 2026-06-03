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
  const hl = await getHighlighter();

  let highlighted: string;
  try {
    highlighted = hl.codeToHtml(code, {
      lang: LANGS.includes(lang as (typeof LANGS)[number]) ? lang : "text",
      theme: "mood-c-dark",
    });
  } catch {
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
          const gutterClass = isDiff
            ? line.includes('<span class="shiki-diff add"') || /^\+/.test(line.replace(/<[^>]+>/g, ""))
              ? " cave-diff-add"
              : /^-/.test(line.replace(/<[^>]+>/g, ""))
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
      className={`cave-syntax-block text-[12px] ${className ?? ""}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// ---------------------------------------------------------------------------
// Render markdown to HTML (async, Shiki per code block)
// ---------------------------------------------------------------------------

const renderCache = new Map<string, string>();

async function mdToHtml(markdown: string): Promise<string> {
  if (renderCache.has(markdown)) return renderCache.get(markdown)!;

  // We render ourselves: use @create-markdown/core to parse, then manually
  // serialize to HTML so we can inject our custom Shiki code blocks.
  const { renderAsync } = await import("@create-markdown/preview");

  const blocks: Block[] = parse(markdown);

  // Render prose via renderAsync (no shiki plugin — we handle code blocks)
  // then swap in our Shiki-rendered code blocks.
  type CodeBlockEntry = { placeholder: string; html: string };
  const codeReplacements: CodeBlockEntry[] = [];

  // First pass: renderAsync without shiki (gives us structural HTML fast)
  const proseHtml = await renderAsync(blocks);

  // Second pass: render each code block with Shiki and substitute
  const codeBlocks = blocks.filter((b) => b.type === "codeBlock");
  await Promise.all(
    codeBlocks.map(async (block) => {
      // @create-markdown/core CodeBlock has .content (spans) and .props
      const cb = block as {
        type: "codeBlock";
        content: Array<{ text: string }>;
        props: { language?: string; info?: string };
      };
      const code = cb.content.map((s) => s.text).join("");
      const info = cb.props.info ?? cb.props.language ?? "";
      const shikiHtml = await renderCodeBlock(code, info);
      codeReplacements.push({ placeholder: code, html: shikiHtml });
    }),
  );

  // renderAsync wraps code blocks in <pre><code>...</code></pre>
  // Replace each <pre>...</pre> with our Shiki output.
  let html = proseHtml;
  for (const { placeholder, html: replacement } of codeReplacements) {
    // Match the pre/code block containing this code (escaped in HTML)
    const escaped = escHtml(placeholder);
    // Simple approach: replace first matching <pre>...<code>..placeholder..</code></pre>
    const re = new RegExp(
      `<pre[^>]*>[\\s\\S]*?<code[^>]*>${regEsc(escaped)}[\\s\\S]*?<\\/code>[\\s\\S]*?<\\/pre>`,
    );
    html = html.replace(re, replacement);
  }

  renderCache.set(markdown, html);
  return html;
}

function regEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// ---------------------------------------------------------------------------
// MarkdownContent — async render; plain fallback while streaming
// ---------------------------------------------------------------------------

function MarkdownContent({ text, pending }: { text: string; pending?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTextRef = useRef<string>("");

  useEffect(() => {
    if (pending) {
      // Don't block on async render while streaming
      setHtml(null);
      return;
    }
    if (!text || text === lastTextRef.current) return;
    lastTextRef.current = text;
    let cancelled = false;
    void mdToHtml(text).then((h) => {
      if (!cancelled) setHtml(h);
    });
    return () => { cancelled = true; };
  }, [text, pending]);

  useEffect(() => {
    if (html && containerRef.current) wireCopyButtons(containerRef.current);
  }, [html]);

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
    <div
      ref={containerRef}
      className="cave-md"
      // Content originates from our own Coven daemon — fully trusted.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
};

export function MessageBubble({ role, content, timestamp, showTimestamp = true, pending, isError, label }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [tsVisible, setTsVisible] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    setHovered(true);
    if (!showTimestamp) {
      hoverTimer.current = setTimeout(() => setTsVisible(true), 600);
    }
  };
  const handleMouseLeave = () => {
    setHovered(false);
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
        <div className="relative max-w-[80%] rounded-2xl bg-[var(--bg-raised)]/70 px-4 py-2.5">
          <MarkdownContent text={content} pending={pending} />
          {hovered && !pending && <CopyBubble text={content} />}
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
      className="group relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={isError ? "text-amber-200" : ""}>
        <MarkdownContent text={content} pending={pending} />
      </div>
      {hovered && !pending && content && <CopyBubble text={content} />}
      <div className={`cave-bubble-timestamp${shouldShowTs ? " cave-bubble-timestamp--visible" : ""}`}>
        {fmtBubbleTime(timestamp)}
      </div>
    </div>
  );
}
