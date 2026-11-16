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
  /** Raw inner HTML of the item's body (`<content:encoded>`/`<description>` for
   *  RSS, `<content>`/`<summary>` for Atom) — CDATA unwrapped, tags KEPT so
   *  callers can extract embedded links. Undefined when the item has no body. */
  descriptionHtml?: string;
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

/** Inner HTML of the first `<tag>…</tag>` — CDATA unwrapped, markup KEPT. */
function rawTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeTag(tag)}>`, "i");
  const m = re.exec(block);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** First non-empty raw HTML among several candidate tags. */
function firstRawTag(block: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const value = rawTag(block, tag);
    if (value) return value;
  }
  return undefined;
}

/** Extract `<a href>` links (url + cleaned link text) from an HTML fragment, in
 *  document order. Useful for "digest" feed items whose body lists multiple
 *  stories as links. */
export function extractLinks(html: string): { url: string; title: string }[] {
  if (!html) return [];
  const out: { url: string; title: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = decodeEntities(m[1]).trim();
    const title = cleanText(m[2]);
    if (url && title) out.push({ url, title });
  }
  return out;
}

/** Normalize an RFC-822 (`pubDate`) or ISO-8601 (`updated`) date to ISO, or
 *  null when unparseable. */
export function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ─── Feed parsing ────────────────────────────────────────────────────────────

/** Recognize a complete RSS/Atom envelope without rescanning malformed input.
 * This checks tag structure, not the full XML grammar, and never resolves entities. */
export function isFeedDocument(xml: string): boolean {
  const stack: string[] = [];
  let root: string | null = null;
  let closed = false;
  let channel = false;
  let doctype = false;
  let cursor = 0;
  const space = (value: string | undefined) => value === " " || value === "\t" || value === "\r" || value === "\n";
  const nameStart = (value: string | undefined) => {
    if (!value) return false;
    const code = value.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value === "_" || value === ":";
  };
  const namePart = (value: string | undefined) => nameStart(value) || (value !== undefined && value >= "0" && value <= "9") || value === "-" || value === ".";

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    const end = start < 0 ? xml.length : start;
    if (stack.length === 0 && xml.slice(cursor, end).trim()) return false;
    if (start < 0) break;
    cursor = start;
    if (xml.startsWith("<!--", cursor)) {
      const close = xml.indexOf("-->", cursor + 4);
      if (close < 0) return false;
      cursor = close + 3;
      continue;
    }
    if (xml.startsWith("<?", cursor)) {
      const close = xml.indexOf("?>", cursor + 2);
      if (close < 0) return false;
      cursor = close + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", cursor)) {
      if (!stack.length) return false;
      const close = xml.indexOf("]]>", cursor + 9);
      if (close < 0) return false;
      cursor = close + 3;
      continue;
    }
    if (xml.slice(cursor, cursor + 9).toUpperCase() === "<!DOCTYPE" && space(xml[cursor + 9])) {
      if (root || doctype) return false;
      doctype = true;
      cursor += 9;
      let quote: string | null = null;
      let brackets = 0;
      for (; cursor < xml.length; cursor++) {
        const char = xml[cursor];
        if (quote) { if (char === quote) quote = null; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === "[") brackets++;
        else if (char === "]") brackets--;
        else if (char === ">" && brackets === 0) break;
        if (brackets < 0) return false;
      }
      if (cursor === xml.length) return false;
      cursor++;
      continue;
    }
    cursor++;
    const closing = xml[cursor] === "/";
    if (closing) cursor++;
    const nameAt = cursor;
    if (!nameStart(xml[cursor])) return false;
    while (namePart(xml[cursor])) cursor++;
    const name = xml.slice(nameAt, cursor).toLowerCase();
    if (closing) {
      while (space(xml[cursor])) cursor++;
      if (xml[cursor] !== ">" || stack.pop() !== name) return false;
      cursor++;
      if (!stack.length) closed = true;
      continue;
    }
    if (closed) return false;
    if (!root) {
      if (name !== "rss" && name !== "feed") return false;
      root = name;
    }
    if (!space(xml[cursor]) && xml[cursor] !== ">" && xml[cursor] !== "/") return false;
    let quote: string | null = null;
    for (; cursor < xml.length; cursor++) {
      const char = xml[cursor];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      else if (char === "<") return false;
    }
    if (cursor === xml.length) return false;
    const selfClosing = xml[cursor - 1] === "/";
    cursor++;
    if (root === "rss" && stack.length === 1 && name === "channel") channel = true;
    if (!selfClosing) stack.push(name);
    else if (!stack.length) closed = true;
    if (stack.length > 256) return false;
  }
  return closed && stack.length === 0 && (root === "feed" || channel);
}

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
    const descriptionHtml = isAtom
      ? firstRawTag(block, ["content", "summary"])
      : firstRawTag(block, ["content:encoded", "description"]);
    items.push({ title: itemTitle, link, isoDate: normalizeDate(dateRaw), descriptionHtml });
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
