/**
 * GitHub repository overview fetcher — powers the Library's inline repo reader.
 *
 * Given a repo slug ("owner/name") or any github.com URL, returns lightweight
 * repository metadata plus the rendered README markdown so the Library can show
 * a real reading surface instead of a bare "open external" card.
 *
 * Network calls go through the public GitHub REST API. A token (GITHUB_TOKEN /
 * GH_TOKEN) is used when present to lift the 60 req/hr anonymous rate limit, but
 * is never required — public repos work tokenless. The `fetchImpl` seam keeps
 * the module unit-testable without real network access.
 */

export type GitHubRepoMeta = {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  url: string;
  homepage: string | null;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  defaultBranch: string;
  updatedAt: string | null;
  license: string | null;
  archived: boolean;
  /** Owner avatar (organization or user) — shown beside the repo name. */
  ownerAvatar: string | null;
  /** GitHub's rendered social-preview card for the repo (opengraph). */
  openGraphImage: string;
};

export type GitHubRepoOverview = {
  meta: GitHubRepoMeta;
  /** Raw README markdown, or null when the repo has no README. */
  readme: string | null;
  /** GitHub-rendered README HTML, or null when unavailable. */
  readmeHtml: string | null;
};

export type GitHubRepoError = { error: string; status: number };

type FetchImpl = typeof fetch;

/** Parse an "owner/name" slug or a github.com URL into its owner + repo. */
export function parseRepoSlug(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let owner: string | undefined;
  let repo: string | undefined;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("github.com/")) {
    let rest = trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (!rest.startsWith("github.com/")) return null;
    rest = rest.slice("github.com/".length);
    const parts = rest.split(/[/?#]/).filter(Boolean);
    [owner, repo] = parts;
  } else {
    const parts = trimmed.split("/").filter(Boolean);
    [owner, repo] = parts;
  }

  if (!owner || !repo) return null;
  // Strip a trailing ".git" and validate the path segments.
  repo = repo.replace(/\.git$/i, "");
  const ok = (s: string) => /^[A-Za-z0-9._-]+$/.test(s);
  if (!ok(owner) || !ok(repo)) return null;
  return { owner, repo };
}

function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "coven-cave/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function rateLimitMessage(res: Response): string | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining === "0") {
    return "GitHub API rate limit reached. Set GITHUB_TOKEN to raise the limit, or try again later.";
  }
  return null;
}

/**
 * Fetch repository metadata + README. Returns either the overview or a
 * structured error (never throws on HTTP/4xx — callers map it to a payload).
 */
export async function fetchRepoOverview(
  input: string,
  options: { token?: string | null; fetchImpl?: FetchImpl } = {},
): Promise<GitHubRepoOverview | GitHubRepoError> {
  const slug = parseRepoSlug(input);
  if (!slug) return { error: "Not a recognizable GitHub repository.", status: 400 };

  const doFetch = options.fetchImpl ?? fetch;
  const token = options.token ?? null;
  const base = `https://api.github.com/repos/${slug.owner}/${slug.repo}`;

  let metaRes: Response;
  try {
    metaRes = await doFetch(base, { headers: authHeaders(token) });
  } catch {
    return { error: "Could not reach GitHub.", status: 502 };
  }
  if (metaRes.status === 404) {
    return { error: "Repository not found (it may be private).", status: 404 };
  }
  if (!metaRes.ok) {
    const rl = rateLimitMessage(metaRes);
    return { error: rl ?? `GitHub returned ${metaRes.status}.`, status: 502 };
  }

  const raw = (await metaRes.json()) as Record<string, unknown>;
  const meta: GitHubRepoMeta = {
    owner: slug.owner,
    repo: slug.repo,
    fullName: typeof raw.full_name === "string" ? raw.full_name : `${slug.owner}/${slug.repo}`,
    description: typeof raw.description === "string" ? raw.description : null,
    url: typeof raw.html_url === "string" ? raw.html_url : `https://github.com/${slug.owner}/${slug.repo}`,
    homepage: typeof raw.homepage === "string" && raw.homepage ? raw.homepage : null,
    stars: typeof raw.stargazers_count === "number" ? raw.stargazers_count : 0,
    forks: typeof raw.forks_count === "number" ? raw.forks_count : 0,
    language: typeof raw.language === "string" ? raw.language : null,
    topics: Array.isArray(raw.topics) ? (raw.topics as unknown[]).filter((t): t is string => typeof t === "string") : [],
    defaultBranch: typeof raw.default_branch === "string" ? raw.default_branch : "main",
    updatedAt: typeof raw.pushed_at === "string" ? raw.pushed_at : typeof raw.updated_at === "string" ? raw.updated_at : null,
    license:
      raw.license && typeof raw.license === "object" && typeof (raw.license as Record<string, unknown>).spdx_id === "string"
        ? ((raw.license as Record<string, unknown>).spdx_id as string)
        : null,
    archived: raw.archived === true,
    ownerAvatar:
      raw.owner && typeof raw.owner === "object" && typeof (raw.owner as Record<string, unknown>).avatar_url === "string"
        ? ((raw.owner as Record<string, unknown>).avatar_url as string)
        : null,
    // opengraph.githubassets.com renders the repo's social card. The leading
    // path segment is a cache key GitHub ignores for routing — derive it from
    // the last push so the card refreshes when the repo changes (fallback "1").
    openGraphImage: `https://opengraph.githubassets.com/${
      (typeof raw.pushed_at === "string" ? raw.pushed_at.replace(/\D/g, "").slice(0, 14) : "") || "1"
    }/${slug.owner}/${slug.repo}`,
  };

  // README is best-effort: a repo without one still returns a useful overview.
  let readmeHtml: string | null = null;
  try {
    const readmeHtmlRes = await doFetch(`${base}/readme`, {
      headers: { ...authHeaders(token), Accept: "application/vnd.github.html+json" },
    });
    if (readmeHtmlRes.ok) {
      readmeHtml = await readmeHtmlRes.text();
    }
  } catch {
    /* keep readmeHtml null */
  }

  let readme: string | null = null;
  try {
    const readmeRes = await doFetch(`${base}/readme`, {
      headers: { ...authHeaders(token), Accept: "application/vnd.github.raw+json" },
    });
    if (readmeRes.ok) {
      readme = await readmeRes.text();
    }
  } catch {
    /* keep readme null */
  }

  return { meta, readme, readmeHtml };
}

