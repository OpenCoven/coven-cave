import { NextResponse } from "next/server";
import { parseFeed } from "@/lib/rss";
import { parseYoutubeVideoId, type VideoItem } from "@/lib/home-feed";
import { resolveChannels, channelFeedUrl, type YoutubeChannel } from "@/lib/server/youtube-feeds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/youtube → { ok, items: VideoItem[], fetchedAt }
 *
 * Fetches each configured channel's public Atom feed server-side (the browser
 * can't, due to CORS), parses with the shared rss parseFeed(), and returns a
 * merged newest-first video list for the home Videos feed. Pass `?refresh=1`
 * to bypass the short server cache.
 *
 * Fetched URLs come only from resolveChannels() (defaults or the user's local
 * `~/.coven/youtube-channels.json`) — never from the request — so no SSRF.
 */

const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const PER_CHANNEL = 6;
const MAX_ITEMS = 30;

type Payload = { ok: true; items: VideoItem[]; fetchedAt: string };

let cache: { at: number; body: Payload } | null = null;

async function fetchChannel(chan: YoutubeChannel): Promise<VideoItem[]> {
  try {
    const res = await fetch(channelFeedUrl(chan.channelId), {
      headers: {
        "User-Agent": "coven-cave/youtube (+https://github.com/OpenCoven/coven-cave)",
        Accept: "application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = parseFeed(xml);
    return parsed.items.slice(0, PER_CHANNEL).map((it, i) => {
      const videoId = parseYoutubeVideoId(it.link);
      return {
        id: videoId ?? `${chan.id}-${i}`,
        title: it.title,
        channel: chan.title,
        videoId,
        url: it.link,
        isoDate: it.isoDate,
      } satisfies VideoItem;
    });
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  const channels = await resolveChannels();
  const groups = await Promise.all(channels.map(fetchChannel));
  const items = groups
    .flat()
    .sort((a, b) => (b.isoDate ?? "").localeCompare(a.isoDate ?? ""))
    .slice(0, MAX_ITEMS);

  const body: Payload = { ok: true, items, fetchedAt: new Date().toISOString() };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
