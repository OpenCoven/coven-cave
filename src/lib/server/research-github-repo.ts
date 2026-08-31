/**
 * research-github-repo.ts (server) — fetch plumbing for the Research Desk's
 * GitHub repository viewer (cave-vy5vp).
 *
 * `fetchGithubRepoView` resolves one repository reference (owner/repo + optional
 * ref) into the normalized `GithubRepoView` the client renders: the default
 * branch, a bounded recursive file tree, and the README markdown when one
 * exists. Every network request is pinned to `api.github.com`, carries the
 * configured credential via `resolveGitHubToken` (never forwarded anywhere
 * else), and is capped by a timeout plus byte/entry limits so a hostile or
 * pathological repository cannot exhaust the server.
 *
 * The fetch implementation is injectable so tests exercise the full contract —
 * including GitHub error mapping — without any live network.
 */

import {
  GITHUB_REPO_README_BYTE_CAP,
  GITHUB_REPO_TREE_ENTRY_CAP,
  type GithubRepoReadme,
  type GithubRepoTreeEntry,
  type GithubRepoView,
} from "../research-github-repo.ts";

const GH = "https://api.github.com";
const FETCH_TIMEOUT_MS = 12_000;
const API_VERSION = "2022-11-28";
const USER_AGENT = "coven-cave";
const ACCEPT_JSON = "application/vnd.github+json";

export type GithubRepoViewError =
  | { kind: "not-found"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "upstream"; status: number; message: string }
  | { kind: "timeout" }
  | { kind: "network" };

export type GithubRepoViewResult =
  | { ok: true; view: GithubRepoView }
  | { ok: false; error: GithubRepoViewError };

type GhFetch = (url: string, init: RequestInit) => Promise<Response>;

function classifyFetchError(error: unknown): GithubRepoViewError {
  if (error instanceof Error && error.name === "TimeoutError") return { kind: "timeout" };
  return { kind: "network" };
}

async function gh(
  path: string,
  accept: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<Response> {
  return fetchImpl(`${GH}${path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: accept,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function denied(): GithubRepoViewError {
  return {
    kind: "denied",
    message: "GitHub denied access. Check the configured token and repository visibility.",
  };
}

function upstream(status: number): GithubRepoViewError {
  return { kind: "upstream", status, message: `GitHub couldn't load that repository (${status}).` };
}

/** Parse the recursive tree payload, keeping only well-formed blob/tree rows. */
function normalizeTree(raw: unknown, apiTruncated: boolean): { truncated: boolean; tree: GithubRepoTreeEntry[] } {
  const rows = Array.isArray(raw) ? raw : [];
  const tree: GithubRepoTreeEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as { path?: unknown; type?: unknown; size?: unknown };
    if (entry.type !== "blob" && entry.type !== "tree") continue;
    if (typeof entry.path !== "string" || !entry.path || entry.path.includes("\0")) continue;
    const item: GithubRepoTreeEntry = { path: entry.path, type: entry.type };
    if (entry.type === "blob" && typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0) {
      item.size = entry.size;
    }
    tree.push(item);
  }
  const truncated = apiTruncated || tree.length > GITHUB_REPO_TREE_ENTRY_CAP;
  return { truncated, tree: tree.slice(0, GITHUB_REPO_TREE_ENTRY_CAP) };
}

/** Decode a base64-encoded README from the JSON readme endpoint, byte-capped. */
function normalizeReadme(raw: unknown): GithubRepoReadme | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as { path?: unknown; content?: unknown; encoding?: unknown };
  if (entry.encoding !== "base64" || typeof entry.content !== "string") return null;
  let markdown: string;
  try {
    markdown = Buffer.from(entry.content, "base64").toString("utf8");
  } catch {
    return null;
  }
  if (markdown.length > GITHUB_REPO_README_BYTE_CAP) {
    markdown = markdown.slice(0, GITHUB_REPO_README_BYTE_CAP);
  }
  const path = typeof entry.path === "string" && entry.path ? entry.path : "README.md";
  return { path, markdown };
}

async function fetchTree(
  repoPath: string,
  ref: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<{ ok: true; truncated: boolean; tree: GithubRepoTreeEntry[] } | { ok: false; error: GithubRepoViewError }> {
  let response: Response;
  try {
    response = await gh(
      `${repoPath}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      ACCEPT_JSON,
      token,
      fetchImpl,
    );
  } catch (error) {
    return { ok: false, error: classifyFetchError(error) };
  }
  if (response.status === 404) {
    return {
      ok: false,
      error: { kind: "not-found", message: "GitHub couldn't find that branch. Check the branch name." },
    };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: denied() };
  if (!response.ok) return { ok: false, error: upstream(response.status) };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  const body = (payload ?? {}) as { tree?: unknown; truncated?: unknown };
  return { ok: true, ...normalizeTree(body.tree, body.truncated === true) };
}

async function fetchReadme(
  repoPath: string,
  ref: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<{ ok: true; readme: GithubRepoReadme | null } | { ok: false; error: GithubRepoViewError }> {
  let response: Response;
  try {
    response = await gh(`${repoPath}/readme?ref=${encodeURIComponent(ref)}`, ACCEPT_JSON, token, fetchImpl);
  } catch (error) {
    return { ok: false, error: classifyFetchError(error) };
  }
  // A missing README is a normal, non-fatal state for a repository. Any other
  // non-2xx degrades to "no README" so a rate-limit or a non-JSON response
  // never fails the whole view over a convenience document.
  if (!response.ok) return { ok: true, readme: null };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: true, readme: null };
  }
  return { ok: true, readme: normalizeReadme(payload) };
}

/**
 * Resolve a repository reference into the viewer payload. Network errors are
 * classified into `GithubRepoViewError` shapes the route maps to HTTP statuses;
 * a successful call always returns the default branch, a (possibly truncated)
 * tree, and a README when present.
 */
export async function fetchGithubRepoView(args: {
  owner: string;
  repo: string;
  ref?: string;
  token: string | null;
  fetchImpl?: GhFetch;
}): Promise<GithubRepoViewResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { owner, repo, token } = args;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Repo metadata — existence/visibility gate + default branch.
  let metaResponse: Response;
  try {
    metaResponse = await gh(repoPath, ACCEPT_JSON, token, fetchImpl);
  } catch (error) {
    return { ok: false, error: classifyFetchError(error) };
  }
  if (metaResponse.status === 404) {
    return { ok: false, error: { kind: "not-found", message: "GitHub couldn't find that repository." } };
  }
  if (metaResponse.status === 401 || metaResponse.status === 403) return { ok: false, error: denied() };
  if (!metaResponse.ok) return { ok: false, error: upstream(metaResponse.status) };

  let meta: unknown;
  try {
    meta = await metaResponse.json();
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  const defaultBranchRaw = (meta as { default_branch?: unknown } | null)?.default_branch;
  const defaultBranch = typeof defaultBranchRaw === "string" && defaultBranchRaw ? defaultBranchRaw : "main";
  const resolvedRef = args.ref ?? defaultBranch;

  // 2. Tree + README in parallel.
  const [treeResult, readmeResult] = await Promise.all([
    fetchTree(repoPath, resolvedRef, token, fetchImpl),
    fetchReadme(repoPath, resolvedRef, token, fetchImpl),
  ]);

  if (!treeResult.ok) return treeResult;
  if (!readmeResult.ok) return readmeResult;

  return {
    ok: true,
    view: {
      owner,
      repo,
      defaultBranch,
      resolvedRef,
      truncated: treeResult.truncated,
      tree: treeResult.tree,
      readme: readmeResult.readme,
    },
  };
}