/** Compact "1.2k" / "12.3k" / "1.4M" star/fork formatter. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
}

// ── Relative-asset resolution for README markdown ────────────────────────────
// A repo README constantly uses repo-relative paths — `![logo](docs/logo.png)`,
// `<img src="./assets/banner.svg">`, `[CONTRIBUTING](CONTRIBUTING.md)`. GitHub's
// own HTML rendering rewrites those to absolute URLs, but when we fall back to
// rendering the *raw* markdown through our own pipeline they resolve against the
// app origin and 404. `absolutizeGitHubReadme` rewrites relative image sources
// (→ raw.githubusercontent.com) and relative links (→ github.com/blob) so images
// actually load and links still work. Absolute URLs, protocol-relative `//…`,
// `data:` URIs, and in-page `#anchor`s are left untouched.

/** A URL is repo-relative when it has no scheme, no `//` prefix, and isn't a bare anchor. */
function isRelativeAsset(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("#")) return false; // in-page anchor
  if (u.startsWith("//")) return false; // protocol-relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return false; // has a scheme (http:, data:, mailto:…)
  return true;
}

/** Resolve a repo-relative path against a raw/blob base. Leading `/` is treated
 *  as repo-root-relative (GitHub's behaviour), not app-host-absolute. */
function resolveAsset(url: string, base: string): string {
  const path = url.trim().replace(/^\/+/, "");
  try {
    return new URL(path, base).toString();
  } catch {
    return url;
  }
}

/** File extensions we treat as images when a reference-style definition is
 *  ambiguous between a link and an image target. */
const IMAGE_EXT = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico|apng)(?:[?#]|$)/i;

export type AbsolutizeOptions = { owner: string; repo: string; branch?: string | null };

/**
 * Rewrite repo-relative image sources and links in README markdown to absolute
 * GitHub URLs so the inline reader renders images and honours doc links even
 * when we render the raw markdown (rather than GitHub's pre-rendered HTML).
 */
export function absolutizeGitHubReadme(md: string, opts: AbsolutizeOptions): string {
  if (!md) return md;
  const branch = opts.branch && /^[\w./-]+$/.test(opts.branch) ? opts.branch : "HEAD";
  const rawBase = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${branch}/`;
  const blobBase = `https://github.com/${opts.owner}/${opts.repo}/blob/${branch}/`;

  // Mask fenced + inline code so example snippets are never rewritten.
  const masks: string[] = [];
  const stash = (value: string): string => {
    const token = ` GH${masks.length} `;
    masks.push(value);
    return token;
  };
  let out = md
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, stash) // fenced code
    .replace(/`[^`\n]*`/g, stash); // inline code

  const unwrap = (u: string) => (u.startsWith("<") && u.endsWith(">") ? u.slice(1, -1) : u);

  // Markdown images: ![alt](src "title") → raw.githubusercontent.com
  out = out.replace(
    /(!\[[^\]]*\]\()\s*(<[^>\s]+>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?)\s*(\))/g,
    (m, pre: string, url: string, title: string, post: string) => {
      const bare = unwrap(url);
      if (!isRelativeAsset(bare)) return m;
      return `${pre}${resolveAsset(bare, rawBase)}${title}${post}`;
    },
  );

  // Markdown links: [text](href "title") → github.com/blob (lookbehind skips images).
  out = out.replace(
    /(?<!!)(\[[^\]]*\]\()\s*(<[^>\s]+>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?)\s*(\))/g,
    (m, pre: string, url: string, title: string, post: string) => {
      const bare = unwrap(url);
      if (!isRelativeAsset(bare)) return m;
      return `${pre}${resolveAsset(bare, blobBase)}${title}${post}`;
    },
  );

  // HTML <img src="…"> (READMEs use raw HTML for sizing/centering).
  out = out.replace(/(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*')/gi, (m, pre: string, quoted: string) => {
    const url = quoted.slice(1, -1);
    if (!isRelativeAsset(url)) return m;
    return `${pre}${quoted[0]}${resolveAsset(url, rawBase)}${quoted[0]}`;
  });

  // HTML <a href="…"> → blob view.
  out = out.replace(/(<a\b[^>]*?\bhref\s*=\s*)("[^"]*"|'[^']*')/gi, (m, pre: string, quoted: string) => {
    const url = quoted.slice(1, -1);
    if (!isRelativeAsset(url)) return m;
    return `${pre}${quoted[0]}${resolveAsset(url, blobBase)}${quoted[0]}`;
  });

  // Reference-style definitions: `[ref]: path` — image vs link inferred by ext.
  out = out.replace(/^([ \t]*\[[^\]]+\]:[ \t]*)(<[^>\s]+>|\S+)(.*)$/gm, (m, pre: string, url: string, rest: string) => {
    const bare = unwrap(url);
    if (!isRelativeAsset(bare)) return m;
    return `${pre}${resolveAsset(bare, IMAGE_EXT.test(bare) ? rawBase : blobBase)}${rest}`;
  });

  // Restore masked code spans.
  return out.replace(/ GH(\d+) /g, (_m, i: string) => masks[Number(i)] ?? "");
}
