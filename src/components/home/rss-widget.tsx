"use client";

/**
 * HomeRssWidget — a compact, live feed reader on the home screen. Pulls the
 * merged RSS/Atom items from /api/rss (server fetches + parses), shows them
 * newest-first with source favicons + relative time, and opens an article in
 * Cave's in-app browser on click. Category chips filter the list; the refresh
 * button forces a re-fetch.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { faviconUrl, relativeAge, type FeedItem } from "@/lib/rss";

type Source = { id: string; title: string; category: string; ok: boolean };

type Props = {
  /** Open an article — wired to Cave's browser pane by the workspace. */
  onOpenUrl: (url: string) => void;
};

export function HomeRssWidget({ onOpenUrl }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat, setActiveCat] = useState<string>("All");
  // Recomputed each load so relative times don't drift across renders.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (opts?: { refresh?: boolean }) => {
    if (opts?.refresh) setRefreshing(true);
    else setState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch(`/api/rss${opts?.refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: FeedItem[]; sources?: Source[] };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setItems(json.items);
      setSources(Array.isArray(json.sources) ? json.sources : []);
      setNowMs(Date.now());
      setState("ready");
    } catch {
      setState((s) => (s === "ready" ? s : "error"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const it of items) if (it.category) cats.add(it.category);
    return ["All", ...[...cats].sort()];
  }, [items]);

  const visible = useMemo(
    () => (activeCat === "All" ? items : items.filter((it) => it.category === activeCat)),
    [items, activeCat],
  );

  const liveCount = sources.filter((s) => s.ok).length;

  return (
    <div className="home-composer-suggestions home-rss">
      <div className="home-rss__head">
        <span className="home-rss__title">
          <Icon name="ph:newspaper" width={15} className="home-rss__title-icon" aria-hidden />
          Latest
          {state === "ready" && liveCount > 0 ? (
            <span className="home-rss__live" title={`${liveCount} live sources`}>
              {liveCount} sources
            </span>
          ) : null}
        </span>

        {categories.length > 2 ? (
          <div className="home-rss__chips" role="tablist" aria-label="Filter by category">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={activeCat === cat}
                className={`home-rss__chip${activeCat === cat ? " is-active" : ""}`}
                onClick={() => setActiveCat(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className={`home-rss__refresh${refreshing ? " is-spinning" : ""}`}
          onClick={() => void load({ refresh: true })}
          disabled={refreshing}
          title="Refresh feeds"
          aria-label="Refresh feeds"
        >
          <Icon name="ph:arrows-clockwise-bold" width={13} aria-hidden />
        </button>
      </div>

      {state === "loading" ? (
        <ul className="home-rss__list" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="home-rss__item home-rss__item--skeleton">
              <span className="home-rss__fav home-rss__sk-dot" />
              <span className="home-rss__body">
                <span className="home-rss__sk-line" />
                <span className="home-rss__sk-line home-rss__sk-line--short" />
              </span>
            </li>
          ))}
        </ul>
      ) : state === "error" ? (
        <div className="home-rss__empty">
          <Icon name="ph:warning-circle" width={18} aria-hidden />
          <span>Couldn’t load feeds.</span>
          <button type="button" className="home-rss__retry" onClick={() => void load({ refresh: true })}>
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="home-rss__empty">
          <Icon name="ph:newspaper" width={18} aria-hidden />
          <span>No stories yet.</span>
        </div>
      ) : (
        <ul className="home-rss__list">
          {visible.map((it) => {
            const fav = it.link ? faviconUrl(it.link) : null;
            const age = relativeAge(it.isoDate, nowMs);
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className="home-rss__item"
                  onClick={() => it.link && onOpenUrl(it.link)}
                  title={it.title}
                >
                  {fav ? (
                    <img
                      className="home-rss__fav"
                      src={fav}
                      alt=""
                      width={16}
                      height={16}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <span className="home-rss__fav" />
                  )}
                  <span className="home-rss__body">
                    <span className="home-rss__item-title">{it.title}</span>
                    <span className="home-rss__meta">
                      <span className="home-rss__source">{it.source}</span>
                      {age ? <span className="home-rss__time">· {age}</span> : null}
                    </span>
                  </span>
                  <Icon name="ph:arrow-square-out" width={13} className="home-rss__open" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
