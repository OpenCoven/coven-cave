"use client";

/**
 * HomeDigestCarousel — the home surface's "Daily summary" strip.
 *
 * Two stacked, subtle horizontal marquees: a CHATS row (today's summary +
 * session cards) and, separated out beneath it, a MEDIA row of the freshest
 * merged RSS headlines with image thumbnails. Both auto-scroll slowly and pause
 * on hover/focus so a card can be read or clicked; they fall back to manual
 * horizontal scroll under `prefers-reduced-motion` (handled in CSS). Data is
 * assembled client-side from the existing /api/inbox and /api/rss endpoints —
 * no new server route.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { FeedItem } from "@/lib/rss";
import { openExternalUrl } from "@/lib/open-external";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useHomeNewsEnabled } from "@/lib/home-news-pref";
import { buildDigestCards, type DigestCard, type DigestRssCard } from "@/lib/home-digest";

type Props = {
  sessions: SessionRow[];
  familiarNameById: Map<string, string>;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
};

export function HomeDigestCarousel({ sessions, familiarNameById, onOpenSession }: Props) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [rss, setRss] = useState<FeedItem[]>([]);
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

  // Ambient "Daily summary" — refresh once a minute so reminder/session counts
  // and relative ages advance. Suspends on hidden tabs and refreshes on focus,
  // and pauses while the user is typing so this ambient refresh (+ its re-render)
  // doesn't compete with composition in the Home composer just below.
  usePausablePoll(() => { void loadDigest(); }, 60_000, { pauseWhileInputActive: true });

  const cards = useMemo(
    () => buildDigestCards({ items, sessions, rssItems: rss, familiarNameById, nowMs }),
    [items, sessions, rss, familiarNameById, nowMs],
  );

  if (!ready || cards.length === 0) return null;

  // Keep chats (summary + sessions) and media (headlines) on separate rows so
  // the media drifts alone, away from the chats.
  const chatCards = cards.filter((c) => c.kind === "summary" || c.kind === "session");
  const mediaCards = cards.filter((c): c is DigestRssCard => c.kind === "rss");

  return (
    <section className="home-digest" aria-label="Daily summary">
      {chatCards.length > 0 ? (
        <div className="home-digest__track" aria-label="Today's chats">
          <DigestRow cards={chatCards} onOpenSession={onOpenSession} />
          <DigestRow cards={chatCards} onOpenSession={onOpenSession} duplicate />
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

function DigestRow({
  cards,
  onOpenSession,
  duplicate,
}: {
  cards: DigestCard[];
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
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
          <DigestCardView card={card} onOpenSession={onOpenSession} focusable={!duplicate} />
        </li>
      ))}
    </ul>
  );
}

function DigestCardView({
  card,
  onOpenSession,
  focusable,
}: {
  card: DigestCard;
  onOpenSession?: (sessionId: string, familiarId: string | null) => void;
  focusable: boolean;
}) {
  const tabIndex = focusable ? undefined : -1;

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
