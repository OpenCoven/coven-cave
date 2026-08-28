"use client";

import "@/styles/cave-chat.css";

// ── ChatStartFromBands ───────────────────────────────────────────────────────
// The new-session launcher, built to Chat.dc.html option 2b.
//
// One compact source switcher drives a paged four-tile deck. Desktop uses one
// row; compact panes use two-by-two. Nothing scrolls inside the launcher.
//
// The component is presentational on purpose. Both new-session surfaces feed it
// the same shape — ChatNewDashboard (a brand-new chat, `sessionId === null`) and
// ChatEmptyState (an existing zero-turn session) — so the two pages can no
// longer disagree about what starting a session looks like. Counts and notes
// come from the shared pure model in `@/lib/chat-start-from`, never from the
// caller's own arithmetic.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/lib/icon";
import type { StartFromGroupMeta, StartFromKind } from "@/lib/chat-start-from";

/** One tile in a band — a single piece of work you can start from. */
export type StartFromTile = {
  id: string;
  /** Tile headline; clamped to three lines by the sheet, never truncated in JS. */
  title: string;
  /** Short right-hand token: "resume", "P1", "open", an age. One, never two. */
  badge?: string | null;
  /** Quiet mono second line — where the work lives, then its state. */
  sub?: string | null;
  /** Full sentence for screen readers; falls back to the title. */
  ariaLabel?: string;
  /** Native tooltip. */
  hint?: string;
  disabled?: boolean;
  /** Replaces the badge while an open/resume request is in flight. */
  busyLabel?: string | null;
  onPick: () => void;
};

export type StartFromBand = {
  meta: StartFromGroupMeta;
  tiles: StartFromTile[];
  /** Trailing quiet tile that opens the full surface ("View all in Tasks →"). */
  viewAll?: { label: string; onOpen: () => void } | null;
  /** Rendered in place of the tile strip — skeletons, an error, a retry. */
  status?: ReactNode;
};

/** The design's promise for the strip, stated once above every band. */
export const START_FROM_NOTE = "one tap fills the brief and the whole setup";
const START_FROM_PAGE_SIZE = 4;

export function ChatStartFromBands({
  bands,
  note = START_FROM_NOTE,
  label = "Start from",
}: {
  bands: StartFromBand[];
  note?: string;
  label?: string;
}) {
  const [activeKind, setActiveKind] = useState<StartFromKind | null>(bands[0]?.meta.kind ?? null);
  const [pageByKind, setPageByKind] = useState<Partial<Record<StartFromKind, number>>>({});
  const activeBand = bands.find((band) => band.meta.kind === activeKind) ?? bands[0] ?? null;
  const items = useMemo(
    () => activeBand
      ? [
          ...activeBand.tiles.map((tile) => ({ type: "tile" as const, tile })),
          ...(activeBand.viewAll
            ? [{ type: "more" as const, viewAll: activeBand.viewAll }]
            : []),
        ]
      : [],
    [activeBand],
  );
  const pageCount = Math.max(1, Math.ceil(items.length / START_FROM_PAGE_SIZE));
  const page = Math.min(activeBand ? pageByKind[activeBand.meta.kind] ?? 0 : 0, pageCount - 1);
  const pageStart = page * START_FROM_PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + START_FROM_PAGE_SIZE);

  useEffect(() => {
    if (!bands.some((band) => band.meta.kind === activeKind)) {
      setActiveKind(bands[0]?.meta.kind ?? null);
    }
  }, [activeKind, bands]);

  if (!activeBand) return null;

  const setPage = (next: number) => {
    setPageByKind((current) => ({
      ...current,
      [activeBand.meta.kind]: Math.min(Math.max(next, 0), pageCount - 1),
    }));
  };

  return (
    <section className="cave-sf" aria-label="Start from existing work">
      <div className="cave-sf__head">
        <span className="cave-sf__head-label">{label}</span>
        <span className="cave-sf__head-rule" aria-hidden />
        <span className="cave-sf__head-note">{note}</span>
      </div>

      <div className="cave-sf__sources" role="tablist" aria-label="Start-from sources">
        {bands.map(({ meta }) => {
          const active = meta.kind === activeBand.meta.kind;
          return (
            <button
              key={meta.kind}
              type="button"
              role="tab"
              id={`cave-sf-tab-${meta.kind}`}
              aria-controls={`cave-sf-panel-${meta.kind}`}
              aria-selected={active}
              className="cave-sf__source focus-ring"
              data-kind={meta.kind}
              onClick={() => setActiveKind(meta.kind)}
              title={meta.note}
            >
              <Icon name={meta.icon} width={14} height={14} aria-hidden />
              <span className="cave-sf__source-label">{meta.label}</span>
              <span className="cave-sf__source-count">{meta.count}</span>
            </button>
          );
        })}
      </div>

      <div className="cave-sf__deck-frame">
        <div
          className="cave-sf__deck"
          role="tabpanel"
          id={`cave-sf-panel-${activeBand.meta.kind}`}
          aria-labelledby={`cave-sf-tab-${activeBand.meta.kind}`}
          data-kind={activeBand.meta.kind}
          // Column count follows the item count so a short deck fills the row
          // instead of leaving the remainder of a fixed 4-up grid empty. A
          // status message spans the full width on its own, so it reads as 1.
          data-count={activeBand.status ? 1 : Math.min(pageItems.length, 4)}
        >
          {activeBand.status ?? pageItems.map((item) => (
            item.type === "tile" ? (
              <button
                key={item.tile.id}
                type="button"
                className="cave-sf__tile focus-ring"
                disabled={item.tile.disabled || Boolean(item.tile.busyLabel)}
                title={item.tile.hint}
                aria-label={item.tile.ariaLabel ?? item.tile.title}
                onClick={item.tile.onPick}
              >
                <span className="cave-sf__tile-top">
                  <span className="cave-sf__tile-title">{item.tile.title}</span>
                  {item.tile.busyLabel ? (
                    <span className="cave-sf__tile-badge">{item.tile.busyLabel}</span>
                  ) : item.tile.badge ? (
                    <span className="cave-sf__tile-badge">{item.tile.badge}</span>
                  ) : null}
                </span>
                {item.tile.sub ? (
                  <span className="cave-sf__tile-sub">
                    <span className="cave-sf__tile-dot" aria-hidden />
                    <span className="cave-sf__tile-sub-text">{item.tile.sub}</span>
                  </span>
                ) : null}
              </button>
            ) : (
              <button
                key="view-all"
                type="button"
                className="cave-sf__tile cave-sf__tile--more focus-ring"
                onClick={item.viewAll.onOpen}
              >
                <span className="cave-sf__tile-more-label">
                  {item.viewAll.label}
                  <Icon name="ph:arrow-right-bold" width={11} height={11} aria-hidden />
                </span>
              </button>
            )
          ))}
        </div>

        {pageCount > 1 ? (
          <div className="cave-sf__pager" aria-label={`${activeBand.meta.label} pages`}>
            <span>{page + 1} / {pageCount}</span>
            <button
              type="button"
              className="cave-sf__page-button focus-ring"
              aria-label="Previous start-from page"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <Icon name="ph:caret-left" width={12} aria-hidden />
            </button>
            <button
              type="button"
              className="cave-sf__page-button focus-ring"
              aria-label="Next start-from page"
              disabled={page === pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              <Icon name="ph:caret-right" width={12} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
