/**
 * citations — shared parsing + shaping for the Citation UI (chat + research).
 *
 * A "citation" is a source reference: chat renders it as an inline provider
 * chip with a preview card, while research surfaces can render a numbered
 * source list. This module is JSX-free so shaping stays unit-testable.
 *
 * Two producers feed the same `Citation` shape:
 *  - Chat/markdown bodies that carry standard footnote citations
 *    (`[^1]` refs + `[^1]: <url> "Title"` definitions). `parseCitations` pulls
 *    the definitions out so chat can replace numeric refs with provider chips.
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

export type CitationSourceKind =
  | "github"
  | "arxiv"
  | "doi"
  | "wikipedia"
  | "video"
  | "document"
  | "web"
  | "reference";

export type CitationSourcePresentation = {
  kind: CitationSourceKind;
  provider: string;
  context: string;
  summary: string;
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

function parsedUrl(url: string | undefined): URL | undefined {
  if (!url) return undefined;
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sourceSummary(citation: Citation, fallback: string): string {
  return citation.snippet?.trim() || `Preview text wasn't provided. ${fallback}`;
}

function githubPresentation(citation: Citation, url: URL): CitationSourcePresentation {
  const parts = url.pathname.split("/").filter(Boolean);
  const repository = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "GitHub";
  const resource = parts[2];
  const value = parts[3];
  let detail = "Repository";
  let fallback = "Open the repository to review the cited context.";

  if (resource === "pull" && value) {
    detail = `Pull request #${value}`;
    fallback = "Open the pull request to inspect its discussion and changes.";
  } else if (resource === "issues" && value) {
    detail = `Issue #${value}`;
    fallback = "Open the issue to inspect its discussion and status.";
  } else if (resource === "commit" && value) {
    detail = `Commit ${value.slice(0, 7)}`;
    fallback = "Open the commit to inspect its patch and surrounding history.";
  } else if (resource === "discussions" && value) {
    detail = `Discussion #${value}`;
    fallback = "Open the discussion to inspect the full thread.";
  } else if (resource === "actions" && parts[3] === "runs" && parts[4]) {
    detail = `Workflow run ${parts[4]}`;
    fallback = "Open the workflow run to inspect its jobs and logs.";
  } else if (resource === "releases" && value === "tag" && parts[4]) {
    detail = `Release ${decodeUrlPart(parts[4])}`;
    fallback = "Open the release to inspect its notes and assets.";
  }

  return {
    kind: "github",
    provider: "GitHub",
    context: `${repository} · ${detail}`,
    summary: sourceSummary(citation, fallback),
  };
}

const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"]);

export function citationSourcePresentation(citation: Citation): CitationSourcePresentation {
  const url = parsedUrl(citation.url);
  if (!url) {
    return {
      kind: "reference",
      provider: citation.domain?.trim() || "Reference",
      context: "Provided in this chat",
      summary: citation.snippet?.trim() || "No preview text or external link was provided for this reference.",
    };
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "github.com") return githubPresentation(citation, url);

  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const identifier = url.pathname.replace(/^\/(?:abs|pdf)\//, "").replace(/\.pdf$/i, "") || "Unspecified";
    return {
      kind: "arxiv",
      provider: "arXiv",
      context: `Research paper · ${identifier}`,
      summary: sourceSummary(citation, "Open the paper to read its abstract and full text."),
    };
  }

  if (host === "doi.org" || host === "dx.doi.org") {
    const identifier = decodeUrlPart(url.pathname.replace(/^\/+/, "")) || "Unspecified";
    return {
      kind: "doi",
      provider: "DOI",
      context: `Publication · ${identifier}`,
      summary: sourceSummary(citation, "Open the publication record to review the cited work."),
    };
  }

  if (host.endsWith(".wikipedia.org") || host === "wikipedia.org") {
    const article = decodeUrlPart(url.pathname.replace(/^\/wiki\//, "")).replaceAll("_", " ");
    return {
      kind: "wikipedia",
      provider: "Wikipedia",
      context: article && article !== url.pathname ? `Encyclopedia article · ${article}` : "Encyclopedia article",
      summary: sourceSummary(citation, "Open the article to review its references and full context."),
    };
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "vimeo.com") {
    const provider = host === "vimeo.com" ? "Vimeo" : "YouTube";
    return {
      kind: "video",
      provider,
      context: "Video",
      summary: sourceSummary(citation, "Open the video to review the cited segment and description."),
    };
  }

  const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (extension && DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      kind: "document",
      provider: extension === "pdf" ? "PDF" : extension.toUpperCase(),
      context: `Document · ${citation.domain || host}`,
      summary: sourceSummary(citation, "Open the document to review the cited material."),
    };
  }

  return {
    kind: "web",
    provider: citation.domain || host || "Web",
    context: "Web page",
    summary: sourceSummary(citation, "Open the page to review the full context."),
  };
}

export function citationInlineLabel(citation: Citation): string {
  return citationSourcePresentation(citation).provider;
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
const MD_LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:[ \t]+—[ \t]+(.+))?$/;
const ANGLE_URL_RE = /^<(https?:\/\/[^\s>]+)>(?:[ \t]+—[ \t]+(.+))?$/;
const BARE_URL_RE = /^(https?:\/\/\S+)(?:[ \t]+"([^"]+)")?(?:[ \t]+—[ \t]+(.+))?$/;

function parseDefinitionContent(raw: string): { title: string; url?: string; snippet?: string } {
  const content = raw.trim();
  const md = content.match(MD_LINK_RE);
  if (md) return { title: md[1].trim(), url: md[2], snippet: md[3]?.trim() || undefined };
  const angle = content.match(ANGLE_URL_RE);
  if (angle) {
    return {
      title: domainFromUrl(angle[1]) ?? angle[1],
      url: angle[1],
      snippet: angle[2]?.trim() || undefined,
    };
  }
  const bare = content.match(BARE_URL_RE);
  if (bare) {
    return {
      title: bare[2]?.trim() || domainFromUrl(bare[1]) || bare[1],
      url: bare[1],
      snippet: bare[3]?.trim() || undefined,
    };
  }
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

export function renderCitationReferences(
  text: string,
  parsed: Pick<ParsedCitations, "citations" | "order">,
): string {
  if (parsed.citations.length === 0) return text;
  const byNumber = new Map(parsed.citations.map((citation) => [citation.n, citation]));
  const withoutDefinitions = text.replace(DEF_RE, "");
  const body = withoutDefinitions === text
    ? text
    : withoutDefinitions.replace(/\n{3,}/g, "\n\n").trimEnd();
  return body.replace(REF_RE, (whole, label: string) => {
    const n = parsed.order.get(label);
    const citation = n ? byNumber.get(n) : undefined;
    return citation ? `[${citationInlineLabel(citation)}](#cite-${n})` : whole;
  });
}

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
 * and rewrite each inline `[^label]` reference to a provider-labelled anchor.
 * The fragment is an enhancement hook; chat turns it into an interactive source
 * chip after sanitization, while no-JavaScript output stays understandable.
 */
export function renderCitedBody(text: string): { body: string; citations: Citation[] } {
  const parsed = parseCitations(text);
  if (parsed.citations.length === 0) return { body: text, citations: [] };
  return {
    body: renderCitationReferences(parsed.body, parsed),
    citations: parsed.citations,
  };
}
