/**
 * Server-only GitHub transport for commit-pinned Research Desk snapshots.
 */

import {
  GITHUB_REPO_FILE_BYTE_CAP,
  GITHUB_REPO_README_BYTE_CAP,
  GITHUB_REPO_TREE_ENTRY_CAP,
  sanitizeGithubObjectSha,
  type GithubRepoFileView,
  type GithubRepoReadme,
  type GithubRepoTreeEntry,
  type GithubRepoView,
  type GithubRepoVisibility,
} from "../research-github-repo.ts";

const GH = "https://api.github.com";
const FETCH_TIMEOUT_MS = 12_000;
const API_VERSION = "2026-03-10";
const USER_AGENT = "coven-cave";
const ACCEPT_JSON = "application/vnd.github+json";
const ACCEPT_RAW = "application/vnd.github.raw+json";

export type GithubRepoViewError =
  | { kind: "not-found"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "too-large"; message: string }
  | { kind: "binary"; message: string }
  | { kind: "upstream"; status: number; message: string }
  | { kind: "timeout" }
  | { kind: "network" };

export type GithubRepoViewResult =
  | { ok: true; view: GithubRepoView }
  | { ok: false; error: GithubRepoViewError };

export type GithubRepoFileResult =
  | { ok: true; file: GithubRepoFileView }
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

function boundedOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function visibility(value: unknown): GithubRepoVisibility {
  return value === "private" || value === "internal" ? value : "public";
}

function normalizeTree(
  raw: unknown,
  apiTruncated: boolean,
): { ok: true; truncated: boolean; tree: GithubRepoTreeEntry[] } | { ok: false } {
  const rows = Array.isArray(raw) ? raw : [];
  const tree: GithubRepoTreeEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return { ok: false };
    const entry = row as { path?: unknown; type?: unknown; sha?: unknown; size?: unknown };
    // Git trees represent submodules as `commit` entries. They are not text
    // blobs and therefore do not belong in the in-Cave file preview tree.
    if (entry.type === "commit") continue;
    const sha = sanitizeGithubObjectSha(typeof entry.sha === "string" ? entry.sha : null);
    if (
      (entry.type !== "blob" && entry.type !== "tree")
      || typeof entry.path !== "string"
      || !entry.path
      || entry.path.includes("\0")
      || !sha
    ) {
      return { ok: false };
    }
    const item: GithubRepoTreeEntry = { path: entry.path, type: entry.type, sha };
    if (
      entry.type === "blob"
      && typeof entry.size === "number"
      && Number.isSafeInteger(entry.size)
      && entry.size >= 0
    ) {
      item.size = entry.size;
    }
    tree.push(item);
  }
  const truncated = apiTruncated || tree.length > GITHUB_REPO_TREE_ENTRY_CAP;
  return { ok: true, truncated, tree: tree.slice(0, GITHUB_REPO_TREE_ENTRY_CAP) };
}

function normalizeReadme(raw: unknown): GithubRepoReadme | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as { path?: unknown; content?: unknown; encoding?: unknown };
  if (entry.encoding !== "base64" || typeof entry.content !== "string") return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(entry.content.replace(/\s/g, ""), "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength > GITHUB_REPO_README_BYTE_CAP) {
    let end = GITHUB_REPO_README_BYTE_CAP;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    bytes = bytes.subarray(0, end);
  }
  const path = typeof entry.path === "string" && entry.path ? entry.path : "README.md";
  try {
    return { path, markdown: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return null;
  }
}

