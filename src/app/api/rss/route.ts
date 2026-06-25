import { NextResponse } from "next/server";
import { canonicalLink, mergeFeedItems, parseFeed, type FeedItem } from "@/lib/rss";
import { resolveFeeds, type FeedSource } from "@/lib/server/rss-feeds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/rss → { ok, items, sources, fetchedAt }
 *
 * Fetches the configured RSS/Atom feeds server-side (the browser can't, due to
 * CORS), merges + sorts them newest-first, and returns a flat item list plus
 * the source list for the widget's filter chips. Pass `?refresh=1` to bypass
 * the short server cache.
 *
 * The fetched URLs come exclusively from `resolveFeeds()` (built-in defaults or
 * the user's local `~/.coven/rss-feeds.json`) — never from the request — so
 * there is no request-driven SSRF surface here.
 */

const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const MAX_ITEMS = 40;
const PER_FEED_ITEMS = 12;

type RssPayload = {
  ok: true;
  items: FeedItem[];
  sources: Array<{ id: string; title: string; category: string; ok: boolean }>;
  fetchedAt: string;
};

let cache: { at: number; body: RssPayload } | null = null;

async function fetchOne(feed: FeedSource): Promise<{ source: FeedSource; items: FeedItem[]; ok: boolean }> {
  try {
    const res = await fetch(feed.url, {
      headers: {
        // Some hosts reject the default fetch agent or non-feed Accept headers.
        "User-Agent": "coven-cave/rss (+https://github.com/OpenCoven/coven-cave)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { source: feed, items: [], ok: false };
    const xml = await res.text();
    const parsed = parseFeed(xml);
    const items: FeedItem[] = parsed.items.slice(0, PER_FEED_ITEMS).map((it, i) => ({
      ...it,
      id: it.link ? `${feed.id}:${canonicalLink(it.link)}` : `${feed.id}-${i}`,
      source: feed.title,
      category: feed.category,
    }));
    return { source: feed, items, ok: true };
  } catch {
    return { source: feed, items: [], ok: false };
  }
}

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const now = Date.now();
  if (!refresh && cache && now - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const feeds = await resolveFeeds();
  const results = await Promise.all(feeds.map(fetchOne));

  const items = mergeFeedItems(
    results.map((r) => r.items),
    MAX_ITEMS,
  );
  const sources = results.map((r) => ({
    id: r.source.id,
    title: r.source.title,
    category: r.source.category,
    ok: r.ok,
  }));

  const body: RssPayload = { ok: true, items, sources, fetchedAt: new Date(now).toISOString() };
  cache = { at: now, body };
  return NextResponse.json(body);
}
