"use client";

/**
 * HomeDigestCarousel — the home surface's "Daily summary" strip.
 *
 * A continuous, subtle horizontal marquee of today's activity (a summary card +
 * session cards) followed by the freshest merged RSS headlines. The marquee
 * auto-scrolls and pauses on hover/focus so a card can be read or clicked; it
 * falls back to a manual horizontal scroll under `prefers-reduced-motion`
 * (handled in CSS). Data is assembled client-side from the existing /api/inbox
 * and /api/rss endpoints — no new server route.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { FeedItem } from "@/lib/rss";
import { openExternalUrl } from "@/lib/open-external";
import { buildDigestCards, type DigestCard } from "@/lib/home-digest";

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

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [inboxRes, rssRes] = await Promise.allSettled([
        fetch("/api/inbox", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/rss", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!alive) return;
      if (inboxRes.status === "fulfilled" && Array.isArray(inboxRes.value?.items)) {
        setItems(inboxRes.value.items as InboxItem[]);
      }
      if (rssRes.status === "fulfilled" && Array.isArray(rssRes.value?.items)) {
        setRss(rssRes.value.items as FeedItem[]);
      }
      setNowMs(Date.now());
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(
    () => buildDigestCards({ items, sessions, rssItems: rss, familiarNameById, nowMs }),
    [items, sessions, rss, familiarNameById, nowMs],
  );

  if (!ready || cards.length === 0) return null;

  return (
    <section className="home-digest" aria-label="Daily summary">
      {/* The track holds two identical rows so the marquee loops seamlessly at
          -50%. The second row is a presentational duplicate, hidden from a11y. */}
      <div className="home-digest__track">
        <DigestRow cards={cards} onOpenSession={onOpenSession} />
        <DigestRow cards={cards} onOpenSession={onOpenSession} duplicate />
      </div>
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

  return (
    <button
      type="button"
      className="home-digest__card home-digest__card--rss"
      tabIndex={tabIndex}
      onClick={() => void openExternalUrl(card.url)}
      title={card.title}
    >
      <Icon name="ph:newspaper" width={13} className="home-digest__icon" aria-hidden />
      <span className="home-digest__body">
        <span className="home-digest__title">{card.title}</span>
        <span className="home-digest__meta">
          {[card.source || card.host, card.age].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
