import { NextResponse } from "next/server";
import { canonicalLink, cleanText, extractLinks, parseFeed } from "@/lib/rss";
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

    // rss.app bundles the timeline into "digest" items whose body lists several
    // key stories as links. Expand each story into its own row; fall back to the
    // item itself when a body has no story links.
    const STORY_RE = /(?:twitter\.com|x\.com)\/[^/]+\/status\//i;
    const seen = new Set<string>();
    const items: TweetItem[] = [];
    const add = (url: string, title: string, isoDate: string | null) => {
      if (!url || !title) return;
      const key = canonicalLink(url);
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ id: key, url, title, handle: parseTweetRef(url)?.handle ?? null, isoDate });
    };
    for (const it of parsed.items) {
      const stories = extractLinks(it.descriptionHtml ?? "").filter((l) => STORY_RE.test(l.url));
      if (stories.length > 0) {
        for (const s of stories) add(s.url, s.title, it.isoDate);
      } else {
        add(it.link, cleanText(it.title), it.isoDate);
      }
      if (items.length >= MAX_ITEMS) break;
    }

    cache = { at: now, items: items.slice(0, MAX_ITEMS) };
    return NextResponse.json({ ok: true, items: cache.items });
  } catch {
    return NextResponse.json({ ok: true, items: cache?.items ?? [] });
  }
}
