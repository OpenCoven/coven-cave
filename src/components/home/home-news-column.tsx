"use client";

/**
 * HomeNewsColumn — static list of the freshest AI-related headlines for the
 * home two-column footer. Reuses the pure digest builder (home-digest.ts) for
 * RSS filtering/thumbnails/ages; data comes from the existing /api/rss route.
 * Replaces the auto-scrolling media marquee.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { FeedItem } from "@/lib/rss";
import { openExternalUrl } from "@/lib/open-external";
import { buildDigestCards, type DigestRssCard } from "@/lib/home-digest";

const MAX_ROWS = 4;

export function HomeNewsColumn() {
  const [rss, setRss] = useState<FeedItem[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/rss", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.items)) setRss(j.items as FeedItem[]);
        setNowMs(Date.now());
      })
      .catch(() => {
        /* keep empty — the column simply doesn't render */
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(
    () =>
      buildDigestCards({ items: [], sessions: [], rssItems: rss, nowMs })
        .filter((c): c is DigestRssCard => c.kind === "rss")
        .slice(0, MAX_ROWS),
    [rss, nowMs],
  );

  if (!ready || cards.length === 0) return null;

  return (
    <section className="home-col" aria-label="News">
      <h2 className="home-col__label">
        <Icon name="ph:newspaper" width={12} aria-hidden /> News
      </h2>
      <ul className="home-col__list">
        {cards.map((card) => (
          <li key={card.id}>
            <NewsCard card={card} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewsCard({ card }: { card: DigestRssCard }) {
  const [imgError, setImgError] = useState(false);
  const showImg = Boolean(card.image) && !imgError;
  return (
    <button
      type="button"
      className="home-col-card focus-ring"
      onClick={() => void openExternalUrl(card.url)}
      title={card.title}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.image}
          alt=""
          aria-hidden
          className="home-col-card__thumb"
          onError={() => setImgError(true)}
        />
      ) : (
        <Icon name="ph:newspaper" width={12} className="home-col-card__icon" aria-hidden />
      )}
      <span className="home-col-card__body">
        <span className="home-col-card__title">{card.title}</span>
        <span className="home-col-card__meta">
          {[card.source || card.host, card.age].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
