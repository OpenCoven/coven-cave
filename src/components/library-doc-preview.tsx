"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { isSafeGitHubUrl, isSafeHttpUrl, isSafeVscodeFileUrl } from "@/lib/url-safety";
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

// ── Discriminated union ──────────────────────────────────────────
export type SelectedItem =
  | { kind: "doc"; doc: LibraryDocBody }
  | { kind: "bookmark"; item: LibraryBookmark }
  | { kind: "reading"; item: LibraryReadingItem }
  | { kind: "github"; item: LibraryGitHubItem }
  | { kind: "skill"; skill: Skill }
  | null;

type Props = { selected: SelectedItem; loading: boolean; activeSection?: LibrarySectionKind };

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
const dateFmt = new Intl.DateTimeFormat([], { year: "numeric", month: "short", day: "numeric" });
function fmtDate(iso?: string): string {
  if (!iso) return "—";
  try { return dateFmt.format(new Date(iso)); } catch { return iso; }
}

type UrlOpenKind = "web" | "github" | "vscode-file";

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="library-preview-action-btn"
      onClick={() => {
        navigator.clipboard.writeText(text)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
          .catch(() => undefined);
      }}>
      <Icon name={copied ? "ph:check" : "ph:copy"} width={13} />
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
    <div className="library-preview">
      <div className="library-preview-header">
        <div className="library-preview-title">{item.title}</div>
        <div className="library-preview-meta">
          <span className="library-doclist-tag">{item.domain}</span>
          <span className="library-preview-sep">·</span>
          <span className="library-preview-date">{fmtDate(item.savedAt)}</span>
        </div>
        {item.tags.length > 0 && (
          <div className="library-preview-tags">
            {item.tags.map((t: string) => <span key={t} className="library-doclist-tag">{t}</span>)}
          </div>
        )}
        <div className="library-preview-actions">
          <OpenBtn url={item.url} />
          <CopyButton text={item.url} label="Copy URL" />
        </div>
      </div>
      <div className="library-preview-body">
        {item.notes ? (
          <FieldRow label="Notes">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.notes}</div>
          </FieldRow>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>No notes saved.</div>
        )}
        <FieldRow label="URL">
          <a href={isSafeHttpUrl(item.url) ? item.url : undefined} target="_blank" rel="noopener noreferrer" className="library-preview-link"
            onClick={(e) => { e.preventDefault(); void openUrl(item.url); }}>{item.url}</a>
        </FieldRow>
      </div>
    </div>
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
    <div className="library-preview">
      <div className="library-preview-header">
        <div className="library-preview-title">{item.title}</div>
        <div className="library-preview-meta">
          <span className="library-doclist-tag">{item.repo}</span>
          <span className="library-preview-sep">·</span>
          <span className="library-doclist-tag">{item.kind}</span>
          {item.number != null && <><span className="library-preview-sep">·</span><span className="library-preview-date">#{item.number}</span></>}
          {item.state && <><span className="library-preview-sep">·</span><span style={{ color: stateColor, fontSize: 12 }}>● {item.state}</span></>}
        </div>
        {item.labels.length > 0 && (
          <div className="library-preview-tags">
            {item.labels.map((l: string) => <span key={l} className="library-doclist-tag">{l}</span>)}
          </div>
        )}
        <div className="library-preview-actions">
          <OpenBtn url={item.url} label="Open on GitHub" kind="github" />
          <CopyButton text={item.url} label="Copy URL" />
        </div>
      </div>
      <div className="library-preview-body">
        <FieldRow label="Saved">
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{fmtDate(item.savedAt)}</div>
        </FieldRow>
        {item.notes && (
          <FieldRow label="Notes">
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.notes}</div>
          </FieldRow>
        )}
      </div>
    </div>
  );
}

function DocDetail({ doc }: { doc: LibraryDocBody }) {
  const [readerOpen, setReaderOpen] = useState(false);

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
    const items = headings.map((el) => {
      const text = el.textContent ?? "";
      const id = "toc-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
    const items = headings.map((el) => {
      const text = el.textContent ?? "";
      const id = "reader-toc-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      el.id = id;
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
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerOpen, readerTocItems, activeReaderTocId]);

  const hasToc = tocItems.length >= 3;
  const hasReaderToc = readerTocItems.length >= 3;

  const header = (
    <div className="library-preview-header">
      <div className="library-preview-title">{doc.title}</div>
      <div className="library-preview-meta">
        <span className="library-preview-familiar"><Icon name="ph:robot" width={12} className="inline-block mr-1 text-[var(--text-muted)]" />Sage</span>
        <span className="library-preview-sep">·</span>
        <span className="library-preview-date">{fmtDate(doc.modifiedAt)}</span>
        <span className="library-preview-sep">·</span>
        <span className="library-reading-time">⏱ ~{readMins} min read</span>
        {doc.tags.length > 0 && (
          <><span className="library-preview-sep">·</span>
          <div className="library-preview-tags">
            {doc.tags.map((t: string) => <span key={t} className="library-doclist-tag">{t}</span>)}
          </div></>
        )}
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

  const actionBar = (inReader = false) => (
    <div className="library-preview-actions library-preview-actions--bar">
      <button
        type="button"
        className="library-preview-action-btn"
        title="Open in VS Code"
        onClick={() => { if (doc.absolutePath) void openUrl(`vscode://file${doc.absolutePath}`, "vscode-file"); }}
      >
        <Icon name="ph:code" width={13} />
        <span>Open in editor</span>
      </button>
      <CopyButton text={`~/.openclaw/workspace/sage/${doc.id}`} label="Copy path" />
      <button
        type="button"
        className="library-preview-action-btn library-reader-btn"
        title={inReader ? "Exit reader mode" : "Reader mode"}
        onClick={() => setReaderOpen((v) => !v)}
      >
        <Icon name={inReader ? "ph:arrows-in-simple" : "ph:book-open"} width={13} />
        <span>{inReader ? "Exit reader" : "Reader mode"}</span>
      </button>
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
        {actionBar(false)}
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className={hasToc ? "library-preview-body library-preview-body--with-toc" : "library-preview-body"}
        >
          <RenderedMarkdown text={doc.body} containerRef={mdRef} />
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
          <div className="library-reader-modal">
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
              <button
                type="button"
                className="library-reader-close"
                onClick={() => setReaderOpen(false)}
                title="Close reader (Esc)"
              >
                <Icon name="ph:x" width={15} />
              </button>
            </div>
            {/* Reader body */}
            <div
              ref={readerBodyRef}
              onScroll={handleReaderScroll}
              className={hasReaderToc ? "library-reader-body library-reader-body--with-toc" : "library-reader-body"}
            >
              <RenderedMarkdown text={doc.body} containerRef={readerMdRef} />
              {hasReaderToc && (
                <TocPanel items={readerTocItems} activeId={activeReaderTocId} mdRef={readerMdRef} readerMode />
              )}
            </div>
            {/* Reader footer actions */}
            <div className="library-reader-footer">
              {actionBar(true)}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
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
export function LibraryDocPreview({ selected, loading, activeSection }: Props) {
  if (loading) {
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
  if (selected.kind === "doc")      return <DocDetail doc={selected.doc} />;
  if (selected.kind === "bookmark") return <BookmarkDetail item={selected.item} />;
  if (selected.kind === "reading")  return <ReadingDetail item={selected.item} />;
  if (selected.kind === "github")   return <GitHubDetail item={selected.item} />;
  if (selected.kind === "skill")    return <SkillDetail skill={selected.skill} />;
  return null;
}
