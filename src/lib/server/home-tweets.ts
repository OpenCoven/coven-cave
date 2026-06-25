import { readFile } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import { parseTweetRef, type TweetItem } from "@/lib/home-feed";

// Configured tweets/X posts to embed on the home Tweets feed. X has no free
// read API, so this is a small user-curated list of post URLs stored locally.

const MAX_TWEETS = 50;

function storePath(): string {
  return path.join(covenHome(), "home-tweets.json");
}

function refToItem(ref: NonNullable<ReturnType<typeof parseTweetRef>>): TweetItem {
  return { id: ref.statusId ?? ref.url, url: ref.url, handle: ref.handle };
}

export async function listTweets(): Promise<TweetItem[]> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { tweets?: unknown })?.tweets)
        ? (parsed as { tweets: unknown[] }).tweets
        : [];
    const out: TweetItem[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
      const url = typeof entry === "string" ? entry : (entry as { url?: unknown })?.url;
      if (typeof url !== "string") continue;
      const ref = parseTweetRef(url);
      if (!ref || seen.has(ref.url)) continue;
      seen.add(ref.url);
      out.push(refToItem(ref));
    }
    return out;
  } catch {
    return [];
  }
}

async function persist(items: TweetItem[]): Promise<void> {
  await writeJsonAtomic(storePath(), { tweets: items.map((t) => ({ url: t.url })) });
}

export async function addTweet(url: string): Promise<{ ok: boolean; item?: TweetItem; error?: string }> {
  const ref = parseTweetRef(url);
  if (!ref) return { ok: false, error: "Not a valid X/Twitter post URL" };
  const items = await listTweets();
  if (items.some((t) => t.url === ref.url)) {
    return { ok: true, item: refToItem(ref) }; // idempotent — already present
  }
  if (items.length >= MAX_TWEETS) return { ok: false, error: "Too many tweets configured" };
  const item = refToItem(ref);
  // Newest first.
  await persist([item, ...items]);
  return { ok: true, item };
}

export async function removeTweet(id: string): Promise<boolean> {
  const items = await listTweets();
  const next = items.filter((t) => t.id !== id && t.url !== id);
  if (next.length === items.length) return false;
  await persist(next);
  return true;
}
