"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { BrowserTab } from "@/components/browser-pane";

// ── BrowserQuickOpen ──────────────────────────────────────────────────────────
//
// Cmd+K (or Ctrl+K) palette for jumping to a pinned / saved browser tab.
// Designed to feel like open-sesame but scoped to the browser pane only —
// minimal, keyboard-first, no chrome.
//
// Props:
//   tabs        — all tabs from BrowserPane (pinned + localhost)
//   activeId    — currently active tab id (shown with a dot indicator)
//   onSelect    — called with the chosen tab id
//   onClose     — called when the palette should close (Escape / outside click)

type Props = {
  tabs: BrowserTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

function tabHint(tab: BrowserTab): string {
  try {
    const u = new URL(tab.url);
    if (u.hostname === "localhost") return `localhost:${u.port || "80"}${u.pathname !== "/" ? u.pathname : ""}`;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return tab.url.slice(0, 32);
  }
}

function favicon(tab: BrowserTab): string {
  if (tab.kind === "localhost") return "/window.svg";
  try {
    const u = new URL(tab.url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
  } catch {
    return "/globe.svg";
  }
}

export function BrowserQuickOpen({ tabs, activeId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Trap focus + Escape + restore focus to the trigger on close (the palette is
  // a modal overlay but previously leaked Tab to the page behind it).
  useFocusTrap(true, cardRef, { onEscape: onClose, focusFirst: false });

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter tabs by query
  const q = query.trim().toLowerCase();
  const filtered = q
    ? tabs.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.url.toLowerCase().includes(q) ||
          tabHint(t).toLowerCase().includes(q),
      )
    : tabs;

  // Clamp highlight when list shrinks
  const safeIdx = Math.min(highlightIdx, Math.max(0, filtered.length - 1));

  // Scroll highlighted item into view
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
      const chosen = filtered[safeIdx];
      if (chosen) { onSelect(chosen.id); onClose(); }
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  // Click outside → close
  const backdropRef = useRef<HTMLDivElement>(null);
  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  return (
    <div
      ref={backdropRef}
      className="absolute inset-0 z-50 flex items-start justify-center pt-[72px] bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdrop}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to tab"
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-[var(--border-hairline)] px-4 py-3">
          <span className="text-sm text-[var(--text-muted)]">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
            onKeyDown={handleKey}
            placeholder="Jump to tab…"
            className="focus-ring-inset flex-1 rounded bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search open tabs and history"
            aria-controls="browser-quick-open-listbox"
            aria-activedescendant={
              filtered.length > 0 ? `browser-quick-open-option-${safeIdx}` : undefined
            }
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setHighlightIdx(0); inputRef.current?.focus(); }}
              className="focus-ring rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Clear search"
            >
              x
            </button>
          )}
        </div>

        {/* Tab list */}
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
            No tabs match &ldquo;{query}&rdquo;
          </p>
        ) : (
          <ul
              id="browser-quick-open-listbox"
              role="listbox"
              ref={listRef}
              className="max-h-[320px] overflow-y-auto py-1.5"
            >
            {filtered.map((tab, i) => {
              const isActive = tab.id === activeId;
              const isHighlighted = i === safeIdx;
              const fav = favicon(tab);

              return (
                <li
                  key={tab.id}
                  role="option"
                  id={`browser-quick-open-option-${i}`}
                  aria-selected={i === safeIdx}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`focus-ring-inset flex w-full items-center gap-3 px-4 py-2.5 text-left transition-none ${
                      isHighlighted ? "bg-[var(--bg-hover)]" : ""
                    }`}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => { onSelect(tab.id); onClose(); }}
                  >
                    {/* Favicon */}
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fav} alt="" width={14} height={14} className="rounded-sm opacity-70" />
                    </span>

                    {/* Title + hint */}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          isHighlighted ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {tab.title || tabHint(tab)}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        {tabHint(tab)}
                      </span>
                    </span>

                    {/* Active indicator */}
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        current
                      </span>
                    )}

                    {/* Highlight arrow */}
                    {isHighlighted && !isActive && (
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">↵</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-[var(--border-hairline)] px-4 py-2 text-[var(--text-muted)]">
          <span className="text-[10px]">↑↓ navigate</span>
          <span className="text-[10px]">↵ open</span>
          <span className="text-[10px]">esc close</span>
        </div>
      </div>
    </div>
  );
}
