/**
 * Tiny dependency-free RSS 2.0 / Atom parser + feed helpers.
 *
 * The app ships no XML parser, and pulling one in for a single widget isn't
 * worth the bundle. Feeds are simple and well-formed enough that a focused
 * regex extractor handles RSS `<item>` and Atom `<entry>` reliably, including
 * CDATA, HTML entities, and the Atom `<link href>` form. Everything here is
 * pure so it unit-tests without a network or DOM (see rss.test.ts).
 */

export type ParsedFeedItem = {
  title: string;
  link: string;
  /** Normalized ISO-8601 timestamp, or null when the feed omitted/garbled it. */
  isoDate: string | null;
};

export type ParsedFeed = {
  title: string | null;
  items: ParsedFeedItem[];
};

/** A merged, display-ready item annotated with its source feed. */
export type FeedItem = ParsedFeedItem & {
  /** Stable key — the canonicalized link (falls back to the title). */
  id: string;
  /** Human source label (the feed's configured title). */
  source: string;
  /** Optional grouping label for the filter chips. */
  category?: string;
};

// ─── Entity + tag helpers ────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the handful of XML/HTML entities that show up in feed titles. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Unwrap CDATA, decode entities, strip residual markup, and collapse runs of
 *  whitespace to single spaces. Safe on plain text too.
 *
 *  Order matters: entities are decoded *before* tags are stripped, so an encoded
 *  `&lt;script&gt;` can't survive stripping as live markup; and the strip runs to
 *  a fixed point, since removing one tag can re-expose a nested one
 *  (`<scr<i>ipt>` → `<script>`). */
export function cleanText(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  let text = decodeEntities(withoutCdata);
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== prev);
  return text.replace(/\s+/g, " ").trim();
}

/** Inner text of the first `<tag>…</tag>` in `block` (attributes allowed),
 *  cleaned. Namespaced names like `dc:date` are matched literally. */
function firstTagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeTag(tag)}>`, "i");
  const m = re.exec(block);
  return m ? cleanText(m[1]) : null;
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First non-empty result among several candidate tags. */
function firstOfTags(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const value = firstTagText(block, tag);
    if (value) return value;
  }
  return null;
}

/** Resolve an item's link. RSS uses `<link>text</link>`; Atom uses
 *  `<link href="…" rel="alternate"/>` — prefer rel="alternate" (or no rel),
 *  and an html type when several links are present. */
function extractLink(block: string): string {
  const rssLink = firstTagText(block, "link");
  if (rssLink && /^https?:\/\//i.test(rssLink)) return rssLink;

  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => parseAttrs(m[1]));
  if (links.length === 0) return rssLink ?? "";
  const score = (a: Record<string, string>) =>
    (a.rel === undefined || a.rel === "alternate" ? 2 : 0) + (/(html)/i.test(a.type ?? "") ? 1 : 0);
  const best = [...links].sort((a, b) => score(b) - score(a))[0];
  return best?.href ?? rssLink ?? "";
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

/** Normalize an RFC-822 (`pubDate`) or ISO-8601 (`updated`) date to ISO, or
 *  null when unparseable. */
export function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ─── Feed parsing ────────────────────────────────────────────────────────────

/** Parse a feed document (RSS 2.0 or Atom) into normalized items. Resilient to
 *  the common shapes; returns an empty item list rather than throwing. */
export function parseFeed(xml: string): ParsedFeed {
  if (typeof xml !== "string" || xml.length === 0) return { title: null, items: [] };

  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blockRe = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;

  // Feed title lives in the header, before the first item/entry.
  const headEnd = xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = headEnd >= 0 ? xml.slice(0, headEnd) : xml;
  const title = firstTagText(head, "title");

  const items: ParsedFeedItem[] = [];
  for (const m of xml.matchAll(blockRe)) {
    const block = m[0];
    const itemTitle = firstTagText(block, "title") ?? "(untitled)";
    const link = extractLink(block);
    const dateRaw = isAtom
      ? firstOfTags(block, ["published", "updated"])
      : firstOfTags(block, ["pubDate", "dc:date", "date"]);
    items.push({ title: itemTitle, link, isoDate: normalizeDate(dateRaw) });
  }
  return { title, items };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/** Bare hostname (no `www.`) for a URL, or null when it isn't parseable. */
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A favicon URL for a feed item via DuckDuckGo's icon service (no key, https). */
export function faviconUrl(url: string): string | null {
  const host = hostFromUrl(url);
  return host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null;
}

/** Canonical key for de-duplication: lowercased host + path, trailing slash
 *  stripped. Falls back to the raw string when it isn't a URL. */
export function canonicalLink(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Compact relative age, e.g. "just now", "5m", "3h", "2d", "Apr 3". */
export function relativeAge(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = nowMs - then;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(then);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Merge ───────────────────────────────────────────────────────────────────

/** Merge per-feed item groups into one list: dedupe by canonical link, sort
 *  newest-first (undated items sink to the bottom), and cap at `limit`. */
export function mergeFeedItems(groups: FeedItem[][], limit: number): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = item.link ? canonicalLink(item.link) : `t:${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  out.sort((a, b) => {
    const ta = a.isoDate ? Date.parse(a.isoDate) : -Infinity;
    const tb = b.isoDate ? Date.parse(b.isoDate) : -Infinity;
    return tb - ta;
  });
  return out.slice(0, Math.max(0, limit));
}
