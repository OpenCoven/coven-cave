// @ts-nocheck
import assert from "node:assert/strict";
import { extractArticle, htmlToMarkdown, decodeEntities, stripHtmlTags } from "./article-extract.ts";

// ── stripHtmlTags: fixpoint defeats split/nested tags ───────────
assert.equal(stripHtmlTags("<b>hi</b>"), "hi");
assert.equal(stripHtmlTags("a<img src=x onerror=y>b"), "ab");
// The fixpoint guarantee: no `<...>` tag can survive, even split/nested ones
// that defeat a single pass (a lone `>` left as text is harmless).
assert.doesNotMatch(stripHtmlTags("<<script>script>alert(1)<</script>/script>"), /<[^>]*>/, "no tag survives the fixpoint");
assert.doesNotMatch(stripHtmlTags("<scr<script>ipt>x</scr</script>ipt>"), /<script/i, "split-tag evasion stripped");

// ── decodeEntities ──────────────────────────────────────────────
assert.equal(decodeEntities("a &amp; b &mdash; c"), "a & b — c");
assert.equal(decodeEntities("&#65;&#x42;"), "AB", "numeric + hex");
assert.equal(decodeEntities("Tom&rsquo;s"), "Tom’s");

// ── htmlToMarkdown ──────────────────────────────────────────────
assert.equal(
  htmlToMarkdown("<h2>Title</h2><p>Hello <strong>world</strong> and <a href='https://x.com'>link</a>.</p>"),
  "## Title\n\nHello **world** and [link](https://x.com).",
  "headings, bold, links",
);
assert.equal(
  htmlToMarkdown("<ul><li>one</li><li>two</li></ul>"),
  "- one\n- two",
  "list items",
);
assert.match(htmlToMarkdown("<pre><code>const x = 1;</code></pre>"), /```\nconst x = 1;\n```/, "code block");
assert.equal(htmlToMarkdown("<blockquote>quoted</blockquote>"), "> quoted", "blockquote");
assert.match(htmlToMarkdown("<img src='/a.png' alt='cat'>"), /!\[cat\]\(\/a\.png\)/, "image");
// javascript: and anchor hrefs become plain text
assert.equal(htmlToMarkdown("<a href='javascript:void(0)'>x</a>"), "x", "drops js href");
assert.doesNotMatch(
  htmlToMarkdown("&lt;iframe src='https://evil.example'&gt;bad&lt;/iframe&gt;safe"),
  /<iframe/i,
  "encoded iframe tags do not survive entity decoding",
);

// ── extractArticle ──────────────────────────────────────────────
const page = `<!doctype html>
<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="The Real Title">
<meta name="author" content="Ada Lovelace">
<meta name="description" content="A short summary.">
<meta property="og:site_name" content="Example Blog">
<meta property="og:image" content="https://ex.com/lead.png">
<style>.x{color:red}</style>
</head>
<body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<header>site header junk</header>
<article>
<h1>The Real Title</h1>
<p>First real paragraph with enough text to clear the length threshold so the container is selected as the article body and not the whole document.</p>
<p>Second paragraph with a <a href="https://link.example/x">useful link</a> inside it.</p>
<script>tracker()</script>
</article>
<footer>copyright junk</footer>
</body></html>`;

const out = extractArticle(page, "https://example.com/post");
assert.equal(out.title, "The Real Title", "prefers og:title");
assert.equal(out.byline, "Ada Lovelace");
assert.equal(out.siteName, "Example Blog");
assert.equal(out.excerpt, "A short summary.");
assert.equal(out.leadImage, "https://ex.com/lead.png");
assert.doesNotMatch(out.markdown, /Home|About|site header|copyright|tracker/, "strips chrome + scripts");
assert.match(out.markdown, /First real paragraph/, "keeps body");
assert.match(out.markdown, /\[useful link\]\(https:\/\/link\.example\/x\)/, "keeps inline links");
// Leading H1 repeating the title is stripped.
assert.doesNotMatch(out.markdown, /^# The Real Title/, "drops duplicate leading H1");
assert.ok(out.textLength > 100, "non-trivial body length");

// siteName falls back to host when no og:site_name.
const bare = extractArticle("<html><body><main><p>" + "x ".repeat(150) + "</p></main></body></html>", "https://www.foo.com/a");
assert.equal(bare.siteName, "foo.com", "host fallback strips www");

console.log("article-extract.test.ts passed");
