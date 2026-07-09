"use client";

/**
 * HomeDigestCarousel — the home surface's two-row digest strip.
 *
 * Two stacked, subtle horizontal marquees: a CHATS row (needs-you attention
 * cards + today's summary + session cards + quick-action suggestion cards)
 * and, separated out beneath it, a MEDIA row of the freshest merged RSS
 * headlines with image thumbnails. Both auto-scroll slowly and pause on
 * hover/focus so a card can be read or clicked; they fall back to manual
 * horizontal scroll under `prefers-reduced-motion` (handled in CSS). Data is
 * assembled client-side from the existing /api/inbox, /api/board, and /api/rss
 * endpoints — no new server route. The needs-you tier itself arrives via props
 * (the SAME groupInboxFeed slice the Schedules nav badge counts, cave-925w).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { FeedItem } from "@/lib/rss";
import { openExternalUrl } from "@/lib/open-external";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useHomeNewsEnabled } from "@/lib/home-news-pref";
import { inboxKindLabel } from "@/lib/inbox-feed";
import { buildHomeSuggestions, type SuggestionCard } from "@/lib/home-suggestions";
import {
  buildDigestCards,
  type DigestCard,
  type DigestRssCard,
} from "@/lib/home-digest";

// Same kind → glyph mapping the bell popover uses, so an item reads the same
// wherever it surfaces.
function needsIcon(kind: InboxItem["kind"]): IconName {
  switch (kind) {
    case "response-needed":
      return "ph:chat-circle-dots-fill";
    case "daily-summary":
      return "ph:newspaper";
    case "agent":
      return "ph:magic-wand-fill";
    default:
      return "ph:alarm-fill";
  }
}

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  /** The "needs you" tier from groupInboxFeed — most-recent first. */
  needsYou: InboxItem[];
  /** Open one item's target (session/card) — same handler the bell uses. */
  onOpenInboxItem: (item: InboxItem) => void;
  /** See the full feed on the Schedules surface (the "+N more" card). */
  onOpenSchedules: () => void;
  /** Active project name — seasons the suggested prompts. */
  projectName: string | null;
  /** Insert a suggestion's prompt into the composer (never auto-sends). */
  onPickSuggestion: (prompt: string) => void;
};

