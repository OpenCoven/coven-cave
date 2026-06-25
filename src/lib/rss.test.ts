// @ts-nocheck
import assert from "node:assert/strict";
import {
  parseFeed,
  decodeEntities,
  cleanText,
  normalizeDate,
  hostFromUrl,
  faviconUrl,
  canonicalLink,
  relativeAge,
  mergeFeedItems,
} from "./rss.ts";

// ── Entities + text cleanup ──────────────────────────────────────────────────
assert.equal(decodeEntities("AT&amp;T &lt;b&gt; &#39;x&#39; &#x27;y&#x27;"), "AT&T <b> 'x' 'y'");
assert.equal(decodeEntities("&unknownentity; stays"), "&unknownentity; stays");
assert.equal(cleanText("<![CDATA[Hello &amp; <b>world</b>]]>"), "Hello & world");
assert.equal(cleanText("  multi\n  line   text "), "multi line text");
// Entities are decoded BEFORE tags are stripped, so encoded markup is removed
// rather than re-exposed as live text.
assert.equal(cleanText("&lt;b&gt;Bold&lt;/b&gt; &amp; clean"), "Bold & clean");

// ── Date normalization (RFC-822 + ISO) ───────────────────────────────────────
assert.equal(normalizeDate("Wed, 02 Oct 2024 13:00:00 GMT"), "2024-10-02T13:00:00.000Z");
assert.equal(normalizeDate("2024-10-02T13:00:00Z"), "2024-10-02T13:00:00.000Z");
assert.equal(normalizeDate("not a date"), null);
assert.equal(normalizeDate(null), null);

// ── RSS 2.0 parsing ──────────────────────────────────────────────────────────
const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Tech</title>
  <link>https://example.com</link>
  <item>
    <title><![CDATA[Rockets &amp; Robots]]></title>
    <link>https://example.com/a</link>
    <pubDate>Wed, 02 Oct 2024 13:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second post</title>
    <link>https://example.com/b/</link>
    <pubDate>Tue, 01 Oct 2024 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const rss = parseFeed(RSS);
assert.equal(rss.title, "Example Tech");
assert.equal(rss.items.length, 2);
assert.equal(rss.items[0].title, "Rockets & Robots");
assert.equal(rss.items[0].link, "https://example.com/a");
assert.equal(rss.items[0].isoDate, "2024-10-02T13:00:00.000Z");
assert.equal(rss.items[1].title, "Second post");

// ── Atom parsing (link href, published/updated) ──────────────────────────────
const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Source</title>
  <entry>
    <title>Atom Entry One</title>
    <link rel="alternate" type="text/html" href="https://atom.example/one"/>
    <link rel="edit" href="https://atom.example/edit/one"/>
    <updated>2024-09-30T10:00:00Z</updated>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link href="https://atom.example/two"/>
    <published>2024-09-29T08:00:00Z</published>
  </entry>
</feed>`;

const atom = parseFeed(ATOM);
assert.equal(atom.title, "Atom Source");
assert.equal(atom.items.length, 2);
// Must pick the alternate/html link, NOT the rel="edit" one.
assert.equal(atom.items[0].link, "https://atom.example/one");
assert.equal(atom.items[0].isoDate, "2024-09-30T10:00:00.000Z");
assert.equal(atom.items[1].link, "https://atom.example/two");

// ── Robustness: garbage / empty ──────────────────────────────────────────────
assert.deepEqual(parseFeed(""), { title: null, items: [] });
assert.deepEqual(parseFeed("<html>not a feed</html>").items, []);

// ── URL helpers ──────────────────────────────────────────────────────────────
assert.equal(hostFromUrl("https://www.theverge.com/rss/index.xml"), "theverge.com");
assert.equal(hostFromUrl("garbage"), null);
assert.equal(faviconUrl("https://news.ycombinator.com/x"), "https://icons.duckduckgo.com/ip3/news.ycombinator.com.ico");
assert.equal(canonicalLink("https://Example.com/A/"), "example.com/a");
assert.equal(
  canonicalLink("https://www.example.com/a"),
  canonicalLink("https://example.com/a/"),
  "www + trailing slash collapse to the same key",
);

// ── relativeAge ──────────────────────────────────────────────────────────────
const now = Date.parse("2024-10-02T13:00:00Z");
assert.equal(relativeAge("2024-10-02T12:59:40Z", now), "just now");
assert.equal(relativeAge("2024-10-02T12:30:00Z", now), "30m");
assert.equal(relativeAge("2024-10-02T09:00:00Z", now), "4h");
assert.equal(relativeAge("2024-09-30T13:00:00Z", now), "2d");
assert.equal(relativeAge(null, now), "");

// ── mergeFeedItems: dedupe by canonical link + sort newest first ──────────────
const merged = mergeFeedItems(
  [
    [
      { id: "1", title: "A", link: "https://x.com/a", isoDate: "2024-10-01T00:00:00Z", source: "X" },
      { id: "2", title: "B", link: "https://x.com/b", isoDate: "2024-10-03T00:00:00Z", source: "X" },
    ],
    [
      // duplicate of A by canonical link (www + trailing slash) — dropped
      { id: "3", title: "A dup", link: "https://www.x.com/a/", isoDate: "2024-10-01T00:00:00Z", source: "Y" },
      { id: "4", title: "C", link: "https://y.com/c", isoDate: null, source: "Y" },
    ],
  ],
  10,
);
assert.deepEqual(merged.map((i) => i.title), ["B", "A", "C"], "newest first; undated sinks; dup removed");

const capped = mergeFeedItems([merged.map((i) => ({ ...i }))], 2);
assert.equal(capped.length, 2, "limit caps the merged list");

console.log("rss.test.ts: ok");
