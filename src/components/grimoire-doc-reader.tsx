"use client";

/**
 * GrimoireDocReader — the Memories Library's default way to open a document.
 *
 * Reading comes first: a stitch, memory file, or journal reflection opens in
 * the shared DocumentReader (contents rail, scroll progress, heading anchors,
 * copyable code blocks, tables, task lists) and editing is an explicit step —
 * the host's Edit control, or `E` while the reader has focus.
 *
 * `[[wiki-links]]` in the prose resolve against the Library's loaded doc index
 * and open in place, the same resolution the doc-links chip row uses.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Block } from "@create-markdown/core";
import { DocumentReader } from "@/components/document-reader";
import {
  MarkdownReaderBlock,
  ReaderWikiLinkContext,
  type ReaderWikiLinks,
} from "@/components/document-reader-markdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LIVE_FOLLOW_INTERVAL_MS } from "@/components/md-editor/memory-md-editor";
import { parseMarkdownReaderDocument } from "@/lib/document-reader";
import { parseMdDocument } from "@/lib/md-frontmatter";
import { useMemoryFile } from "@/lib/use-memory-file";
import { cleanDocTitle, formatReadingMeta, journalEntryQuery, readingMeta } from "@/lib/grimoire-library";
import { resolveWikiLinkTarget, type WikiDocIndex, type WikiDocRef } from "@/lib/wiki-link-resolve";

/** Per-document scroll position (0–1) for the session, so switching tabs and
 *  coming back — or finishing an edit — lands where the reader left off. */
const readerScrollMemory = new Map<string, number>();
/** The last focus request each document honoured, so a remount (tab switch)
 *  never re-steals focus for a request that was already served. */
const servedFocusTokens = new Map<string, number>();

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export type GrimoireDocReaderProps = {
  /** The raw document (frontmatter allowed); null while it loads. */
  markdown: string | null;
  loadError?: string | null;
  /** Title when the document has neither a frontmatter title nor an H1. */
  fallbackTitle: string;
  kicker?: ReactNode;
  /** Extra muted facts after the reading time ("Updated 3d ago"). */
  meta?: Array<string | null | undefined | false>;
  docIndex: WikiDocIndex;
  onOpenDoc: (ref: WikiDocRef) => void;
  /** Starts editing. Bound to `E` inside the reader and the empty state. */
  onEdit?: () => void;
  /** A banner above the document (unsaved edits, continuity flags…). */
  notice?: ReactNode;
  /** Stable identity for scroll restore. */
  docKey: string;
  /** Bump to move keyboard focus into the document once it renders
   *  (returning from an edit, entering focus reading) so `E` and arrow-key
   *  scrolling work immediately. 0 never focuses. */
  focusToken?: number;
};

