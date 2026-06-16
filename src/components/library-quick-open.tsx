"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

// ── LibraryQuickOpen ──────────────────────────────────────────────────────────
//
// A keyboard-first "/" palette for jumping to anything in the Library — docs,
// bookmarks, reading-list entries, and GitHub items — across every collection at
// once. The Library's per-section searches only cover one list; this is the
// unified jump. Mirrors BrowserQuickOpen (the browser pane's ⌘K palette): focus
// the input on open, ↑/↓ to move, ↵ to open, esc to close, click outside to
// dismiss, with listbox/option a11y wiring.
//
// Props:
//   items    — the unified, pre-fetched library entries to search
//   loading  — true while the parent is still fetching items
//   onSelect — called with the chosen item (parent navigates + opens it)
//   onClose  — called when the palette should close (esc / outside click)

export type LibraryQuickKind = "doc" | "bookmark" | "reading" | "github";

export type LibraryQuickItem = {
  /** Stable key, unique across kinds (e.g. "bookmark:abc"). */
  key: string;
  kind: LibraryQuickKind;
  title: string;
  hint: string;
  icon: Parameters<typeof Icon>[0]["name"];
  // Opaque payload the parent uses to navigate; the palette never reads these.
  doc?: unknown;
  entry?: unknown;
};

const KIND_LABEL: Record<LibraryQuickKind, string> = {
  doc: "Doc",
  bookmark: "Bookmark",
  reading: "Reading",
  github: "GitHub",
};

type Props = {
  items: LibraryQuickItem[];
  loading?: boolean;
  onSelect: (item: LibraryQuickItem) => void;
  onClose: () => void;
};

export function LibraryQuickOpen({ items, loading = false, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (it) => it.title.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q),
      )
    : items;

  const safeIdx = Math.min(highlightIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const el = listRef.current?.children[safeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [safeIdx]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[safeIdx];
      if (chosen) onSelect(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      role="presentation"
      className="absolute inset-0 z-50 flex items-start justify-center pt-[72px] bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdrop}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the library"
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-hairline)] px-4 py-3">
          <Icon name="ph:magnifying-glass" width={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
            onKeyDown={handleKey}
            placeholder="Search docs, bookmarks, reading & GitHub…"
            className="focus-ring-inset flex-1 rounded bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search the library"
            aria-controls="library-quick-open-listbox"
            aria-activedescendant={
              filtered.length > 0 ? `library-quick-open-option-${safeIdx}` : undefined
            }
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setHighlightIdx(0); inputRef.current?.focus(); }}
              className="focus-ring rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Clear search"
            >
              <Icon name="ph:x" width={12} />
            </button>
          )}
        </div>

        {loading ? (
          <p role="status" className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
            Loading library…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
            {items.length === 0 ? "The library is empty." : `Nothing matches “${query}”`}
          </p>
        ) : (
          <ul
            id="library-quick-open-listbox"
            role="listbox"
            ref={listRef}
            className="max-h-[340px] overflow-y-auto py-1.5"
          >
            {filtered.map((it, i) => {
              const isHighlighted = i === safeIdx;
              return (
                <li
                  key={it.key}
                  role="option"
                  id={`library-quick-open-option-${i}`}
                  aria-selected={isHighlighted}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`focus-ring-inset flex w-full items-center gap-3 px-4 py-2.5 text-left transition-none ${
                      isHighlighted ? "bg-[var(--bg-hover)]" : ""
                    }`}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => onSelect(it)}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)]">
                      <Icon name={it.icon} width={14} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          isHighlighted ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {it.title}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">{it.hint}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {KIND_LABEL[it.kind]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-[var(--border-hairline)] px-4 py-2 text-[var(--text-muted)]">
          <span className="text-[10px]">↑↓ navigate</span>
          <span className="text-[10px]">↵ open</span>
          <span className="text-[10px]">esc close</span>
        </div>
      </div>
    </div>
  );
}
