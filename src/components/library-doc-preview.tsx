"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { parseLeadingMetadata, type MetaEntry } from "@/lib/library-metadata";
import { isSafeGitHubUrl, isSafeHttpUrl, isSafeVscodeFileUrl } from "@/lib/url-safety";
import { useTauriPlatform } from "@/lib/tauri-platform";
import type {
  LibraryDocBody,
  LibraryBookmark,
  LibraryReadingItem,
  LibraryGitHubItem,
  ReadingStatus,
  LibrarySectionKind,
} from "@/lib/library-types";
import type { Skill } from "@/components/library-collection-rail";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { formatDate, readDateTimePrefs } from "@/lib/datetime-format";

// ── Discriminated union ──────────────────────────────────────────
export type SelectedItem =
  | { kind: "doc"; doc: LibraryDocBody }
  | { kind: "bookmark"; item: LibraryBookmark }
  | { kind: "reading"; item: LibraryReadingItem }
  | { kind: "github"; item: LibraryGitHubItem }
  | { kind: "skill"; skill: Skill }
  | null;

export type DocNav = { index: number; total: number; onPrev: () => void; onNext: () => void };

type Props = { selected: SelectedItem; loading: boolean; activeSection?: LibrarySectionKind; docNav?: DocNav };

const EMPTY_TEXT: Record<LibrarySectionKind, string> = {
  all: "Select an item to preview",
  docs: "Select a doc to preview",
  bookmarks: "Select a bookmark to preview",
  reading: "Select a reading item to preview",
  github: "Select a GitHub item to preview",
  projects: "Select a project to preview",
  skills: "Select a skill to view",
};

// ── Helpers ──────────────────────────────────────────────────────
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  // Honors the user's date-order preference (month-first vs day-first). Reads
  // the persisted snapshot rather than the hook so the existing call sites in
  // the preview's sub-components stay unchanged; an already-open preview picks
  // up a pref change on its next render.
  return formatDate(iso, readDateTimePrefs(), { year: true }) || iso;
}

type UrlOpenKind = "web" | "github" | "vscode-file";
const SIDECAR_TOKEN_PARAM = "covenCaveToken";
const SIDECAR_STORAGE_KEY = "coven-cave:sidecar-auth-token";

function readSidecarAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SIDECAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function canOpenUrl(url: string, kind: UrlOpenKind): boolean {
  if (kind === "github") return isSafeGitHubUrl(url);
  if (kind === "vscode-file") return isSafeVscodeFileUrl(url);
  return isSafeHttpUrl(url);
}

async function openUrl(url: string, kind: UrlOpenKind = "web") {
  if (!canOpenUrl(url, kind)) return;
  // Use Tauri shell_open when running as desktop app
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open", { url });
      return;
    } catch {
      // fall through to window.open
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function CopyButton({ text, label, compact }: { text: string; label: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`library-preview-action-btn${compact ? " library-preview-action-btn--compact" : ""}`}
      onClick={() => {
        copyText(text)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? "ph:check" : "ph:copy"} width={compact ? 12 : 13} />
      <span>{copied ? "Copied!" : label}</span>
    </button>
  );
}

function OpenBtn({ url, label, kind = "web" }: { url: string; label?: string; kind?: UrlOpenKind }) {
  const safe = canOpenUrl(url, kind);
  return (
    <button type="button" className="library-preview-action-btn" disabled={!safe} title={safe ? undefined : "Unsafe URL blocked"} onClick={() => { void openUrl(url, kind); }}>
      <Icon name="ph:arrow-square-out" width={13} />
      <span>{label ?? "Open"}</span>
    </button>
  );
}

type TranslationSource =
  | { kind: "url"; title: string; url: string }
  | { kind: "text"; title: string; text: string }
  | { kind: "file"; title: string; path: string };

function translateTargetLang() {
  const raw = typeof navigator !== "undefined" ? navigator.language : "";
  return raw.split("-")[0]?.toLowerCase() || "en";
}

function googleTranslateUrl(url: string) {
  const translated = new URL("https://translate.google.com/translate");
  translated.searchParams.set("sl", "auto");
  translated.searchParams.set("tl", translateTargetLang());
  translated.searchParams.set("u", url);
  return translated.toString();
}

function buildTranslationPrompt(source: Extract<TranslationSource, { kind: "text" | "file" }>) {
  if (source.kind === "file") {
    return [
      `Translate this paper or document into ${translateTargetLang()}.`,
      `Title: ${source.title}`,
      `Local file: ${source.path}`,
      "",
      "Preserve technical terms, citations, headings, and lists.",
    ].join("\n");
  }
  const clipped = source.text.length > 24_000 ? `${source.text.slice(0, 24_000)}\n\n[truncated]` : source.text;
  return [
    `Translate this article or document into ${translateTargetLang()}.`,
    `Title: ${source.title}`,
    "",
    "Preserve technical terms, citations, headings, and lists.",
    "",
    clipped,
  ].join("\n");
}

function TranslateButton({
  source,
  compact,
  readerIcon,
}: {
  source: TranslationSource;
  compact?: boolean;
  readerIcon?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const label = copied ? "Prompt copied" : "Translate";

  const handleClick = () => {
    if (source.kind === "url") {
      void openUrl(googleTranslateUrl(source.url));
      return;
    }
    copyText(buildTranslationPrompt(source))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => undefined);
  };

  if (readerIcon) {
    return (
      <button
        type="button"
        className="library-reader-iconbtn"
        onClick={handleClick}
        title={label}
        aria-label={label}
      >
        <Icon name={copied ? "ph:check" : "ph:translate"} width={13} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`library-preview-action-btn${compact ? " library-preview-action-btn--compact" : ""}`}
      onClick={handleClick}
      title={label}
      aria-label={label}
    >
      <Icon name={copied ? "ph:check" : "ph:translate"} width={compact ? 12 : 13} />
      <span>{label}</span>
    </button>
  );
}

type TauriInvokeBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T = unknown>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
};