export function GrimoireDocReader({
  markdown,
  loadError = null,
  fallbackTitle,
  kicker,
  meta = [],
  docIndex,
  onOpenDoc,
  onEdit,
  notice,
  docKey,
  focusToken = 0,
}: GrimoireDocReaderProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const parsed = useMemo(() => {
    if (markdown === null) return null;
    const doc = parseMdDocument(markdown);
    const frontmatterName = typeof doc.rest.name === "string" ? doc.rest.name : null;
    const description = typeof doc.rest.description === "string" ? doc.rest.description.trim() : "";
    const title = cleanDocTitle(doc.title) || cleanDocTitle(frontmatterName) || fallbackTitle;
    return {
      body: doc.body,
      description,
      reader: parseMarkdownReaderDocument(doc.body, title),
      stats: readingMeta(doc.body),
    };
  }, [fallbackTitle, markdown]);

  const namedSections = parsed ? parsed.reader.sections.filter((section) => section.heading).length : 0;
  // The contents rail earns its column only when there is structure to
  // navigate; a single heading would be a one-link rail.
  const navigation = namedSections >= 2 ? "rail" : "none";

  const wikiLinks = useMemo<ReaderWikiLinks>(
    () => ({
      resolves: (target) => resolveWikiLinkTarget(target, docIndex) !== null,
      open: (target) => {
        const ref = resolveWikiLinkTarget(target, docIndex);
        if (ref) onOpenDoc(ref);
      },
    }),
    [docIndex, onOpenDoc],
  );

  const scroller = useCallback(
    () => rootRef.current?.querySelector<HTMLElement>(".document-reader__scroll") ?? null,
    [],
  );

  // Restore once per mount, as soon as the document has rendered.
  const restoredRef = useRef(false);
  const ready = parsed !== null && parsed.body.trim() !== "";
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const el = scroller();
    const saved = readerScrollMemory.get(docKey) ?? 0;
    if (el && saved > 0) {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: saved * max, behavior: "instant" });
    }
    if (progressRef.current) progressRef.current.style.width = `${saved * 100}%`;
  }, [docKey, ready, scroller]);

  useEffect(() => {
    if (!ready || focusToken <= 0 || servedFocusTokens.get(docKey) === focusToken) return;
    const el = scroller();
    if (!el) return;
    servedFocusTokens.set(docKey, focusToken);
    el.focus({ preventScroll: true });
  }, [docKey, focusToken, ready, scroller]);

  const onScrollProgress = useCallback(
    (progress: number) => {
      readerScrollMemory.set(docKey, progress);
      if (progressRef.current) progressRef.current.style.width = `${progress * 100}%`;
    },
    [docKey],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onEdit || event.defaultPrevented) return;
    if (event.key !== "e" && event.key !== "E") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    // Popovers portal out of this subtree; only the document itself binds E.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    event.preventDefault();
    onEdit();
  };

  const metaParts = parsed
    ? [formatReadingMeta(parsed.stats), ...meta.filter((part): part is string => Boolean(part))]
    : [];

  let body: ReactNode;
  if (loadError) {
    body = (
      <div className="p-4">
        <ErrorState compact headline="Couldn't load this document" subtitle={loadError} />
      </div>
    );
  } else if (parsed === null) {
    body = (
      <div className="grimoire-reader__loading" aria-label="Loading document" aria-busy="true">
        {["38%", "92%", "85%", "97%", "78%", "90%"].map((width, index) => (
          <Skeleton key={index} variant="text" width={width} />
        ))}
      </div>
    );
  } else if (!ready) {
    body = (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:file-text"
          headline="This document is empty"
          subtitle="Add a first line and it will read here."
          actions={
            onEdit ? (
              <Button size="sm" leadingIcon="ph:pencil-simple" onClick={onEdit}>
                Start writing
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <ReaderWikiLinkContext.Provider value={wikiLinks}>
        <DocumentReader<Block, Block>
          document={parsed.reader}
          navigation={navigation}
          kicker={kicker}
          context={
            <>
              {parsed.description ? <p className="grimoire-reader__summary">{parsed.description}</p> : null}
              <p className="grimoire-reader__meta">
                {metaParts.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </p>
            </>
          }
          collapsibleSections={false}
          scrollLabel="Document reader"
          onScrollProgress={onScrollProgress}
          renderLede={(block) => <MarkdownReaderBlock block={block} blockKey="grimoire-lede" />}
          renderBlock={(block, key) => <MarkdownReaderBlock block={block} blockKey={key} />}
        />
      </ReaderWikiLinkContext.Provider>
    );
  }

  return (
    <div ref={rootRef} className="grimoire-reader" data-doc-key={docKey} onKeyDown={onKeyDown}>
      <div className="grimoire-reader__progress" aria-hidden>
        <div ref={progressRef} className="grimoire-reader__progress-fill" />
      </div>
      {notice}
      <div className="grimoire-reader__body">{body}</div>
    </div>
  );
}

type SourceReaderProps = Omit<GrimoireDocReaderProps, "markdown" | "loadError">;

/** A memory file in the reader. Follows agent writes while it is the active
 *  tab (the same light `?stat=1` mtime poll the editor uses), keeping the last
 *  text on screen while a newer version loads so the page never blanks. */
export function MemoryDocReader({
  path,
  refreshToken = 0,
  active,
  ...reader
}: SourceReaderProps & { path: string; refreshToken?: number; active: boolean }) {
  const [followToken, setFollowToken] = useState(0);
  const { text, error, mtimeMs } = useMemoryFile(path, { refreshToken: refreshToken + followToken });
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (text !== null) setShown(text);
  }, [text]);

  useEffect(() => {
    if (!active || mtimeMs === null) return;
    let cancelled = false;
    let checking = false;
    const timer = window.setInterval(() => {
      if (cancelled || checking || document.hidden) return;
      checking = true;
      void (async () => {
        try {
          const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}&stat=1`, { cache: "no-store" });
          const json = await res.json();
          if (cancelled || !json.ok || typeof json.mtimeMs !== "number") return;
          if (Math.floor(json.mtimeMs) !== Math.floor(mtimeMs)) setFollowToken((n) => n + 1);
        } catch {
          /* transient poll failure — the next tick retries */
        } finally {
          checking = false;
        }
      })();
    }, LIVE_FOLLOW_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, mtimeMs, path]);

  return <GrimoireDocReader {...reader} markdown={text ?? shown} loadError={shown === null ? error : null} />;
}

/** A journal reflection in the reader — a familiar's own entry when
 *  `familiar` is set, else the legacy coven-wide day file. */
export function JournalDocReader({
  date,
  familiar,
  refreshToken = 0,
  ...reader
}: SourceReaderProps & { date: string; familiar?: string; refreshToken?: number }) {
  const [state, setState] = useState<{ text: string | null; error: string | null }>({ text: null, error: null });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/journal?${journalEntryQuery(date, familiar)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setState({ text: json.entry?.reflection ?? "", error: null });
        else setState((prev) => ({ text: prev.text, error: json.error ?? "Failed to load journal entry" }));
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            text: prev.text,
            error: err instanceof Error ? err.message : "Failed to load journal entry",
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, familiar, refreshToken]);
  return <GrimoireDocReader {...reader} markdown={state.text} loadError={state.text === null ? state.error : null} />;
}
