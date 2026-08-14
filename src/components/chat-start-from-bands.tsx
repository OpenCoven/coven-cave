"use client";

import "@/styles/cave-chat.css";

// ── ChatStartFromBands ───────────────────────────────────────────────────────
// The new-session launcher, built to Chat.dc.html option 2b.
//
// The design replaces the old vertical stack of full-width rows with one
// horizontal BAND per source of work: a tinted head cell states what the source
// is and how much of it is on screen, and the rest of the band is a strip of
// fixed-width tiles that scrolls sideways when the pane is narrow. Collapsing a
// band folds it to a single head row, so a source you never start from costs
// one line instead of a section.
//
// The component is presentational on purpose. Both new-session surfaces feed it
// the same shape — ChatNewDashboard (a brand-new chat, `sessionId === null`) and
// ChatEmptyState (an existing zero-turn session) — so the two pages can no
// longer disagree about what starting a session looks like. Counts and notes
// come from the shared pure model in `@/lib/chat-start-from`, never from the
// caller's own arithmetic.

import { useCallback, useState, type ReactNode } from "react";

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

export function ChatStartFromBands({
  bands,
  note = START_FROM_NOTE,
  label = "Start from",
}: {
  bands: StartFromBand[];
  note?: string;
  label?: string;
}) {
  // Collapse is per-kind and local: which sources you fold is a reading
  // preference for this page view, not state worth persisting across sessions.
  const [collapsed, setCollapsed] = useState<Partial<Record<StartFromKind, boolean>>>({});
  const toggle = useCallback((kind: StartFromKind) => {
    setCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }, []);

  if (bands.length === 0) return null;

  return (
    <section className="cave-sf" aria-label="Start from existing work">
      <div className="cave-sf__head">
        <span className="cave-sf__head-label">{label}</span>
        <span className="cave-sf__head-rule" aria-hidden />
        <span className="cave-sf__head-note">{note}</span>
      </div>

      {bands.map((band) => {
        const { meta } = band;
        const open = !collapsed[meta.kind];
        return (
          <div key={meta.kind} className="cave-sf__band" data-kind={meta.kind} data-open={open}>
            <button
              type="button"
              className="cave-sf__band-head"
              aria-expanded={open}
              aria-label={`${meta.label} — ${meta.count}, ${meta.note}`}
              onClick={() => toggle(meta.kind)}
            >
              <span className="cave-sf__band-glyphs">
                <Icon name={meta.icon} width={14} height={14} aria-hidden />
                <Icon name="ph:caret-right" width={9} height={9} className="cave-sf__caret" aria-hidden />
              </span>
              <span className="cave-sf__band-label">{meta.label}</span>
              <span className="cave-sf__band-count">{meta.count}</span>
              <span className="cave-sf__band-spacer" aria-hidden />
              <span className="cave-sf__band-note">{meta.note}</span>
            </button>

            {open ? (
              <div className="cave-sf__strip" role="group" aria-label={meta.label}>
                {band.status ?? (
                  <>
                    {band.tiles.map((tile) => (
                      <button
                        key={tile.id}
                        type="button"
                        className="cave-sf__tile"
                        disabled={tile.disabled || Boolean(tile.busyLabel)}
                        title={tile.hint}
                        aria-label={tile.ariaLabel ?? tile.title}
                        onClick={tile.onPick}
                      >
                        <span className="cave-sf__tile-top">
                          <span className="cave-sf__tile-title">{tile.title}</span>
                          {tile.busyLabel ? (
                            <span className="cave-sf__tile-badge">{tile.busyLabel}</span>
                          ) : tile.badge ? (
                            <span className="cave-sf__tile-badge">{tile.badge}</span>
                          ) : null}
                        </span>
                        {tile.sub ? (
                          <span className="cave-sf__tile-sub">
                            <span className="cave-sf__tile-dot" aria-hidden />
                            <span className="cave-sf__tile-sub-text">{tile.sub}</span>
                          </span>
                        ) : null}
                      </button>
                    ))}
                    {band.viewAll ? (
                      <button
                        type="button"
                        className="cave-sf__tile cave-sf__tile--more"
                        onClick={band.viewAll.onOpen}
                      >
                        <span className="cave-sf__tile-more-label">
                          {band.viewAll.label}
                          <Icon name="ph:arrow-right-bold" width={11} height={11} aria-hidden />
                        </span>
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
