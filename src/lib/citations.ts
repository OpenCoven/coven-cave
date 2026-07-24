/**
 * citations — shared parsing + shaping for the Citation UI (chat + research).
 *
 * A "citation" is a numbered source: an inline marker (`[^1]`) that points at a
 * source card (title · domain · snippet · link). This module is JSX-free so the
 * rules are unit-testable under plain `node --experimental-strip-types`.
 *
 * Two producers feed the same `Citation` shape:
 *  - Chat/markdown bodies that carry standard footnote citations
 *    (`[^1]` refs + `[^1]: <url> "Title"` definitions). `parseCitations` pulls
 *    the definitions out so a Sources footer can render them richly while the
 *    body keeps its inline markers.
 *  - Research missions, whose `ResearchSourceRef` rows map straight across.
 */

export type Citation = {
  /** 1-based marker number, in first-reference order. */
  n: number;
  /** Stable DOM id for the marker↔source anchor (e.g. "cite-1"). */
  id: string;
  title: string;
  url?: string;
  /** Bare host (no leading www), derived from the url when present. */
  domain?: string;
  /** A short excerpt / claim / note shown in the source card. */
  snippet?: string;
};

/** The bare host of a URL, dropping a leading `www.`. Null for non-URLs. */
export function domainFromUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || undefined;
  } catch {
    return undefined;
  }
}

/** Minimal shape of a research source row (see ResearchSourceRef). */
export type SourceLike = {
  id?: string;
  title?: string;
  url?: string;
  publisher?: string;
  claim?: string;
  note?: string;
};

/** Adapt a research source row into a Citation (1-based index). */
export function sourceToCitation(source: SourceLike, n: number): Citation {
  const title = source.title?.trim() || domainFromUrl(source.url) || `Source ${n}`;
  return {
    n,
    id: `cite-${n}`,
    title,
    url: source.url || undefined,
    domain: domainFromUrl(source.url) ?? (source.publisher?.trim() || undefined),
    snippet: source.claim?.trim() || source.note?.trim() || undefined,
  };
}

export function sourcesToCitations(sources: readonly SourceLike[]): Citation[] {
  return sources.map((source, i) => sourceToCitation(source, i + 1));
}

// ── Markdown footnote citations ──────────────────────────────────────────────

// A footnote definition line: `[^label]: <content>`, at column 0. Content is one
// of: `<url>`, a bare url, `[Title](url)`, or plain text (optionally `"Title"`).
const DEF_RE = /^\[\^([^\]]+)\]:[ \t]+(.+?)[ \t]*$/gm;
// An inline reference: `[^label]` NOT immediately followed by `:` (that's a def).
const REF_RE = /\[\^([^\]]+)\](?!:)/g;
const MD_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const ANGLE_URL_RE = /^<(https?:\/\/[^\s>]+)>$/;
const BARE_URL_RE = /^(https?:\/\/\S+)(?:[ \t]+"([^"]+)")?$/;

function parseDefinitionContent(raw: string): { title: string; url?: string; snippet?: string } {
  const content = raw.trim();
  const md = content.match(MD_LINK_RE);
  if (md) return { title: md[1].trim(), url: md[2] };
  const angle = content.match(ANGLE_URL_RE);
  if (angle) return { title: domainFromUrl(angle[1]) ?? angle[1], url: angle[1] };
  const bare = content.match(BARE_URL_RE);
  if (bare) return { title: bare[2]?.trim() || domainFromUrl(bare[1]) || bare[1], url: bare[1] };
  // Plain prose: a leading `"Title"` becomes the title, the rest the snippet.
  const quoted = content.match(/^"([^"]+)"[ \t]*(.*)$/);
  if (quoted) return { title: quoted[1].trim(), snippet: quoted[2].trim() || undefined };
  return { title: content };
}

export type ParsedCitations = {
  /** The body with the footnote-definition block removed (refs left intact). */
  body: string;
  /** Citations in first-reference order, numbered 1..n. */
  citations: Citation[];
  /** Original footnote label → assigned 1-based number, for marker rewriting. */
  order: Map<string, number>;
};

/**
 * Pull standard markdown footnote citations out of a body. Only definitions
 * that are actually referenced inline are kept, numbered in the order they are
 * first referenced (so the Sources list reads 1, 2, 3 down the message). The
 * definition block is stripped from the returned `body`; inline `[^label]`
 * markers stay so the renderer can turn them into superscript anchors.
 */
export function parseCitations(text: string): ParsedCitations {
  const defs = new Map<string, { title: string; url?: string; snippet?: string }>();
  let m: RegExpExecArray | null;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(text)) !== null) {
    if (!defs.has(m[1])) defs.set(m[1], parseDefinitionContent(m[2]));
  }
  if (defs.size === 0) return { body: text, citations: [], order: new Map() };

  // Number labels by first inline reference to a defined footnote.
  const order = new Map<string, number>();
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text)) !== null) {
    const label = m[1];
    if (defs.has(label) && !order.has(label)) order.set(label, order.size + 1);
  }
  if (order.size === 0) return { body: text, citations: [], order: new Map() };

  const citations: Citation[] = [...order.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([label, n]) => {
      const def = defs.get(label)!;
      return {
        n,
        id: `cite-${n}`,
        title: def.title || domainFromUrl(def.url) || `Source ${n}`,
        url: def.url,
        domain: domainFromUrl(def.url),
        snippet: def.snippet,
      };
    });

  // Strip the definition lines (and any blank-line run they leave behind).
  const body = text.replace(DEF_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return { body, citations, order };
}

/**
 * Prepare a cited body for markdown rendering: strip the footnote definitions
 * and rewrite each inline `[^label]` reference to a plain markdown link
 * `[N](#cite-N)` pointing at its Sources-list anchor. Standard markdown that
 * survives the sanitizing renderer — no raw HTML, no pipeline changes. Bodies
 * without citations pass through untouched (identical to before).
 */
export function renderCitedBody(text: string): { body: string; citations: Citation[] } {
  const { body, citations, order } = parseCitations(text);
  if (citations.length === 0) return { body: text, citations: [] };
  const rewritten = body.replace(REF_RE, (whole, label: string) => {
    const n = order.get(label);
    return n ? `[${n}](#cite-${n})` : whole;
  });
  return { body: rewritten, citations };
}
