"use client";

import { useEffect, useRef, useState } from "react";
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
  if (tab.kind === "localhost") return "↯";
  try {
    const u = new URL(tab.url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
  } catch {
    return "🌐";
  }
}

export function BrowserQuickOpen({ tabs, activeId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
      className="absolute inset-0 z-50 flex items-start justify-center pt-[72px]"
      style={{ background: "transparent" }}
      onMouseDown={handleBackdrop}
    >
      <div
        className="w-[420px] max-w-[92vw] overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: "#131316",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); }}
            onKeyDown={handleKey}
            placeholder="Jump to tab…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[rgba(255,255,255,0.25)]"
            style={{ color: "rgba(255,255,255,0.9)" }}
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setHighlightIdx(0); inputRef.current?.focus(); }}
              className="text-xs"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Tab list */}
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            No tabs match &ldquo;{query}&rdquo;
          </p>
        ) : (
          <ul ref={listRef} className="max-h-[320px] overflow-y-auto py-1.5">
            {filtered.map((tab, i) => {
              const isActive = tab.id === activeId;
              const isHighlighted = i === safeIdx;
              const fav = favicon(tab);
              const isEmoji = fav.length <= 2;

              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-none"
                    style={{
                      background: isHighlighted ? "rgba(255,255,255,0.06)" : "transparent",
                    }}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => { onSelect(tab.id); onClose(); }}
                  >
                    {/* Favicon */}
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isEmoji ? (
                        <span className="text-sm leading-none">{fav}</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fav} alt="" width={14} height={14} className="rounded-sm opacity-70" />
                      )}
                    </span>

                    {/* Title + hint */}
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm"
                        style={{ color: isHighlighted ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)" }}
                      >
                        {tab.title || tabHint(tab)}
                      </span>
                      <span className="block truncate text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {tabHint(tab)}
                      </span>
                    </span>

                    {/* Active indicator */}
                    {isActive && (
                      <span
                        className="shrink-0 rounded-full text-[10px] px-1.5 py-0.5"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                      >
                        current
                      </span>
                    )}

                    {/* Highlight arrow */}
                    {isHighlighted && !isActive && (
                      <span className="shrink-0 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>↵</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer hint */}
        <div
          className="flex items-center gap-3 border-t px-4 py-2"
          style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.25)" }}
        >
          <span className="text-[10px]">↑↓ navigate</span>
          <span className="text-[10px]">↵ open</span>
          <span className="text-[10px]">esc close</span>
        </div>
      </div>
    </div>
  );
}
