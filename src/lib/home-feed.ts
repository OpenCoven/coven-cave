// Home feed — shared client-safe types + helpers for the home surface's
// content feed (Tweets · Repos), which replaces the old RSS widget.
// Pure / framework-free (no node imports) so the browser components and the
// server routes can share it.

export type FeedTab = "tweets" | "repos";

/** A GitHub repository, from /api/github/repos. */
export type RepoItem = {
  /** Stable key — the `owner/name` full name. */
  id: string;
  name: string;
  owner: string;
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  url: string;
  /** ISO timestamp of the last push (for "active Nd ago"). */
  pushedAt: string | null;
};

/** A post from the X/Twitter RSS feed (rss.app), from /api/home-tweets. */
export type TweetItem = {
  /** Stable key — the canonical link (falls back to the title). */
  id: string;
  /** The post URL. */
  url: string;
  /** Post title/headline (cleaned of markup). */
  title: string;
  /** @handle parsed from the url/feed, when present. */
  handle: string | null;
  /** ISO publish timestamp, when present. */
  isoDate: string | null;
};

/** Parse @handle + status id from a tweet/X URL. Normalizes host to x.com. */
export function parseTweetRef(raw: string): { url: string; handle: string | null; statusId: string | null } | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "twitter.com" && host !== "x.com") return null;
  const parts = url.pathname.replace(/^\//, "").split("/");
  const handle = parts[0] && parts[0] !== "i" ? `@${parts[0]}` : null;
  const statusIdx = parts.indexOf("status");
  const statusId = statusIdx >= 0 && /^\d+$/.test(parts[statusIdx + 1] ?? "") ? parts[statusIdx + 1] : null;
  // Canonicalize to x.com, strip query/fragment (tracking params).
  const clean = `https://x.com/${parts.filter(Boolean).join("/")}`;
  return { url: clean, handle, statusId };
}

/** Compact "3d", "5h", "12m" relative age — duplicated tiny helper (rss.ts has
 *  one too, but home-feed must stay node-import-free for its server routes). */
export function compactAge(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const secs = Math.max(0, Math.round((nowMs - t) / 1000));
  if (secs < 60) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

/** Compact star count: 1500 → "1.5k", 23000 → "23k". */
export function formatStars(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