export function HomeDigestCarousel({
  sessions,
  familiarNameById,
  onOpenSession,
  needsYou,
  onOpenInboxItem,
  onOpenSchedules,
  projectName,
  onPickSuggestion,
}: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [rss, setRss] = useState<FeedItem[]>([]);
  const [boardCards, setBoardCards] = useState<SuggestionCard[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  // News is opt-out in Settings → General (no inline dismiss on the row).
  const newsEnabled = useHomeNewsEnabled();

  // Re-derives the digest from the latest inbox + RSS and re-stamps `nowMs` so
  // the count chips and "Nm ago" labels stay current instead of freezing at
  // the value they had on first paint. allSettled keeps a failing endpoint from
  // wiping the other; a transient failure simply leaves the last-good state.
  const loadDigest = useCallback(async () => {
    const [inboxRes, rssRes] = await Promise.allSettled([
      fetch("/api/inbox", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/rss", { cache: "no-store" }).then((r) => r.json()),
    ]);
    if (inboxRes.status === "fulfilled" && Array.isArray(inboxRes.value?.items)) {
      setItems(inboxRes.value.items as InboxItem[]);
    }
    if (rssRes.status === "fulfilled" && Array.isArray(rssRes.value?.items)) {
      setRss(rssRes.value.items as FeedItem[]);
    }
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    void loadDigest().finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [loadDigest]);

  // Board tasks feed the suggestion heuristic (moved here from the old
  // HomeSuggestions pill row); a failed fetch simply leaves the curated
  // starters, so the suggestion cards never error and never go missing.
  useEffect(() => {
    let alive = true;
    fetch("/api/board", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok || !Array.isArray(j.cards)) return;
        setBoardCards(
          j.cards.map((c: SuggestionCard) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            updatedAt: c.updatedAt,
          })),
        );
      })
      .catch(() => {
        /* starters-only fallback */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Ambient "Daily summary" — refresh once a minute so reminder/session counts
  // and relative ages advance. Suspends on hidden tabs and refreshes on focus,
  // and pauses while the user is typing so this ambient refresh (+ its re-render)
  // doesn't compete with composition in the Home composer just below.
  usePausablePoll(() => { void loadDigest(); }, 60_000, { pauseWhileInputActive: true });

  const suggestions = useMemo(
    () => buildHomeSuggestions({ cards: boardCards, projectName }),
    [boardCards, projectName],
  );

  const cards = useMemo(
    () =>
      buildDigestCards({
        items,
        sessions,
        rssItems: rss,
        needsYou,
        suggestions,
        familiarNameById,
        nowMs,
      }),
    [items, sessions, rss, needsYou, suggestions, familiarNameById, nowMs],
  );

  if (!ready || cards.length === 0) return null;

  // Keep chats (needs-you + summary + sessions + suggestions) and media
  // (headlines) on separate rows so the media drifts alone, away from the chats.
  const chatCards = cards.filter((c) => c.kind !== "rss");
  const mediaCards = cards.filter((c): c is DigestRssCard => c.kind === "rss");

  return (
    <section className="home-digest" aria-label="Daily summary">
      {chatCards.length > 0 ? (
        <div className="home-digest__track" aria-label="Today's chats">
          <DigestRow
            cards={chatCards}
            onOpenSession={onOpenSession}
            onOpenInboxItem={onOpenInboxItem}
            onOpenSchedules={onOpenSchedules}
            onPickSuggestion={onPickSuggestion}
          />
          <DigestRow
            cards={chatCards}
            onOpenSession={onOpenSession}
            onOpenInboxItem={onOpenInboxItem}
            onOpenSchedules={onOpenSchedules}
            onPickSuggestion={onPickSuggestion}
            duplicate
          />
        </div>
      ) : null}
      {mediaCards.length > 0 && newsEnabled ? (
        <div className="home-digest__media">
          {/* No lane chrome — the track itself carries the accessible
              "Media headlines" name; the drift direction separates it
              visually from the chats row. */}
          <div className="home-digest__track home-digest__track--media" aria-label="Media headlines">
            <DigestRow cards={mediaCards} onOpenSession={onOpenSession} />
            <DigestRow cards={mediaCards} onOpenSession={onOpenSession} duplicate />
          </div>
        </div>
      ) : null}
    </section>
  );
}

type CardHandlers = {
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onOpenSchedules?: () => void;
  onPickSuggestion?: (prompt: string) => void;
};

function DigestRow({
  cards,
  duplicate,
  ...handlers
}: CardHandlers & {
  cards: DigestCard[];
  duplicate?: boolean;
}) {
  return (
    <ul
      className="home-digest__row"
      role={duplicate ? "presentation" : "list"}
      aria-hidden={duplicate || undefined}
    >
      {cards.map((card) => (
        <li key={(duplicate ? "dup:" : "") + card.id} className="home-digest__cell">
          <DigestCardView card={card} focusable={!duplicate} {...handlers} />
        </li>
      ))}
    </ul>
  );
}

function DigestCardView({
  card,
  onOpenSession,
  onOpenInboxItem,
  onOpenSchedules,
  onPickSuggestion,
  focusable,
}: CardHandlers & {
  card: DigestCard;
  focusable: boolean;
}) {
  const tabIndex = focusable ? undefined : -1;

  if (card.kind === "needs") {
    return (
      <button
        type="button"
        className="home-digest__card home-digest__card--needs"
        tabIndex={tabIndex}
        onClick={() => onOpenInboxItem?.(card.item)}
        title={card.title}
      >
        <Icon name={needsIcon(card.item.kind)} width={13} className="home-digest__icon" aria-hidden />
        <span className="home-digest__body">
          <span className="home-digest__title">{card.title}</span>
          <span className="home-digest__meta">Needs you · {card.meta}</span>
        </span>
        <span className="sr-only">{inboxKindLabel(card.item.kind)}</span>
      </button>
    );
  }

  if (card.kind === "needs-more") {
    return (
      <button
        type="button"
        className="home-digest__card home-digest__card--needs"
        tabIndex={tabIndex}
        onClick={() => onOpenSchedules?.()}
        title="Open Schedules"
      >
        <Icon name="ph:alarm-fill" width={13} className="home-digest__icon" aria-hidden />
        <span className="home-digest__body">
          <span className="home-digest__title">+{card.count} more need you</span>
          <span className="home-digest__meta">Open Schedules</span>
        </span>
      </button>
    );
  }

  if (card.kind === "summary") {
    return (
      <div className="home-digest__card home-digest__card--summary">
        <Icon name="ph:sparkle" width={14} className="home-digest__icon" aria-hidden />
        <span className="home-digest__body">
          <span className="home-digest__title">
            {card.title} · {card.dayLabel}
          </span>
          <span className="home-digest__meta">{card.lines.join(" · ")}</span>
        </span>
      </div>
    );
  }

  if (card.kind === "session") {
    return (
      <button
        type="button"
        className="home-digest__card home-digest__card--session"
        tabIndex={tabIndex}
        onClick={() => onOpenSession?.(card.sessionId, card.familiarId)}
        title={`Resume “${card.title}”`}
      >
        <Icon name="ph:chat-circle-dots" width={13} className="home-digest__icon" aria-hidden />
        <span className="home-digest__body">
          <span className="home-digest__title">{card.title}</span>
          {card.subtitle ? <span className="home-digest__meta">{card.subtitle}</span> : null}
        </span>
      </button>
    );
  }

  if (card.kind === "suggestion") {
    // "task:" cards resume real board work; starters are fresh prompts. The
    // icon + meta encode the difference so the track scans at a glance.
    return (
      <button
        type="button"
        className="home-digest__card home-digest__card--suggestion"
        tabIndex={tabIndex}
        onClick={() => onPickSuggestion?.(card.prompt)}
        title={card.prompt}
      >
        <Icon name={card.isTask ? "ph:kanban" : "ph:sparkle"} width={13} className="home-digest__icon" aria-hidden />
        <span className="home-digest__body">
          <span className="home-digest__title">{card.prompt}</span>
          <span className="home-digest__meta">{card.isTask ? "Resume task" : "Suggested"}</span>
        </span>
      </button>
    );
  }

  return <MediaCardView card={card} focusable={focusable} />;
}

/**
 * Media (headline) card — leads with the article's image thumbnail when the feed
 * supplied one, falling back to the newspaper icon (also on image load error).
 */
function MediaCardView({ card, focusable }: { card: DigestRssCard; focusable: boolean }) {
  const [imgError, setImgError] = useState(false);
  const showImg = Boolean(card.image) && !imgError;
  return (
    <button
      type="button"
      className="home-digest__card home-digest__card--rss home-digest__card--media"
      tabIndex={focusable ? undefined : -1}
      onClick={() => void openExternalUrl(card.url)}
      title={card.title}
    >
      {showImg ? (
        <img
          src={card.image}
          alt=""
          aria-hidden
          className="home-digest__thumb"
          onError={() => setImgError(true)}
        />
      ) : (
        <Icon name="ph:newspaper" width={13} className="home-digest__icon" aria-hidden />
      )}
      <span className="home-digest__body">
        <span className="home-digest__title">{card.title}</span>
        <span className="home-digest__meta">
          {[card.source || card.host, card.age].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