async function loadTauriInvoke(): Promise<TauriInvokeBridge | null> {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return { invoke, listen };
}

function safeViewerLabel(id: string, url: string): string {
  const seed = `${id}-${url}`;
  const safe = seed.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `library-link-${safe || "viewer"}`;
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function LibraryLinkViewer({
  id,
  title,
  url,
  meta,
  openKind = "web",
}: {
  id: string;
  title: string;
  url: string;
  meta: React.ReactNode;
  openKind?: UrlOpenKind;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [bridge, setBridge] = useState<TauriInvokeBridge | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const platform = useTauriPlatform();
  const nativeBrowserAvailable = platform === "desktop";
  const safe = canOpenUrl(url, openKind);
  const label = safeViewerLabel(id, url);
  const nativeLabel = `cave-browser-${label}`;

  useEffect(() => {
    if (platform === "unknown") return;
    if (!nativeBrowserAvailable) {
      setBridge(null);
      setUnavailable(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const nextBridge = await loadTauriInvoke();
      if (cancelled) return;
      if (nextBridge) setBridge(nextBridge);
      else setUnavailable(true);
    })();
    return () => { cancelled = true; };
  }, [nativeBrowserAvailable, platform]);

  useEffect(() => {
    if (!bridge || !nativeBrowserAvailable || !safe) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    let raf = 0;
    let created = false;

    const place = (navigate: boolean) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) {
          void bridge.invoke("browser_hide", { label });
          return;
        }
        const bounds = { label, x: rect.left, y: rect.top, w: rect.width, h: rect.height };
        if (navigate || !created) {
          created = true;
          void bridge.invoke("browser_navigate", {
            ...bounds,
            url,
            readOnlyUrl: url,
          });
          return;
        }
        void bridge.invoke("browser_set_bounds", bounds);
      });
    };

    const handleViewportChange = () => place(false);
    const timer = window.setTimeout(() => place(true), 80);
    const ro = new ResizeObserver(() => place(false));
    ro.observe(surface);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      void bridge.invoke("browser_close", { label });
    };
  }, [bridge, nativeBrowserAvailable, label, safe, url]);

  useEffect(() => {
    if (!bridge || !nativeBrowserAvailable || !safe) return;
    let unlisten: (() => void) | null = null;
    void bridge.listen<{ label: string; scrollY: number }>("browser:scroll", (event) => {
      const { label: eventLabel, scrollY } = event.payload;
      if (eventLabel !== nativeLabel) return;
      setHeaderCollapsed(scrollY > 24);
    }).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, [bridge, nativeBrowserAvailable, nativeLabel, safe]);

  return (
    <div className={`library-preview library-link-viewer${headerCollapsed ? " library-link-viewer--header-collapsed" : ""}`}>
      <div className="library-preview-header library-link-viewer-header">
        <div className="library-preview-title">{title || hostnameLabel(url)}</div>
        <div className="library-preview-meta">
          {meta}
          <span className="library-preview-sep">·</span>
          <span className="library-preview-date">{hostnameLabel(url)}</span>
          <span className="library-preview-sep">·</span>
          <span className="library-link-viewer-mode">viewer</span>
        </div>
        <div className="library-preview-actions">
          <TranslateButton source={{ kind: "url", title, url }} />
          <OpenBtn url={url} label={openKind === "github" ? "Open on GitHub" : "Open external"} kind={openKind} />
          <CopyButton text={url} label="Copy URL" />
        </div>
      </div>
      <div className="library-link-viewer-viewport">
        {!safe ? (
          <div className="library-preview library-preview--empty">
            <Icon name="ph:warning" width={32} className="library-preview-empty-icon" />
            <span className="library-preview-empty-text">Unsafe URL blocked.</span>
          </div>
        ) : unavailable ? (
          <iframe
            src={url}
            title={title || hostnameLabel(url)}
            className="library-link-viewer-frame"
            sandbox="allow-same-origin allow-scripts allow-forms"
          />
        ) : (
          <div ref={surfaceRef} className="library-link-viewer-surface" aria-label={title || url} />
        )}
      </div>
    </div>
  );
}

