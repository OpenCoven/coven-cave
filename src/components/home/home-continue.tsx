"use client";

// "Continue where you left off" — the hearth's resume strip (home refinement
// 2026-07-22), now a carousel (cave-9oi1s): the three-session truncation is
// replaced by click- and keyboard-controlled paging over every resumable
// session, three at a time. Each card keeps its design exactly — a mono/source
// glyph, the title, its project/source subtitle, a presence-aware "Edited N
// ago" foot, and a resume arrow — and clicking still resumes through the same
// handler the thread rail uses.
//
// Why paging rather than a scroller: the cards stack to one column at 720px,
// so a horizontally scrolling strip would be a swipe target on exactly the
// viewports where it is hardest to hit. Paging renders three buttons at any
// width, keeps the whole strip inside the viewport, and needs no scroll
// animation to respect.
//
// Focus is the load-bearing part. Cards stay in the natural tab order (all
// tabbable, as before), and arrow keys move between them; at a page edge the
// arrow turns the page and lands focus on the card that just came into view,
// so focus is never dropped on the document when the previous cards unmount.
// The pager buttons disable at the ends, so the one that disables under the
// pointer hands focus to its sibling rather than losing it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import { relativeAge } from "@/lib/rss";
import {
  HOME_CONTINUE_PAGE_SIZE,
  continuePage,
  continuePageLabel,
} from "@/lib/home-continue-paging";

export const HOME_CONTINUE_PREF_KEY = "cave:home:continue-expanded";

const CARD_SELECTOR = ".home-continue__card";

/** Newest-first sessions a person can meaningfully resume from home: not
 *  archived, not generator-spawned, and actually titled. `max` is optional —
 *  the carousel pages through all of them rather than truncating. */
export function resumableSessions(sessions: SessionRow[], max?: number): SessionRow[] {
  const ordered = sessions
    .filter((s) => !s.archived_at && !s.generated && Boolean(s.title?.trim()))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return typeof max === "number" ? ordered.slice(0, max) : ordered;
}

/** Where focus must land once the next page has rendered. The two card
 *  targets serve arrow-key paging; the two button targets rescue focus from a
 *  pager button that its own click just disabled. */
type FocusTarget = "first-card" | "last-card" | "previous-button" | "next-button";

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

export function HomeContinue({ sessions, familiarNameById, onOpenSession }: Props) {
  // Sampled once per mount — ages are coarse ("2h ago"), so a live ticker
  // would be re-render noise right next to the composer.
  const [nowMs] = useState(() => Date.now());
  const [requestedPage, setRequestedPage] = useState(0);
  // Empty until the reader turns a page: a status region populated on mount
  // would narrate the strip at every home visit.
  const [announcement, setAnnouncement] = useState("");
  const deckRef = useRef<HTMLDivElement | null>(null);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<FocusTarget | null>(null);

  const rows = useMemo(() => resumableSessions(sessions), [sessions]);
  const page = continuePage(rows.length, requestedPage);
  const pageStart = page.index * HOME_CONTINUE_PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + HOME_CONTINUE_PAGE_SIZE);
  const pageLabel = continuePageLabel(page);

  // The deck remounts on a page turn (its cards are keyed by session id), so
  // whatever had focus is gone by the time this runs. Put it back where the
  // interaction said it should be.
  useEffect(() => {
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!target) return;
    if (target === "first-card" || target === "last-card") {
      const cards = deckRef.current?.querySelectorAll<HTMLButtonElement>(CARD_SELECTOR);
      if (!cards || cards.length === 0) return;
      (target === "first-card" ? cards[0] : cards[cards.length - 1])?.focus();
      return;
    }
    pagerRef.current
      ?.querySelector<HTMLButtonElement>(
        target === "previous-button"
          ? ".home-continue__page--previous"
          : ".home-continue__page--next",
      )
      ?.focus();
  }, [page.index]);

  const goToPage = useCallback(
    (nextIndex: number, focus: FocusTarget | null) => {
      const next = continuePage(rows.length, nextIndex);
      if (next.index === page.index) return false;
      pendingFocusRef.current = focus;
      setRequestedPage(next.index);
      setAnnouncement(continuePageLabel(next));
      return true;
    },
    [page.index, rows.length],
  );

  /** A pager click that disables the clicked button must not strand focus on
   *  the document; hand it to the button that is still live. */
  const step = useCallback(
    (delta: -1 | 1) => {
      const next = continuePage(rows.length, page.index + delta);
      const disablesItself = delta === -1 ? next.index === 0 : next.index === next.count - 1;
      goToPage(
        next.index,
        disablesItself ? (delta === -1 ? "next-button" : "previous-button") : null,
      );
    },
    [goToPage, page.index, rows.length],
  );

  const onCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, positionOnPage: number) => {
      const { key } = event;
      if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
      // Arrows would scroll the page and Home/End would jump it; this strip
      // owns those keys while a card has focus.
      event.preventDefault();
      const cards = Array.from(
        deckRef.current?.querySelectorAll<HTMLButtonElement>(CARD_SELECTOR) ?? [],
      );
      if (key === "Home") {
        if (!goToPage(0, "first-card")) cards[0]?.focus();
        return;
      }
      if (key === "End") {
        if (!goToPage(page.count - 1, "last-card")) cards[cards.length - 1]?.focus();
        return;
      }
      if (key === "ArrowRight") {
        if (positionOnPage < cards.length - 1) cards[positionOnPage + 1]?.focus();
        else goToPage(page.index + 1, "first-card");
        return;
      }
      if (positionOnPage > 0) cards[positionOnPage - 1]?.focus();
      else goToPage(page.index - 1, "last-card");
    },
    [goToPage, page.count, page.index],
  );

  if (rows.length === 0 || !onOpenSession) return null;

  return (
    <section
      className="home-continue"
      aria-label="Continue where you left off"
      aria-roledescription="carousel"
    >
      {/* No visible heading (2026-07-22): the cards read as resumable sessions
          on their own — title, "Edited N ago", resume arrow — so the label is
          screen-reader-only via the section's aria-label. */}
      <div
        // Keyed by page so the entrance animation replays on every turn; the
        // cards inside are keyed by session id and would remount regardless.
        key={page.index}
        ref={deckRef}
        className="home-continue__cards"
        data-count={pageRows.length}
        data-page={page.index}
        role="group"
        aria-label={pageLabel}
      >
        {pageRows.map((s, positionOnPage) => {
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
              onKeyDown={(event) => onCardKeyDown(event, positionOnPage)}
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

      {page.count > 1 ? (
        <div className="home-continue__pager" ref={pagerRef}>
          <button
            type="button"
            className="home-continue__page home-continue__page--previous focus-ring"
            aria-label="Previous sessions"
            disabled={page.index === 0}
            onClick={() => step(-1)}
          >
            <Icon name="ph:caret-left" width={12} aria-hidden />
          </button>
          {/* The live region below carries this for screen readers, so the
              visible counter is decorative and must not be read twice. */}
          <span className="home-continue__pager-count" aria-hidden>
            {page.index + 1} / {page.count}
          </span>
          <button
            type="button"
            className="home-continue__page home-continue__page--next focus-ring"
            aria-label="More sessions"
            disabled={page.index === page.count - 1}
            onClick={() => step(1)}
          >
            <Icon name="ph:caret-right" width={12} aria-hidden />
          </button>
        </div>
      ) : null}

      <span className="home-continue__live sr-only" role="status">
        {announcement}
      </span>
    </section>
  );
}
