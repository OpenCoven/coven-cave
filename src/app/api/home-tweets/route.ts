import { NextResponse } from "next/server";
import { canonicalLink, cleanText, parseFeed } from "@/lib/rss";
import { parseTweetRef, type TweetItem } from "@/lib/home-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Home Tweets feed — the latest posts from the OpenCoven X/Twitter account,
 * via an rss.app RSS bridge (X has no public timeline API). The browser can't
 * fetch the feed cross-origin, so this route fetches + parses it server-side.
 *
 *   GET /api/home-tweets[?refresh=1] → { ok, items: TweetItem[] }
 *
 * The feed URL is a server constant — no request input reaches the fetch.
 */

const FEED_URL = "https://rss.app/feeds/RJweavVApIIJt0XC.xml";
const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const MAX_ITEMS = 20;

let cache: { at: number; items: TweetItem[] } | null = null;

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const now = Date.now();
  if (!refresh && cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, items: cache.items });
  }

  try {
    const res = await fetch(FEED_URL, {
      headers: {
        "User-Agent": "coven-cave/rss (+https://github.com/OpenCoven/coven-cave)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: true, items: cache?.items ?? [] });
    }
    const xml = await res.text();
    const parsed = parseFeed(xml);
    const items: TweetItem[] = parsed.items.slice(0, MAX_ITEMS).map((it, i) => ({
      id: it.link ? canonicalLink(it.link) : `tweet-${i}`,
      url: it.link,
      title: cleanText(it.title),
      handle: it.link ? (parseTweetRef(it.link)?.handle ?? null) : null,
      isoDate: it.isoDate,
    }));
    cache = { at: now, items };
    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: true, items: cache?.items ?? [] });
  }
}
