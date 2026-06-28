/**
 * Lightweight, dependency-free article extraction — powers the Library's inline
 * "reader" for saved articles. Given a page's HTML, it pulls out the title,
 * byline, lead image, and the main body converted to clean markdown so the
 * reader can render it with the same pipeline as research docs.
 *
 * This is deliberately a heuristic extractor (no jsdom/Readability dependency):
 * it strips chrome/boilerplate tags, prefers an <article>/<main> container when
 * present, and converts the remaining block + inline elements to markdown. It
 * won't be perfect on every site, but it turns the common "headline + prose"
 * article into a readable surface, and degrades to an excerpt when it can't.
 */

export type ExtractedArticle = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImage: string | null;
  /** Main body as markdown. Empty string when nothing readable was found. */
  markdown: string;
  /** Plain-text length of the extracted body — a confidence signal. */
  textLength: number;
};

// ── HTML entity decoding (common named + numeric) ───────────────
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—",
  ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”",
  ldquo: "“", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named ?? m;
  });
}

/**
 * Remove all HTML tags, iterating to a fixpoint so split/nested constructs
 * (e.g. `<<script>script>`) can't survive a single pass. Use this everywhere a
 * tag strip happens — a single `.replace(/<[^>]+>/g, "")` is defeatable.
 */
export function stripHtmlTags(input: string): string {
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(/<[^>]*>/g, "");
  } while (out !== prev);
  return out;
}

function stripTags(html: string): string {
  return decodeEntities(stripHtmlTags(html)).replace(/[ \t]+/g, " ").trim();
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const val = decodeEntities(m[1]).trim();
      if (val) return val;
    }
  }
  return null;
}

/** Remove a tag *and its content* (script/style/nav/etc.), repeatedly. */
function dropElements(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    let prev: string;
    do {
      prev = out;
      out = out.replace(re, " ");
    } while (out !== prev);
    // Drop self-closing / unclosed leftovers of the same tag.
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), " ");
  }
  return out;
}

/** Best-effort: inner HTML of the first <article> or <main>, else <body>. */
function selectContainer(html: string): string {
  for (const tag of ["article", "main"]) {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (m?.[1] && stripTags(m[1]).length > 200) return m[1];
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body?.[1] ?? html;
}

/** Convert a cleaned HTML fragment to markdown. */
export function htmlToMarkdown(html: string): string {
  let s = html;

  // Block-level pre/code first (preserve interior).
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const code = decodeEntities(stripHtmlTags(inner.replace(/<\/?code[^>]*>/gi, "")));
    return `\n\n\`\`\`\n${code.replace(/\n+$/, "")}\n\`\`\`\n\n`;
  });

  // Headings.
  for (let level = 1; level <= 6; level++) {
    s = s.replace(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"), (_m, t: string) => {
      const text = stripTags(t);
      return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "";
    });
  }

  // Blockquote.
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, t: string) => {
    const text = stripTags(t);
    return text ? `\n\n> ${text.replace(/\n+/g, " ")}\n\n` : "";
  });

  // List items -> markers (ordered lists become "- " too; good enough).
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => {
    const text = stripTags(t);
    return text ? `\n- ${text}` : "";
  });
  s = s.replace(/<\/(ul|ol)>/gi, "\n\n");

  // Images -> markdown (keep alt + src).
  s = s.replace(/<img\b[^>]*>/gi, (m) => {
    const src = m.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) return "";
    const alt = m.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return `\n\n![${decodeEntities(alt)}](${src})\n\n`;
  });

  // Links -> [text](href).
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
    const text = stripTags(t);
    if (!text) return "";
    if (/^javascript:/i.test(href) || href.startsWith("#")) return text;
    return `[${text}](${href})`;
  });

  // Inline emphasis / code — substitute the open/close tags with their markdown
  // markers rather than capturing-and-restripping the inner HTML. Any tags that
  // remain inside are removed by the fixpoint strip below, so this avoids the
  // "incomplete sanitizer" regex shape while staying safe.
  s = s.replace(/<\/?(?:strong|b)\b[^>]*>/gi, "**");
  s = s.replace(/<\/?(?:em|i)\b[^>]*>/gi, "*");
  s = s.replace(/<\/?code\b[^>]*>/gi, "`");

  // Paragraph + line breaks.
  s = s.replace(/<\/p>/gi, "\n\n").replace(/<p\b[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|section|figure|figcaption|tr)>/gi, "\n");

  // Drop every remaining tag (fixpoint), decode, normalize whitespace.
  s = decodeEntities(stripHtmlTags(s));
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export function extractArticle(html: string, url?: string): ExtractedArticle {
  const title = metaContent(html, [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
    /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  const byline = metaContent(html, [
    /<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i,
    /<meta\s+property=["']article:author["']\s+content=["']([^"']+)["']/i,
  ]);
  const siteName = metaContent(html, [
    /<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
  ]) ?? (url ? hostOf(url) : null);
  const excerpt = metaContent(html, [
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
    /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
  ]);
  const leadImage = metaContent(html, [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
  ]);

  const container = selectContainer(html);
  const cleaned = dropElements(container, [
    "script", "style", "noscript", "svg", "iframe", "form", "button", "nav",
    "header", "footer", "aside", "template", "head",
  ]);
  let markdown = htmlToMarkdown(cleaned);

  // Strip a leading H1 that just repeats the title (the reader shows it already).
  if (title) {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    markdown = markdown.replace(/^#\s+(.+?)\n+/, (m, h: string) => (norm(h) === norm(title) ? "" : m)).trimStart();
  }

  return {
    title: title ? stripTags(title) : null,
    byline: byline ? stripTags(byline) : null,
    siteName,
    excerpt: excerpt ? stripTags(excerpt) : null,
    leadImage,
    markdown,
    textLength: markdown.replace(/\s+/g, " ").trim().length,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
