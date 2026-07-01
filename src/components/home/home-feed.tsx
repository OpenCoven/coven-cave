"use client";

/**
 * HomeFeed — the home surface's content feed. Two tabs:
 *   • Tweets — latest posts from the OpenCoven X account, via an rss.app RSS
 *     bridge parsed server-side (/api/home-tweets)
 *   • Repos  — the curated "opencoven-openclaw" GitHub star list, OpenCoven org
 *     repos first (/api/github/repos)
 *
 * Each tab lazy-loads on first view and opens links in Cave's in-app browser.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  compactAge,
  formatStars,
  type FeedTab,
  type RepoItem,
  type TweetItem,
} from "@/lib/home-feed";

type Props = {
  /** Open a link — wired to Cave's browser pane by the workspace. */
  onOpenUrl: (url: string) => void;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const TABS: { id: FeedTab; label: string; icon: string }[] = [
  { id: "tweets", label: "Tweets", icon: "ph:twitter-logo" },
  { id: "repos", label: "Repos", icon: "ph:github-logo" },
];

export function HomeFeed({ onOpenUrl }: Props) {
  const [tab, setTab] = useState<FeedTab>("tweets");
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Per-tab data + state, loaded lazily on first activation.
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [repoState, setRepoState] = useState<LoadState>("idle");
  const [reposConfigured, setReposConfigured] = useState(true);
  const [tweets, setTweets] = useState<TweetItem[]>([]);
  const [tweetState, setTweetState] = useState<LoadState>("idle");

  const loadRepos = useCallback(async () => {
    setRepoState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: RepoItem[]; configured?: boolean };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setRepos(json.items);
      setReposConfigured(json.configured !== false);
      setNowMs(Date.now());
      setRepoState("ready");
    } catch {
      setRepoState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  const loadTweets = useCallback(async (refresh?: boolean) => {
    setTweetState((s) => (s === "ready" && !refresh ? s : "loading"));
    try {
      const res = await fetch(`/api/home-tweets${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: TweetItem[] };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setTweets(json.items);
      setNowMs(Date.now());
      setTweetState("ready");
    } catch {
      setTweetState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  // Lazy-load whichever tab is active, once.
  useEffect(() => {
    if (tab === "repos" && repoState === "idle") void loadRepos();
    if (tab === "tweets" && tweetState === "idle") void loadTweets();
  }, [tab, repoState, tweetState, loadRepos, loadTweets]);

  // Re-stamp `nowMs` once a minute so the "pushed Nm ago" / tweet-age labels
  // advance instead of freezing at the value from the last load. Cheap; the
  // feed data itself stays user-refreshed via the refresh button.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => {
    if (tab === "repos") { setRepoState("idle"); void loadRepos(); }
    if (tab === "tweets") void loadTweets(true);
  }, [tab, loadRepos, loadTweets]);

  return (
    <div className="home-composer-suggestions home-feed">
      <div className="home-feed__head">
        <div className="home-feed__tabs" role="tablist" aria-label="Home feed">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`home-feed__tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon as never} width={14} aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="home-feed__refresh"
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh feed"
        >
          <Icon name="ph:arrows-clockwise-bold" width={13} aria-hidden />
        </button>
      </div>

      {tab === "repos" ? (
        <ReposTab state={repoState} items={repos} configured={reposConfigured} nowMs={nowMs} onOpenUrl={onOpenUrl} onRetry={() => void loadRepos()} />
      ) : (
        <TweetsTab state={tweetState} items={tweets} nowMs={nowMs} onOpenUrl={onOpenUrl} onRetry={() => void loadTweets(true)} />
      )}
    </div>
  );
}

// ── Repos (curated star list, OpenCoven org first) ────────────────────────────
function ReposTab({
  state,
  items,
  configured,
  nowMs,
  onOpenUrl,
  onRetry,
}: {
  state: LoadState;
  items: RepoItem[];
  configured: boolean;
  nowMs: number;
  onOpenUrl: (url: string) => void;
  onRetry: () => void;
}) {
  if (state === "loading" || state === "idle") {
    return (
      <ul className="home-feed__list" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="home-feed__row home-feed__row--skeleton">
            <span className="home-feed__sk-line" />
            <span className="home-feed__sk-line home-feed__sk-line--short" />
          </li>
        ))}
      </ul>
    );
  }
  if (state === "error") return <FeedError label="Couldn’t load repos." onRetry={onRetry} />;
  if (!configured) {
    return <FeedEmpty icon="ph:github-logo" text="Add a GitHub token in Settings to see your starred list." />;
  }
  if (items.length === 0) return <FeedEmpty icon="ph:github-logo" text="No repositories in the list yet." />;
  return (
    <ul className="home-feed__list">
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" className="home-feed__row" onClick={() => onOpenUrl(r.url)} title={r.fullName}>
            <span className="home-feed__rowtop">
              <Icon name="ph:git-fork" width={13} className="home-feed__rowicon" aria-hidden />
              <span className="home-feed__rowtitle">{r.fullName}</span>
            </span>
            {r.description ? <span className="home-feed__rowdesc">{r.description}</span> : null}
            <span className="home-feed__rowmeta">
              {r.language ? <span className="home-feed__lang">{r.language}</span> : null}
              <span className="home-feed__stars">★ {formatStars(r.stars)}</span>
              {compactAge(r.pushedAt, nowMs) ? <span>· pushed {compactAge(r.pushedAt, nowMs)} ago</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Tweets (latest OpenCoven posts via rss.app) ───────────────────────────────
function TweetsTab({
  state,
  items,
  nowMs,
  onOpenUrl,
  onRetry,
}: {
  state: LoadState;
  items: TweetItem[];
  nowMs: number;
  onOpenUrl: (url: string) => void;
  onRetry: () => void;
}) {
  if (state === "loading" || state === "idle") {
    return (
      <ul className="home-feed__list" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="home-feed__row home-feed__row--skeleton">
            <span className="home-feed__sk-line" />
            <span className="home-feed__sk-line home-feed__sk-line--short" />
          </li>
        ))}
      </ul>
    );
  }
  if (state === "error") return <FeedError label="Couldn’t load posts." onRetry={onRetry} />;
  if (items.length === 0) return <FeedEmpty icon="ph:twitter-logo" text="No posts yet." />;
  return (
    <ul className="home-feed__list">
      {items.map((t) => (
        <li key={t.id}>
          <button type="button" className="home-feed__row" onClick={() => t.url && onOpenUrl(t.url)} title={t.title}>
            <span className="home-feed__rowtop">
              <Icon name="ph:twitter-logo" width={13} className="home-feed__rowicon" aria-hidden />
              <span className="home-feed__rowtitle">{t.title}</span>
            </span>
            <span className="home-feed__rowmeta">
              {t.handle ? <span className="home-feed__lang">{t.handle}</span> : null}
              {compactAge(t.isoDate, nowMs) ? <span>· {compactAge(t.isoDate, nowMs)}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Shared small states ───────────────────────────────────────────────────────
function FeedEmpty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="home-feed__empty">
      <Icon name={icon as never} width={18} aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function FeedError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="home-feed__empty">
      <Icon name="ph:warning-circle" width={18} aria-hidden />
      <span>{label}</span>
      <button type="button" className="home-feed__retry" onClick={onRetry}>Try again</button>
    </div>
  );
}
