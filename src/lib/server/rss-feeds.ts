import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { isSafeHttpUrl } from "@/lib/url-safety";

/** A configured source feed. URLs here are SERVER-controlled — either the
 *  built-in defaults below or the user's own `~/.coven/rss-feeds.json` — never
 *  taken from an HTTP request, so the fetch in /api/rss has no SSRF surface. */
export type FeedSource = {
  id: string;
  title: string;
  url: string;
  category: string;
};

/** Curated, reliable defaults across a few categories. Users can fully override
 *  this set by dropping their own list in `~/.coven/rss-feeds.json`. */
export const DEFAULT_FEEDS: FeedSource[] = [
  { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", category: "Tech" },
  { id: "verge", title: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Tech" },
  { id: "ars", title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Tech" },
  { id: "hf", title: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", category: "AI" },
  { id: "mit-tr", title: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", category: "AI" },
  { id: "gh-blog", title: "GitHub Blog", url: "https://github.blog/feed/", category: "Dev" },
  { id: "smashing", title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", category: "Design" },
  { id: "bbc-world", title: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "World" },
];

function feedConfigPath(): string {
  return path.join(covenHome(), "rss-feeds.json");
}

/** Validate + normalize a single user-supplied feed entry. */
function coerceFeed(raw: unknown, index: number): FeedSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!isSafeHttpUrl(url)) return null;
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : url;
  const category = typeof r.category === "string" && r.category.trim() ? r.category.trim() : "Feeds";
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `feed-${index}`;
  return { id, title, url, category };
}

/**
 * Resolve the feed list. When `~/.coven/rss-feeds.json` exists and parses to a
 * non-empty array of valid feeds, it fully replaces the defaults (so users can
 * curate). Otherwise the built-in defaults are used. Always returns at least
 * one feed.
 */
export async function resolveFeeds(): Promise<FeedSource[]> {
  let raw: string;
  try {
    raw = await readFile(feedConfigPath(), "utf8");
  } catch {
    return DEFAULT_FEEDS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { feeds?: unknown })?.feeds)
        ? (parsed as { feeds: unknown[] }).feeds
        : [];
    const feeds = list.map(coerceFeed).filter((f): f is FeedSource => f !== null);
    return feeds.length > 0 ? feeds : DEFAULT_FEEDS;
  } catch {
    return DEFAULT_FEEDS;
  }
}
