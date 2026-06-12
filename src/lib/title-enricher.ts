/**
 * title-enricher.ts
 *
 * Fetches allowlisted page titles for URLs during library ingestion.
 * Used by route-link and the bookmarks POST endpoint.
 *
 * Strategy (in order):
 *  1. GitHub API — for github.com URLs (no auth needed for public repos)
 *  2. arXiv API  — for arxiv.org URLs (returns XML with clean title)
 *  3. Slug fallback — derive from URL path segments (already in route-link)
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

function isValidGitHubOwnerOrRepoSegment(value: string): boolean {
  if (!value) return false;
  if (value === "." || value === "..") return false;
  // Conservative allowlist for a single path segment.
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isValidGitHubIssueOrPullNumber(value: string | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

// ── GitHub API ───────────────────────────────────────────────────────────────

async function enrichGitHub(url: URL): Promise<EnrichedMeta | null> {
  const parts = url.pathname.replace(/^\//, "").split("/");
  if (parts.length < 2) return null;
  const [owner, repo, section, num] = parts;
  if (!isValidGitHubOwnerOrRepoSegment(owner) || !isValidGitHubOwnerOrRepoSegment(repo)) return null;

  const safeOwner = encodeURIComponent(owner);
  const safeRepo = encodeURIComponent(repo);

  try {
    if (section === "issues" || section === "pull") {
      if (!isValidGitHubIssueOrPullNumber(num)) return null;
      const kind = section === "issues" ? "issues" : "pulls";
      const safeNum = encodeURIComponent(num);
      const res = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/${kind}/${safeNum}`, {
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
      const res = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}`, {
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

  // Do not fetch arbitrary user-supplied URLs server-side. Callers fall back
  // to a local slug/domain title for non-allowlisted hosts.
  return null;
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
