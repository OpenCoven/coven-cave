"use client";

/**
 * HomeFeed — the home surface's content feed, replacing the old RSS/world-news
 * widget. Three tabs:
 *   • Videos — latest YouTube uploads across a curated channel set (/api/youtube)
 *   • Tweets — a user-curated set of X posts, embedded (/api/home-tweets)
 *   • Repos  — your recently-pushed GitHub repos, or trending (/api/github/repos)
 *
 * Each tab lazy-loads on first view and opens links in Cave's in-app browser.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  compactAge,
  formatStars,
  youtubeThumbnail,
  type FeedTab,
  type VideoItem,
  type RepoItem,
  type TweetItem,
} from "@/lib/home-feed";

type Props = {
  /** Open a link — wired to Cave's browser pane by the workspace. */
  onOpenUrl: (url: string) => void;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const TABS: { id: FeedTab; label: string; icon: string }[] = [
  { id: "videos", label: "Videos", icon: "ph:video" },
  { id: "tweets", label: "Tweets", icon: "ph:twitter-logo" },
  { id: "repos", label: "Repos", icon: "ph:github-logo" },
];

declare global {
  interface Window {
    twttr?: { widgets?: { load?: (el?: HTMLElement) => void } };
  }
}

export function HomeFeed({ onOpenUrl }: Props) {
  const [tab, setTab] = useState<FeedTab>("videos");
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Per-tab data + state, loaded lazily on first activation.
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videoState, setVideoState] = useState<LoadState>("idle");
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [repoState, setRepoState] = useState<LoadState>("idle");
  const [reposSource, setReposSource] = useState<"yours" | "trending" | null>(null);
  const [tweets, setTweets] = useState<TweetItem[]>([]);
  const [tweetState, setTweetState] = useState<LoadState>("idle");

  const loadVideos = useCallback(async (refresh?: boolean) => {
    setVideoState((s) => (s === "ready" && !refresh ? s : "loading"));
    try {
      const res = await fetch(`/api/youtube${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: VideoItem[] };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setVideos(json.items);
      setNowMs(Date.now());
      setVideoState("ready");
    } catch {
      setVideoState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  const loadRepos = useCallback(async () => {
    setRepoState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: RepoItem[]; source?: "yours" | "trending" };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setRepos(json.items);
      setReposSource(json.source ?? null);
      setNowMs(Date.now());
      setRepoState("ready");
    } catch {
      setRepoState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  const loadTweets = useCallback(async () => {
    setTweetState((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch("/api/home-tweets", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; items?: TweetItem[] };
      if (!json.ok || !Array.isArray(json.items)) throw new Error("bad payload");
      setTweets(json.items);
      setTweetState("ready");
    } catch {
      setTweetState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  // Lazy-load whichever tab is active, once.
  useEffect(() => {
    if (tab === "videos" && videoState === "idle") void loadVideos();
    if (tab === "repos" && repoState === "idle") void loadRepos();
    if (tab === "tweets" && tweetState === "idle") void loadTweets();
  }, [tab, videoState, repoState, tweetState, loadVideos, loadRepos, loadTweets]);

  const refresh = useCallback(() => {
    if (tab === "videos") void loadVideos(true);
    if (tab === "repos") { setRepoState("idle"); void loadRepos(); }
    if (tab === "tweets") { setTweetState("idle"); void loadTweets(); }
  }, [tab, loadVideos, loadRepos, loadTweets]);

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

      {tab === "videos" ? (
        <VideosTab state={videoState} items={videos} nowMs={nowMs} onOpenUrl={onOpenUrl} onRetry={() => void loadVideos(true)} />
      ) : tab === "repos" ? (
        <ReposTab state={repoState} items={repos} source={reposSource} nowMs={nowMs} onOpenUrl={onOpenUrl} onRetry={() => void loadRepos()} />
      ) : (
        <TweetsTab state={tweetState} items={tweets} onChanged={loadTweets} onOpenUrl={onOpenUrl} />
      )}
    </div>
  );
}

// ── Videos ────────────────────────────────────────────────────────────────────
function VideosTab({
  state,
  items,
  nowMs,
  onOpenUrl,
  onRetry,
}: {
  state: LoadState;
  items: VideoItem[];
  nowMs: number;
  onOpenUrl: (url: string) => void;
  onRetry: () => void;
}) {
  if (state === "loading" || state === "idle") {
    return (
      <div className="home-feed__videos" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="home-feed__vcard home-feed__vcard--skeleton">
            <span className="home-feed__vthumb home-feed__sk" />
            <span className="home-feed__sk-line" />
          </div>
        ))}
      </div>
    );
  }
  if (state === "error") return <FeedError label="Couldn’t load videos." onRetry={onRetry} />;
  if (items.length === 0) return <FeedEmpty icon="ph:video" text="No videos yet." />;
  return (
    <div className="home-feed__videos">
      {items.map((v) => (
        <button
          key={v.id}
          type="button"
          className="home-feed__vcard"
          onClick={() => onOpenUrl(v.url)}
          title={v.title}
        >
          <span className="home-feed__vthumb">
            {v.videoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={youtubeThumbnail(v.videoId)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <Icon name="ph:video" width={22} aria-hidden />
            )}
            <span className="home-feed__vplay"><Icon name="ph:play-fill" width={13} aria-hidden /></span>
          </span>
          <span className="home-feed__vtitle">{v.title}</span>
          <span className="home-feed__vmeta">
            <span className="home-feed__vchannel">{v.channel}</span>
            {compactAge(v.isoDate, nowMs) ? <span>· {compactAge(v.isoDate, nowMs)}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Repos ─────────────────────────────────────────────────────────────────────
function ReposTab({
  state,
  items,
  source,
  nowMs,
  onOpenUrl,
  onRetry,
}: {
  state: LoadState;
  items: RepoItem[];
  source: "yours" | "trending" | null;
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
  if (items.length === 0) return <FeedEmpty icon="ph:github-logo" text="No repositories found." />;
  return (
    <>
      {source === "trending" ? (
        <p className="home-feed__note">Trending — add a GitHub token in Settings to see your repos.</p>
      ) : null}
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
    </>
  );
}

// ── Tweets ──────────────────────────────────────────────────────────────────
function TweetsTab({
  state,
  items,
  onChanged,
  onOpenUrl,
}: {
  state: LoadState;
  items: TweetItem[];
  onChanged: () => Promise<void> | void;
  onOpenUrl: (url: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load Twitter's widget script once, then (re)render embeds when the list changes.
  useEffect(() => {
    if (items.length === 0) return;
    const SRC = "https://platform.twitter.com/widgets.js";
    const reload = () => window.twttr?.widgets?.load?.(containerRef.current ?? undefined);
    if (window.twttr?.widgets?.load) {
      reload();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SRC;
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener("load", reload, { once: true });
    return () => script?.removeEventListener("load", reload);
  }, [items]);

  const add = useCallback(async () => {
    const url = draft.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/home-tweets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Couldn’t add that post");
      setDraft("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t add that post");
    } finally {
      setBusy(false);
    }
  }, [draft, onChanged]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/home-tweets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await onChanged();
  }, [onChanged]);

  return (
    <div className="home-feed__tweets">
      <div className="home-feed__tweet-add">
        <input
          type="url"
          className="home-feed__tweet-input"
          placeholder="Paste an X / Twitter post URL…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          aria-label="X post URL"
        />
        <button type="button" className="home-feed__tweet-addbtn" onClick={() => void add()} disabled={busy || !draft.trim()}>
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error ? <p className="home-feed__note home-feed__note--err">{error}</p> : null}

      {state === "loading" ? (
        <FeedEmpty icon="ph:twitter-logo" text="Loading…" />
      ) : items.length === 0 ? (
        <FeedEmpty icon="ph:twitter-logo" text="No posts yet — paste an X URL above to pin one here." />
      ) : (
        <div className="home-feed__tweet-list" ref={containerRef}>
          {items.map((t) => (
            <div key={t.id} className="home-feed__tweet">
              <button
                type="button"
                className="home-feed__tweet-remove"
                onClick={() => void remove(t.id)}
                aria-label="Remove post"
                title="Remove"
              >
                <Icon name="ph:x" width={12} aria-hidden />
              </button>
              <blockquote className="twitter-tweet" data-dnt="true" data-theme="dark">
                <a href={t.url}>{t.handle ?? t.url}</a>
              </blockquote>
              {/* Fallback shown until/unless the embed script upgrades the blockquote. */}
              <button type="button" className="home-feed__tweet-open" onClick={() => onOpenUrl(t.url)}>
                Open on X <Icon name="ph:arrow-square-out" width={11} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