// ── Markdown rendering (lazy, same as MarkdownBlock) ──────────────
type MdFn = (md: string) => Promise<string>;
let mdFnCached: MdFn | null = null;
async function getMdFn(): Promise<MdFn> {
  if (mdFnCached) return mdFnCached;
  const { renderAsync } = await import("@create-markdown/preview");
  const { parse } = await import("@create-markdown/core");
  mdFnCached = async (markdown: string) => renderAsync(parse(markdown));
  return mdFnCached;
}

interface RenderedMarkdownProps {
  text: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

function RenderedMarkdown({ text, containerRef }: RenderedMarkdownProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const internalRef = useRef<HTMLDivElement | null>(null);
  const ref = containerRef ?? internalRef;

  useEffect(() => {
    if (!text) { setHtml(null); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    void (async () => {
      const fn = await getMdFn();
      const raw = await fn(text);
      if (cancelled) return;
      setHtml(sanitizeHtml(raw));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [text]);

  if (loading) return (
    <div className="library-md-skeleton">
      {["80%", "95%", "70%", "88%", "60%", "92%", "75%"].map((w, i) => (
        <div key={i} className="library-md-skeleton-line" style={{ width: w }} />
      ))}
    </div>
  );
  if (!html) return null;
  return <div ref={ref} className="cave-md library-preview-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── ToC panel ────────────────────────────────────────────────────
interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocPanelProps {
  items: TocItem[];
  activeId: string | null;
  mdRef: React.RefObject<HTMLDivElement | null>;
  readerMode?: boolean;
}

function TocPanel({ items, activeId, mdRef, readerMode = false }: TocPanelProps) {
  if (items.length < 3) return null;
  return (
    <nav
      className={["library-toc", readerMode ? "library-reader-toc" : ""].filter(Boolean).join(" ")}
      aria-label="Table of contents"
    >
      <div className="library-toc-title">On this page</div>
      <div className="library-toc-list">
        {items.map((item) => (
          <button
            key={item.id}
            className={[
              "library-toc-item",
              `library-toc-item--h${item.level}`,
              activeId === item.id ? "library-toc-item--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => {
              const el = mdRef.current?.querySelector(`#${CSS.escape(item.id)}`);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            title={item.text}
          >
            {item.text}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ── Detail cards ─────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="library-field-row">
      <div className="library-field-label">{label}</div>
      <div className="library-field-val">{children}</div>
    </div>
  );
}

function BookmarkDetail({ item }: { item: LibraryBookmark }) {
  return (
    <LibraryLinkViewer
      id={item.id}
      title={item.title}
      url={item.url}
      meta={<><span className="library-doclist-tag">{item.domain}</span><span className="library-preview-sep">·</span><span className="library-preview-date">{fmtDate(item.savedAt)}</span></>}
    />
  );
}

function statusStyle(status: ReadingStatus): React.CSSProperties {
  switch (status) {
    case "reading":       return { background: "color-mix(in oklch, var(--accent-presence) 14%, var(--bg-raised))", border: "1px solid color-mix(in oklch, var(--accent-presence) 30%, transparent)" };
    case "done":          return { background: "color-mix(in oklch, #34d399 14%, var(--bg-raised))", border: "1px solid color-mix(in oklch, #34d399 30%, transparent)" };
    case "abandoned":     return { background: "color-mix(in oklch, var(--color-danger) 10%, var(--bg-raised))", border: "1px solid color-mix(in oklch, var(--color-danger) 25%, transparent)" };
    case "want-to-read":  return { background: "var(--bg-raised)", border: "1px solid var(--border-strong)" };
    default:              return {};
  }
}

function ReadingDetail({ item }: { item: LibraryReadingItem }) {
  // If we have a local PDF, render the embedded viewer
  if (item.localPath && item.localPath.toLowerCase().endsWith(".pdf")) {
    return <PdfViewer localPath={item.localPath} title={item.title} />;
  }
  if (item.url) {
    return (
      <LibraryLinkViewer
        id={item.id}
        title={item.title}
        url={item.url}
        meta={<><span className="library-status-badge" style={statusStyle(item.status)}>{item.status.replace(/-/g, " ")}</span><span className="library-preview-sep">·</span><span className="library-doclist-tag">{item.sourceType}</span></>}
      />
    );
  }
  return (
    <div className="library-preview">
      <div className="library-preview-header">
        <div className="library-preview-title">{item.title}</div>
        <div className="library-preview-meta">
          <span className="library-status-badge" style={statusStyle(item.status)}>
            {item.status.replace(/-/g, " ")}
          </span>
          <span className="library-preview-sep">·</span>
          <span className="library-doclist-tag">{item.sourceType}</span>
          {item.author && <><span className="library-preview-sep">·</span><span className="library-preview-date">{item.author}</span></>}
        </div>
        {item.tags.length > 0 && (
          <div className="library-preview-tags">
            {item.tags.map((t: string) => <span key={t} className="library-doclist-tag">{t}</span>)}
          </div>
        )}
        <div className="library-preview-actions">
          {item.url && <OpenBtn url={item.url} />}
        </div>
      </div>
      <div className="library-preview-body">
        {item.status === "reading" && item.progress != null && (
          <FieldRow label="Progress">
            <div className="library-progress-bar library-progress-bar--lg">
              <div className="library-progress-fill" style={{ width: `${item.progress}%` }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{item.progress}%</div>
          </FieldRow>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <FieldRow label="Added">
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fmtDate(item.addedAt)}</div>
          </FieldRow>
          {item.finishedAt && (
            <FieldRow label="Finished">
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fmtDate(item.finishedAt)}</div>
            </FieldRow>
          )}
        </div>
        {item.notes && (
          <FieldRow label="Notes">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.notes}</div>
          </FieldRow>
        )}
      </div>
    </div>
  );
}

function GitHubDetail({ item }: { item: LibraryGitHubItem }) {
  const stateColor = item.state === "open" ? "var(--color-success)" : item.state === "merged" ? "var(--accent-presence)" : item.state === "closed" ? "var(--color-danger)" : "var(--text-muted)";
  return (
    <LibraryLinkViewer
      id={item.id}
      title={item.title}
      url={item.url}
      openKind="github"
      meta={<><span className="library-doclist-tag">{item.repo}</span><span className="library-preview-sep">·</span><span className="library-doclist-tag">{item.kind}</span>{item.number != null && <><span className="library-preview-sep">·</span><span className="library-preview-date">#{item.number}</span></>}{item.state && <><span className="library-preview-sep">·</span><span style={{ color: stateColor, fontSize: 12 }}>● {item.state}</span></>}</>}
    />
  );
}

/** Strip a leading markdown H1 that repeats the document title — the
 *  preview/reader headers already display it, so rendering the body's H1
 *  shows the title twice before any content. */
function stripLeadingTitleHeading(body: string, title: string): string {
  const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const m = lines[i]?.match(/^#\s+(.+?)\s*$/);
  if (!m || normalize(m[1]) !== normalize(title)) return body;
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

// ── Leading metadata block ───────────────────────────────────────
// Research notes from Sage open with a metadata paragraph — a run of
// `**Date:** … **Source:** … **Stars:** …` bold-label pairs written as the
// first body paragraph. `parseLeadingMetadata` (see lib/library-metadata)
// lifts it out of the markdown so we can render it as a collapsible
// key/value grid instead of an inline wrapped blob.
const META_OPEN_KEY = "cave:library:meta-open";

function MetadataBlock({ entries }: { entries: MetaEntry[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(window.localStorage.getItem(META_OPEN_KEY) === "true"); } catch { /* private mode */ }
  }, []);

  // Render each value's inline markdown (links, bold, etc.), stripping the
  // wrapping <p> the block renderer adds.
  const [vals, setVals] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fn = await getMdFn();
      const rendered = await Promise.all(entries.map((e) => fn(e.value)));
      if (cancelled) return;
      setVals(rendered.map((r) => sanitizeHtml(r).replace(/^\s*<p>/, "").replace(/<\/p>\s*$/, "").trim()));
    })();
    return () => { cancelled = true; };
  }, [entries]);

  const toggle = () => setOpen((o) => {
    const next = !o;
    try { window.localStorage.setItem(META_OPEN_KEY, String(next)); } catch { /* private mode */ }
    return next;
  });

  return (
    <details className="library-meta" open={open}>
      <summary
        className="library-meta-summary"
        onClick={(e) => { e.preventDefault(); toggle(); }}
      >
        <Icon name="ph:caret-right" width={12} className="library-meta-caret" />
        <span className="library-meta-title">Metadata</span>
        <span className="library-meta-count">{entries.length} fields</span>
      </summary>
      <dl className="library-meta-grid">
        {entries.map((e, idx) => (
          <div key={e.key} className="library-meta-row">
            <dt className="library-meta-key">{e.key}</dt>
            <dd
              className="library-meta-val"
              dangerouslySetInnerHTML={{ __html: vals?.[idx] ?? sanitizeHtml(e.value) }}
            />
          </div>
        ))}
      </dl>
    </details>
  );
}

const READER_FONT_KEY = "cave:library:reader-font";
const READER_FONT_SIZES = [15, 17, 19, 21];

function DocDetail({ doc, docNav }: { doc: LibraryDocBody; docNav?: DocNav }) {
  const [readerOpen, setReaderOpen] = useState(false);

  // Memoized so DocDetail's frequent re-renders (scroll-progress state) don't
  // hand MetadataBlock a fresh entries array each tick and re-run its markdown.
  const { leadingMeta, renderBody } = useMemo(() => {
    const bodyWithoutTitle = stripLeadingTitleHeading(doc.body, doc.title);
    const meta = parseLeadingMetadata(bodyWithoutTitle);
    return { leadingMeta: meta, renderBody: meta ? meta.rest : bodyWithoutTitle };
  }, [doc.body, doc.title]);

  // Reader font size — persisted, stepped through READER_FONT_SIZES.
  const [readerFont, setReaderFont] = useState(17);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(READER_FONT_KEY));
      if (READER_FONT_SIZES.includes(stored)) setReaderFont(stored);
    } catch { /* private mode */ }
  }, []);
  const stepReaderFont = (dir: 1 | -1) => {
    setReaderFont((current) => {
      const idx = READER_FONT_SIZES.indexOf(current);
      const next = READER_FONT_SIZES[Math.max(0, Math.min(READER_FONT_SIZES.length - 1, idx + dir))];
      try { window.localStorage.setItem(READER_FONT_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Reading time estimate
  const wordCount = doc.body.split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.ceil(wordCount / 200));

  // Scroll progress
  const [scrollPct, setScrollPct] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readerBodyRef = useRef<HTMLDivElement | null>(null);

  function handleScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScrollPct(max > 0 ? (el.scrollTop / max) * 100 : 0);
  }

  const readerDialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(readerOpen, readerDialogRef, { onEscape: () => setReaderOpen(false) });

  const [readerScrollPct, setReaderScrollPct] = useState(0);
  function handleReaderScroll() {
    const el = readerBodyRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setReaderScrollPct(max > 0 ? (el.scrollTop / max) * 100 : 0);
  }

  // ToC state
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const mdRef = useRef<HTMLDivElement | null>(null);

  const [readerTocItems, setReaderTocItems] = useState<TocItem[]>([]);
  const [activeReaderTocId, setActiveReaderTocId] = useState<string | null>(null);
  const readerMdRef = useRef<HTMLDivElement | null>(null);

  // Parse headings after body renders (main preview)
  useEffect(() => {
    if (!mdRef.current) return;
    const headings = Array.from(mdRef.current.querySelectorAll<HTMLElement>("h1,h2,h3")) as HTMLElement[];
    // Two headings with the same text would slug to the same id, producing
    // duplicate React keys and colliding DOM anchors (scroll/observer/copy-link
    // would all resolve to the first). Suffix repeats (-2, -3, …) to keep ids unique.
    const seen = new Map<string, number>();
    const items = headings.map((el) => {
      const text = el.textContent ?? "";
      const base = "toc-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      el.id = id;
      return { id, text, level: parseInt(el.tagName[1]) };
    });
    setTocItems(items);
  }, [doc.body]);

  // IntersectionObserver for active heading (main preview)
  useEffect(() => {
    if (!mdRef.current || tocItems.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const activeId = entry.target.id;
            setActiveTocId(activeId);
            // Sync aria-current on the active heading element.
            const headings = mdRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3") ?? [];
            for (const h of headings) {
              if (h.id === activeId) h.setAttribute("aria-current", "location");
              else h.removeAttribute("aria-current");
            }
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    for (const item of tocItems) {
      const el = mdRef.current.querySelector(`#${CSS.escape(item.id)}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [tocItems]);

  // Parse headings after body renders (reader mode)
  useEffect(() => {
    if (!readerOpen || !readerMdRef.current) return;
    const headings = Array.from(readerMdRef.current.querySelectorAll<HTMLElement>("h1,h2,h3")) as HTMLElement[];
    // Suffix duplicate-text headings (see main-preview note) so ids/anchors stay unique.
    const seen = new Map<string, number>();
    const items = headings.map((el) => {
      const text = el.textContent ?? "";
      const base = "reader-toc-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      el.id = id;
      // Hover copy-link anchor: copies <path>#<slug>. DOM-appended (same
      // idiom as the id/aria-current mutations above) so RenderedMarkdown
      // stays markdown-agnostic.
      if (!el.querySelector(".library-heading-anchor")) {
        const slug = id.replace(/^reader-toc-/, "");
        const anchor = document.createElement("button");
        anchor.type = "button";
        anchor.className = "library-heading-anchor";
        anchor.title = "Copy link to section";
        anchor.setAttribute("aria-label", `Copy link to section ${text}`);
        anchor.textContent = "⌗";
        anchor.addEventListener("click", () => {
          void copyText(`${doc.absolutePath ?? doc.id}#${slug}`);
          anchor.textContent = "✓";
          window.setTimeout(() => { anchor.textContent = "⌗"; }, 1200);
        });
        el.appendChild(anchor);
      }
      return { id, text, level: parseInt(el.tagName[1]) };
    });
    setReaderTocItems(items);
  }, [doc.body, readerOpen]);

  // IntersectionObserver for active heading (reader mode)
  useEffect(() => {
    if (!readerMdRef.current || readerTocItems.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const activeId = entry.target.id;
            setActiveReaderTocId(activeId);
            // Sync aria-current on the active heading element.
            const headings = readerMdRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3") ?? [];
            for (const h of headings) {
              if (h.id === activeId) h.setAttribute("aria-current", "location");
              else h.removeAttribute("aria-current");
            }
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );
    for (const item of readerTocItems) {
      const el = readerMdRef.current.querySelector(`#${CSS.escape(item.id)}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [readerTocItems]);

  // Close reader on Esc
  useEffect(() => {
    if (!readerOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setReaderOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [readerOpen]);

  // Keyboard heading navigation in reader mode: j/ArrowDown next, k/ArrowUp prev.
  useEffect(() => {
    if (!readerOpen) return;
    const reader = readerMdRef.current;
    if (!reader) return;

    function jumpToHeading(direction: 1 | -1) {
      if (readerTocItems.length === 0) return;
      const currentIdx = readerTocItems.findIndex((t) => t.id === activeReaderTocId);
      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = direction === 1 ? 0 : readerTocItems.length - 1;
      } else {
        nextIdx = Math.max(0, Math.min(readerTocItems.length - 1, currentIdx + direction));
      }
      if (nextIdx === currentIdx) return;
      const next = readerTocItems[nextIdx];
      const el = reader!.querySelector<HTMLElement>(`#${CSS.escape(next.id)}`);
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "auto" });
      setActiveReaderTocId(next.id);
      el.classList.add("library-heading--active");
      window.setTimeout(() => el.classList.remove("library-heading--active"), 800);
    }

    function onKey(e: KeyboardEvent) {
      // Don't steal keys from inputs / contentEditable.
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        jumpToHeading(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        jumpToHeading(-1);
      } else if (e.key === "ArrowLeft" && docNav && docNav.index > 0) {
        e.preventDefault();
        docNav.onPrev();
      } else if (e.key === "ArrowRight" && docNav && docNav.index < docNav.total - 1) {
        e.preventDefault();
        docNav.onNext();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerOpen, readerTocItems, activeReaderTocId, docNav]);

  const hasToc = tocItems.length >= 3;
  const hasReaderToc = readerTocItems.length >= 3;

  const header = (
    <div className="library-preview-header">
      <div className="library-preview-title">{doc.title}</div>
      <div className="library-preview-meta library-preview-meta--with-actions">
        <span className="library-preview-meta-left">
          <span className="library-preview-familiar"><Icon name="ph:robot" width={12} className="inline-block mr-1 text-[var(--text-muted)]" />Sage</span>
          <span className="library-preview-sep">·</span>
          <span className="library-preview-date">{fmtDate(doc.modifiedAt)}</span>
          <span className="library-preview-sep">·</span>
          <span className="library-reading-time"><Icon name="ph:clock" width={11} className="inline-block mr-1 text-[var(--text-muted)]" />~{readMins} min read</span>
          {doc.tags.length > 0 && (
            <><span className="library-preview-sep">·</span>
            <span className="library-preview-tags">
              {doc.tags.map((t: string) => <span key={t} className="library-doclist-tag">{t}</span>)}
            </span></>
          )}
        </span>
        <span className="library-preview-meta-actions">
          <TranslateButton source={{ kind: "text", title: doc.title, text: renderBody }} compact />
          <button
            type="button"
            className="library-preview-action-btn library-preview-action-btn--compact"
            title="Open in VS Code"
            onClick={() => { if (doc.absolutePath) void openUrl(`vscode://file${doc.absolutePath}`, "vscode-file"); }}
          >
            <Icon name="ph:code" width={12} />
            <span>Open</span>
          </button>
          <CopyButton
            text={`~/.openclaw/workspace/sage/${doc.id}`}
            label="Copy"
            compact
          />
          <button
            type="button"
            className="library-preview-action-btn library-preview-action-btn--compact"
            title="Reader mode"
            onClick={() => setReaderOpen((v) => !v)}
          >
            <Icon name="ph:book-open" width={12} />
            <span>Reader</span>
          </button>
        </span>
      </div>
      {Object.keys(doc.frontmatter).filter((k) => !["tags","tag"].includes(k)).length > 0 && (
        <div className="library-preview-frontmatter">
          {Object.entries(doc.frontmatter).filter(([k]) => !["tags","tag"].includes(k)).map(([k, v]) => (
            <span key={k} className="library-preview-fm-entry">
              <span className="library-preview-fm-key">{k}:</span>{" "}
              <span className="library-preview-fm-val">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );


  return (
    <>
      <div className="library-preview">
        {/* Scroll progress bar */}
        <div className="library-scroll-progress">
          <div className="library-scroll-progress-fill" style={{ width: `${scrollPct}%` }} />
        </div>
        {header}
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className={hasToc ? "library-preview-body library-preview-body--with-toc" : "library-preview-body"}
        >
          {leadingMeta && <MetadataBlock entries={leadingMeta.entries} />}
          <RenderedMarkdown text={renderBody} containerRef={mdRef} />
          {hasToc && (
            <TocPanel items={tocItems} activeId={activeTocId} mdRef={mdRef} />
          )}
        </div>
      </div>

      {readerOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={readerDialogRef}
          className="library-reader-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setReaderOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label={`Reader: ${doc.title}`}
          tabIndex={-1}
        >
          <div className="library-reader-modal library-reader-modal--wide" style={{ "--reader-font-size": `${readerFont}px` } as CSSProperties}>
            {/* Reader scroll progress bar */}
            <div className="library-scroll-progress">
              <div className="library-scroll-progress-fill" style={{ width: `${readerScrollPct}%` }} />
            </div>
            {/* Reader header */}
            <div className="library-reader-header">
              <div className="library-reader-title">{doc.title}</div>
              <div className="library-reader-meta">
                <span className="library-preview-familiar"><Icon name="ph:robot" width={12} className="inline-block mr-1 text-[var(--text-muted)]" />Sage</span>
                <span className="library-preview-sep">·</span>
                <span className="library-preview-date">{fmtDate(doc.modifiedAt)}</span>
                <span className="library-preview-sep">·</span>
                <span className="library-reading-time">⏱ ~{readMins} min read</span>
                {doc.tags.length > 0 && (
                  <><span className="library-preview-sep">·</span>
                  {doc.tags.map((t: string) => <span key={t} className="library-doclist-tag">{t}</span>)}
                  </>
                )}
              </div>
              <div className="library-reader-actions">
                <TranslateButton source={{ kind: "text", title: doc.title, text: renderBody }} readerIcon />
                {docNav && docNav.total > 1 && (
                  <>
                    <button
                      type="button"
                      className="library-reader-iconbtn"
                      onClick={docNav.onPrev}
                      disabled={docNav.index <= 0}
                      title="Previous document (←)"
                      aria-label="Previous document"
                    >
                      <Icon name="ph:caret-left" width={13} />
                    </button>
                    <span className="library-reader-navpos" aria-live="polite">
                      {docNav.index + 1}/{docNav.total}
                    </span>
                    <button
                      type="button"
                      className="library-reader-iconbtn"
                      onClick={docNav.onNext}
                      disabled={docNav.index >= docNav.total - 1}
                      title="Next document (→)"
                      aria-label="Next document"
                    >
                      <Icon name="ph:caret-right" width={13} />
                    </button>
                    <span className="library-reader-actions-sep" aria-hidden />
                  </>
                )}
                <button
                  type="button"
                  className="library-reader-iconbtn"
                  onClick={() => stepReaderFont(-1)}
                  disabled={readerFont <= READER_FONT_SIZES[0]}
                  title="Smaller text"
                  aria-label="Decrease text size"
                >
                  <span className="text-[11px] font-semibold">A−</span>
                </button>
                <button
                  type="button"
                  className="library-reader-iconbtn"
                  onClick={() => stepReaderFont(1)}
                  disabled={readerFont >= READER_FONT_SIZES[READER_FONT_SIZES.length - 1]}
                  title="Larger text"
                  aria-label="Increase text size"
                >
                  <span className="text-[13px] font-semibold">A+</span>
                </button>
                <button
                  type="button"
                  className="library-reader-close"
                  onClick={() => setReaderOpen(false)}
                  title="Close reader (Esc)"
                  aria-label="Close reader"
                >
                  <Icon name="ph:x" width={15} />
                </button>
              </div>
            </div>
            {/* Reader body */}
            <div
              ref={readerBodyRef}
              onScroll={handleReaderScroll}
              className={hasReaderToc ? "library-reader-body library-reader-body--with-toc" : "library-reader-body"}
            >
              {leadingMeta && <MetadataBlock entries={leadingMeta.entries} />}
              <RenderedMarkdown text={renderBody} containerRef={readerMdRef} />
              {hasReaderToc && (
                <TocPanel items={readerTocItems} activeId={activeReaderTocId} mdRef={readerMdRef} readerMode />
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}


// ── PDF Viewer ────────────────────────────────────────────────────
// Renders a local PDF file inline. Uses <iframe> with a file:// URL which
// works both in Tauri (via allowlist) and in the browser (same-origin file).
// Falls back to a "Open in system viewer" button if the path is unavailable.
function PdfViewer({ localPath, title }: { localPath: string; title: string }) {
  const [error, setError] = useState(false);
  const [sidecarAuthToken] = useState(() => readSidecarAuthToken());
  // Use the Next.js API route to serve the PDF (safe, no file:// CSP issues)
  const filename = localPath.split("/").pop() ?? "";
  const iframeUrl = sidecarAuthToken
    ? `/api/library/pdf?file=${encodeURIComponent(filename)}&${SIDECAR_TOKEN_PARAM}=${encodeURIComponent(sidecarAuthToken)}`
    : `/api/library/pdf?file=${encodeURIComponent(filename)}`;
  // file:// fallback for Tauri desktop mode
  const fileUrl = `file://${localPath}`;

  if (error) {
    return (
      <div className="library-preview library-preview--empty" style={{ flexDirection: "column", gap: 12 }}>
        <Icon name="ph:file-text" width={32} className="library-preview-empty-icon" />
        <span className="library-preview-empty-text">Could not load PDF inline.</span>
        <button
          type="button"
          className="library-preview-action-btn"
          onClick={() => void openUrl(fileUrl)}
        >
          <Icon name="ph:arrow-square-out" width={13} />
          <span>Open in system viewer</span>
        </button>
      </div>
    );
  }

  return (
    <div className="library-preview" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div className="library-preview-header">
        <div className="library-preview-title">{title}</div>
        <div className="library-preview-actions">
          <TranslateButton source={{ kind: "file", title, path: localPath }} />
          <button
            type="button"
            className="library-preview-action-btn"
            onClick={() => void openUrl(fileUrl)}
          >
            <Icon name="ph:arrow-square-out" width={13} />
            <span>Open externally</span>
          </button>
          <CopyButton text={localPath} label="Copy path" />
        </div>
      </div>
      <iframe
        src={iframeUrl}
        title={title}
        style={{ flex: 1, width: "100%", minHeight: 0, border: "none", borderRadius: "0 0 6px 6px" }}
        onError={() => setError(true)}
      />
    </div>
  );
}

// ── Skill detail ─────────────────────────────────────────────────
function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <div className="library-preview">
      <div className="library-preview-header">
        <div className="library-preview-title">{skill.name}</div>
        <div className="library-preview-meta">
          {skill.category && <span className="library-doclist-tag">{skill.category}</span>}
          {skill.owner && (
            <><span className="library-preview-sep">·</span>
            <span className="library-preview-date">{skill.owner}</span></>
          )}
          {skill.score != null && (
            <><span className="library-preview-sep">·</span>
            <span className="library-preview-date">score {skill.score.toFixed(2)}</span></>
          )}
        </div>
        {skill.tags && skill.tags.length > 0 && (
          <div className="library-preview-tags">
            {skill.tags.map((t) => <span key={t} className="library-doclist-tag">{t}</span>)}
          </div>
        )}
      </div>
      <div className="library-preview-body">
        {skill.description ? (
          <FieldRow label="Description">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{skill.description}</div>
          </FieldRow>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", padding: "12px 0" }}>No description available.</div>
        )}
        <FieldRow label="ID">
          <code style={{ fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-raised)", padding: "2px 6px", borderRadius: 4 }}>{skill.id}</code>
        </FieldRow>
        {skill.owner && (
          <FieldRow label="Owner">
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{skill.owner}</span>
          </FieldRow>
        )}
      </div>
    </div>
  );
}

// ── Dispatcher ───────────────────────────────────────────────────
export function LibraryDocPreview({ selected, loading, activeSection, docNav }: Props) {
  // Stale-while-loading: when something is already selected, keep it
  // mounted during the next fetch instead of swapping to a loading shell.
  // Unmounting here would tear down DocDetail mid-navigation and close an
  // open reader (prev/next doc would otherwise exit reader mode).
  if (loading && !selected) {
    return (
      <div className="library-preview library-preview--empty">
        <span className="library-preview-empty-text">Loading…</span>
      </div>
    );
  }
  if (!selected) {
    return (
      <div className="library-preview library-preview--empty">
        <Icon name="ph:book-open" width={32} className="library-preview-empty-icon" />
        <span className="library-preview-empty-text">
          {activeSection ? EMPTY_TEXT[activeSection] : "Select an item to preview"}
        </span>
      </div>
    );
  }
  if (selected.kind === "doc")      return <DocDetail doc={selected.doc} docNav={docNav} />;
  if (selected.kind === "bookmark") return <BookmarkDetail item={selected.item} />;
  if (selected.kind === "reading")  return <ReadingDetail item={selected.item} />;
  if (selected.kind === "github")   return <GitHubDetail item={selected.item} />;
  if (selected.kind === "skill")    return <SkillDetail skill={selected.skill} />;
  return null;
}
