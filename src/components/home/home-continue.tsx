"use client";

// "Continue where you left off" — the hearth's resume carousel. Each page
// shows up to three recent sessions; its cards resume through the same handler
// the thread rail uses.

import { useMemo, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Icon, type IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { relativeAge } from "@/lib/rss";

export const HOME_CONTINUE_PREF_KEY = "cave:home:continue-expanded";
const HOME_CONTINUE_PAGE_SIZE = 3;

/** Newest-first sessions a person can meaningfully resume from home: not
 *  archived, not generator-spawned, and actually titled. */
export function resumableSessions(sessions: SessionRow[], max = 3): SessionRow[] {
  return sessions
    .filter((s) => !s.archived_at && !s.generated && Boolean(s.title?.trim()))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, max);
}

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

export function HomeContinue({ sessions, familiarNameById, onOpenSession }: Props) {
  // Sampled once per mount — ages are coarse ("2h ago"), so a live ticker
  // would be re-render noise right next to the composer.
  const [nowMs] = useState(() => Date.now());
  const [pageIndex, setPageIndex] = useState(0);
  const rows = useMemo(() => resumableSessions(sessions, Number.POSITIVE_INFINITY), [sessions]);
  const pageCount = Math.ceil(rows.length / HOME_CONTINUE_PAGE_SIZE);
  const page = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const visibleRows = rows.slice(page * HOME_CONTINUE_PAGE_SIZE, (page + 1) * HOME_CONTINUE_PAGE_SIZE);
  if (rows.length === 0 || !onOpenSession) return null;

  return (
    <section className="home-continue" aria-label="Continue where you left off">
      {/* No visible heading (2026-07-22): the cards read as resumable sessions
          on their own — title, "Edited N ago", resume arrow — so the label is
          screen-reader-only via the section's aria-label. */}
      <div className="home-continue__cards" data-count={visibleRows.length}>
        {visibleRows.map((s) => {
          const familiar = s.familiarId ? familiarNameById.get(s.familiarId) ?? null : null;
          const running = s.status === "running";
          const age = relativeAge(s.updated_at, nowMs);
          const ageLabel = /^\d/.test(age) ? `Edited ${age} ago` : age;
          const subtitle = familiar ?? "Session";
          const glyph: IconName = running ? "ph:terminal-window" : "ph:chat-circle-dots";
          return (
            <button
              key={s.id}
              type="button"
              className="home-continue__card"
              onClick={() => onOpenSession(s.id, s.familiarId ?? null)}
              title={`Resume “${s.title}”`}
            >
              <span className="home-continue__glyph" aria-hidden>
                <Icon name={glyph} width={16} />
              </span>
              <span className="home-continue__body">
                <span className="home-continue__title">{s.title}</span>
                <span className="home-continue__sub">{subtitle}</span>
              </span>
              <span className="home-continue__foot">
                <span
                  className={`home-continue__dot${running ? " is-running" : ""}`}
                  aria-hidden
                />
                <span className="home-continue__age">{ageLabel}</span>
              </span>
              <Icon
                name="ph:arrow-right-bold"
                width={14}
                className="home-continue__go"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <nav className="home-continue__nav" aria-label="Continue carousel">
          <IconButton
            icon="ph:caret-left"
            className="home-continue__nav-button"
            aria-label="Previous set of sessions"
            disabled={page === 0}
            onClick={() => setPageIndex(page - 1)}
          />
          <span className="home-continue__page" aria-live="polite" aria-atomic="true">
            Page {page + 1} of {pageCount}
          </span>
          <IconButton
            icon="ph:caret-right"
            className="home-continue__nav-button"
            aria-label="Next set of sessions"
            disabled={page === pageCount - 1}
            onClick={() => setPageIndex(page + 1)}
          />
        </nav>
      ) : null}
    </section>
  );
}
