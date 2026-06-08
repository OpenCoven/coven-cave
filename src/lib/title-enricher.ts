/**
 * title-enricher.ts
 *
 * Fetches real page titles for URLs during library ingestion.
 * Used by route-link and the bookmarks POST endpoint.
 *
 * Strategy (in order):
 *  1. GitHub API — for github.com URLs (no auth needed for public repos)
 *  2. arXiv API  — for arxiv.org URLs (returns XML with clean title)
 *  3. HTML fetch — parse <title> tag from page HTML (works for most sites)
 *  4. Slug fallback — derive from URL path segments (already in route-link)
 *
 * All fetches are best-effort: on any error, returns null so callers
 * fall back gracefully.
 */

export type EnrichedMeta = {
  title: string;
  description?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function domainFrom(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function titleFromPath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last ? slugToTitle(last) : domainFrom(url);
}

// ── GitHub API ───────────────────────────────────────────────────────────────

async function enrichGitHub(url: URL): Promise<EnrichedMeta | null> {
  const parts = url.pathname.replace(/^\//, "").split("/");
  if (parts.length < 2) return null;
  const [owner, repo, section, num] = parts;

  try {
    if (section === "issues" || section === "pull") {
      const kind = section === "issues" ? "issues" : "pulls";
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${kind}/${num}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "coven-cave/1.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as { title?: string; body?: string };
        if (data.title) return {
          title: `${owner}/${repo} #${num} — ${data.title}`,
          description: data.body?.slice(0, 200) ?? undefined,
        };
      }
    } else {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "coven-cave/1.0" },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as { full_name?: string; description?: string };
        if (data.full_name) return {
          title: data.full_name,
          description: data.description ?? undefined,
        };
      }
    }
  } catch { /* fall through */ }
  return null;
}

// ── arXiv API ────────────────────────────────────────────────────────────────

async function enrichArxiv(url: URL): Promise<EnrichedMeta | null> {
  const match = url.pathname.match(/\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (!match) return null;
  const id = match[1];
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?id_list=${id}&max_results=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const titleMatch = xml.match(/<title>([^<]+)<\/title>/);
    const summaryMatch = xml.match(/<summary>([\s\S]+?)<\/summary>/);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
    const description = summaryMatch?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300);
    if (title && title !== "Error") return { title, description };
  } catch { /* fall through */ }
  return null;
}

// ── HTML title fetch ─────────────────────────────────────────────────────────

async function enrichHtml(rawUrl: string): Promise<EnrichedMeta | null> {
  try {
    const res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CovenCave/1.0; +https://opencoven.dev)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;

    // Read only the first 16KB — enough to find <title> and <meta description>
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = "";
    while (html.length < 16384) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      if (html.includes("</title>")) break;
    }
    reader.cancel().catch(() => {});

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch  = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
                    ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

    const rawTitle = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
    const description = descMatch?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!rawTitle) return null;

    // Strip common site-name suffixes: "Title | Site" or "Title - Site" or "Title | Site Name"
    const cleaned = rawTitle
      .replace(/\s*[|–—-]\s*[^|–—-]{1,60}$/, "")
      .replace(/\s+/g, " ")
      .trim() || rawTitle;

    return { title: cleaned, description };
  } catch { /* fall through */ }
  return null;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Attempt to enrich a URL with a real title + optional description.
 * Returns null if all strategies fail — callers should fall back to
 * domain name or slug-derived title.
 */
export async function enrichTitle(rawUrl: string): Promise<EnrichedMeta | null> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return null; }

  const host = parsed.hostname.toLowerCase();

  // GitHub API (faster + richer than HTML scrape)
  if (host === "github.com" || host === "www.github.com") {
    const gh = await enrichGitHub(parsed);
    if (gh) return gh;
  }

  // arXiv API
  if (host === "arxiv.org" || host === "www.arxiv.org") {
    const ax = await enrichArxiv(parsed);
    if (ax) return ax;
  }

  // HTML fetch for everything else
  return enrichHtml(rawUrl);
}

/**
 * Derive a best-effort title without any network calls.
 * Used as the final fallback when enrichTitle returns null.
 */
export function fallbackTitle(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const slug = titleFromPath(u);
    return slug !== domainFrom(u) ? slug : domainFrom(u);
  } catch { return rawUrl; }
}