async function fetchCommitSha(
  repoPath: string,
  ref: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<{ ok: true; sha: string } | { ok: false; error: GithubRepoViewError }> {
  let response: Response;
  try {
    response = await gh(`${repoPath}/commits/${encodeURIComponent(ref)}`, ACCEPT_JSON, token, fetchImpl);
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
  try {
    const body = (await response.json()) as { sha?: unknown };
    const sha = sanitizeGithubObjectSha(typeof body.sha === "string" ? body.sha : null);
    return sha
      ? { ok: true, sha }
      : { ok: false, error: { kind: "upstream", status: 502, message: "GitHub returned an invalid commit identifier." } };
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
}

async function fetchTree(
  repoPath: string,
  commitSha: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<
  { ok: true; truncated: boolean; tree: GithubRepoTreeEntry[] }
  | { ok: false; error: GithubRepoViewError }
> {
  let response: Response;
  try {
    response = await gh(
      `${repoPath}/git/trees/${commitSha}?recursive=1`,
      ACCEPT_JSON,
      token,
      fetchImpl,
    );
  } catch (error) {
    return { ok: false, error: classifyFetchError(error) };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: denied() };
  if (!response.ok) return { ok: false, error: upstream(response.status) };
  try {
    const body = (await response.json()) as { tree?: unknown; truncated?: unknown };
    const normalized = normalizeTree(body.tree, body.truncated === true);
    return normalized.ok
      ? normalized
      : { ok: false, error: { kind: "upstream", status: 502, message: "GitHub returned an invalid repository tree." } };
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
}

async function fetchReadme(
  repoPath: string,
  commitSha: string,
  token: string | null,
  fetchImpl: GhFetch,
): Promise<GithubRepoReadme | null> {
  try {
    const response = await gh(
      `${repoPath}/readme?ref=${commitSha}`,
      ACCEPT_JSON,
      token,
      fetchImpl,
    );
    if (!response.ok) return null;
    return normalizeReadme(await response.json());
  } catch {
    return null;
  }
}

async function readBytesWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("GitHub blob exceeds the preview limit").catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchGithubRepoView(args: {
  owner: string;
  repo: string;
  ref?: string;
  token: string | null;
  fetchImpl?: GhFetch;
  now?: () => Date;
}): Promise<GithubRepoViewResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { owner, repo, token } = args;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

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

  let meta: {
    default_branch?: unknown;
    description?: unknown;
    language?: unknown;
    visibility?: unknown;
    stargazers_count?: unknown;
    forks_count?: unknown;
    license?: { spdx_id?: unknown } | null;
  };
  try {
    meta = (await metaResponse.json()) as typeof meta;
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  const defaultBranch =
    typeof meta.default_branch === "string" && meta.default_branch ? meta.default_branch : "main";
  const resolvedRef = args.ref ?? defaultBranch;
  const commitResult = await fetchCommitSha(repoPath, resolvedRef, token, fetchImpl);
  if (!commitResult.ok) return commitResult;

  const treeResult = await fetchTree(repoPath, commitResult.sha, token, fetchImpl);
  if (!treeResult.ok) return treeResult;
  const readme = await fetchReadme(repoPath, commitResult.sha, token, fetchImpl);

  return {
    ok: true,
    view: {
      version: 1,
      owner,
      repo,
      description: boundedOptionalString(meta.description, 1_000),
      primaryLanguage: boundedOptionalString(meta.language, 100),
      licenseSpdx: boundedOptionalString(meta.license?.spdx_id, 100),
      visibility: visibility(meta.visibility),
      stars: nonNegativeInteger(meta.stargazers_count),
      forks: nonNegativeInteger(meta.forks_count),
      defaultBranch,
      resolvedRef,
      commitSha: commitResult.sha,
      fetchedAt: (args.now ?? (() => new Date()))().toISOString(),
      truncated: treeResult.truncated,
      tree: treeResult.tree,
      readme,
    },
  };
}

export async function fetchGithubRepoFile(args: {
  owner: string;
  repo: string;
  sha: string;
  token: string | null;
  fetchImpl?: GhFetch;
}): Promise<GithubRepoFileResult> {
  const sha = sanitizeGithubObjectSha(args.sha);
  if (!sha) {
    return { ok: false, error: { kind: "not-found", message: "The requested Git blob is invalid." } };
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const repoPath = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;
  let response: Response;
  try {
    response = await gh(`${repoPath}/git/blobs/${sha}`, ACCEPT_RAW, args.token, fetchImpl);
  } catch (error) {
    return { ok: false, error: classifyFetchError(error) };
  }
  if (response.status === 404) {
    return { ok: false, error: { kind: "not-found", message: "GitHub couldn't find that file snapshot." } };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: denied() };
  if (!response.ok) return { ok: false, error: upstream(response.status) };

  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null
    && Number.isFinite(declaredLength)
    && declaredLength > GITHUB_REPO_FILE_BYTE_CAP
  ) {
    await response.body?.cancel("GitHub blob exceeds the preview limit").catch(() => {});
    return {
      ok: false,
      error: { kind: "too-large", message: "This file is larger than the 1 MiB in-Cave preview limit." },
    };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readBytesWithinLimit(response, GITHUB_REPO_FILE_BYTE_CAP);
  } catch {
    return { ok: false, error: { kind: "network" } };
  }
  if (bytes === null) {
    return {
      ok: false,
      error: { kind: "too-large", message: "This file is larger than the 1 MiB in-Cave preview limit." },
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      error: { kind: "binary", message: "This binary file cannot be previewed as text in Cave." },
    };
  }
  if (text.includes("\0")) {
    return {
      ok: false,
      error: { kind: "binary", message: "This binary file cannot be previewed as text in Cave." },
    };
  }
  return { ok: true, file: { sha, text, bytes: bytes.byteLength } };
}
