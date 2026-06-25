import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";

/** A YouTube channel to surface in the home Videos feed. Channel ids are
 *  SERVER-controlled — built-in defaults or the user's local override file —
 *  never taken from a request, so the feed fetch has no SSRF surface. */
export type YoutubeChannel = {
  id: string;
  title: string;
  /** UC… channel id used to build the public Atom feed URL. */
  channelId: string;
};

/** Curated, reliable default channels (dev/AI). Users can fully override via
 *  `~/.coven/youtube-channels.json`. A wrong/dead channel id simply yields no
 *  items (the route tolerates per-feed failures), so this is best-effort. */
export const DEFAULT_CHANNELS: YoutubeChannel[] = [
  { id: "fireship", title: "Fireship", channelId: "UCsBjURrPoezykLs9EqgamOA" },
  { id: "twominute", title: "Two Minute Papers", channelId: "UCbfYPyITQ-7l4upoX8nvctg" },
  { id: "lex", title: "Lex Fridman", channelId: "UCSHZKyawb77ixDdsGog4iWA" },
  { id: "yc", title: "Y Combinator", channelId: "UCcefcZRL2oaA_uBNeo5UOWg" },
  { id: "vercel", title: "Vercel", channelId: "UCLq8gNoee7oXM7MvTdjyQvA" },
];

/** Public Atom feed URL for a channel — parsed by the shared rss parseFeed(). */
export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function configPath(): string {
  return path.join(covenHome(), "youtube-channels.json");
}

function coerce(raw: unknown, index: number): YoutubeChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const channelId = typeof r.channelId === "string" ? r.channelId.trim() : "";
  // Channel ids are `UC` + 22 url-safe chars; reject anything else.
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return null;
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : channelId;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `chan-${index}`;
  return { id, title, channelId };
}

/**
 * Resolve the channel list. When `~/.coven/youtube-channels.json` exists and
 * parses to a non-empty array of valid channels, it fully replaces the defaults.
 * Otherwise the built-in defaults are used. Always returns at least one channel.
 */
export async function resolveChannels(): Promise<YoutubeChannel[]> {
  let raw: string;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch {
    return DEFAULT_CHANNELS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { channels?: unknown })?.channels)
        ? (parsed as { channels: unknown[] }).channels
        : [];
    const channels = list.map(coerce).filter((c): c is YoutubeChannel => c !== null);
    return channels.length > 0 ? channels : DEFAULT_CHANNELS;
  } catch {
    return DEFAULT_CHANNELS;
  }
}
