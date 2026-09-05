/**
 * research-github-repo.ts — client-safe helpers and contracts for the Research
 * Desk's GitHub repository viewer (cave-vy5vp).
 *
 * This module is import-safe on both the server and the browser: it holds only
 * pure parsing, URL composition, and the wire types shared by the
 * `/api/research/github-repo` route, its server fetch module, and the viewer
 * component. Repository identity always flows through the existing
 * `github-repo-link.ts` validators (`gitHubRepoSlug` / `normalizeGitHubRepoUrl`),
 * so an unvetted string can never become a fetch target — the same rule the
 * Canvas GitHub importer and the Cave project linker already enforce.
 */

import { gitHubRepoSlug, normalizeGitHubRepoUrl } from "./github-repo-link.ts";

/** A single entry in a repository's recursive git tree. */
export type GithubRepoTreeEntry = {
  path: string;
  type: "blob" | "tree";
  /** Exact Git object SHA captured with this tree entry. */
  sha: string;
  /** Byte size for blobs; absent for trees. */
  size?: number;
};

export type GithubRepoReadme = {
  /** Repository-relative README path (e.g. `README.md`, `docs/README.md`). */
  path: string;
  markdown: string;
};

export type GithubRepoVisibility = "public" | "private" | "internal";

/** The persisted, immutable repository snapshot used by saved resources. */
export type GithubRepoSnapshot = {
  version: 1;
  owner: string;
  repo: string;
  description?: string;
  primaryLanguage?: string;
  licenseSpdx?: string;
  visibility: GithubRepoVisibility;
  stars: number;
  forks: number;
  defaultBranch: string;
  resolvedRef: string;
  /** Exact commit resolved from `resolvedRef` when the snapshot was captured. */
  commitSha: string;
  fetchedAt: string;
  truncated: boolean;
  tree: GithubRepoTreeEntry[];
  readme: GithubRepoReadme | null;
};

/** List-safe repository metadata; large tree/README bodies stay detail-only. */
export type GithubRepoSummary = Omit<GithubRepoSnapshot, "tree" | "readme">;

/** Backwards-compatible name used by the route and server transport. */
export type GithubRepoView = GithubRepoSnapshot;

export type GithubRepoFileView = {
  sha: string;
  text: string;
  bytes: number;
};

/** A validated `owner/repo` pair. */
export type GithubRepoRef = { owner: string; repo: string };

/** Cap on tree entries the server returns (huge monorepos stay bounded). */
export const GITHUB_REPO_TREE_ENTRY_CAP = 400;
/** Cap on README bytes the server returns. */
export const GITHUB_REPO_README_BYTE_CAP = 256 * 1024;
/** Cap on text file bytes read inside the repository viewer. */
export const GITHUB_REPO_FILE_BYTE_CAP = 1024 * 1024;
/** Leave headroom beneath the durable manifest's 1 MiB record ceiling. */
export const GITHUB_REPO_SNAPSHOT_BYTE_CAP = 512 * 1024;
/** Bound remote work performed by one interactive save request. */
export const MAX_GITHUB_REPOSITORIES_PER_INGEST = 5;
/** Upper bound on an accepted branch/ref string. */
export const GITHUB_REPO_REF_MAX_LENGTH = 256;
export const GITHUB_OBJECT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const GITHUB_REPO_IDENTITY_MAX_LENGTH = 100;
const GITHUB_REPO_DESCRIPTION_MAX_LENGTH = 1_000;
const GITHUB_REPO_METADATA_MAX_LENGTH = 100;
const GITHUB_REPO_PATH_MAX_LENGTH = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidGithubRepoPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > GITHUB_REPO_PATH_MAX_LENGTH) {
    return false;
  }
  const segments = value.split("/");
  return !value.includes("\0")
    && segments.every((segment) => segment && segment !== "." && segment !== "..");
}

/**
 * Parse a GitHub repository reference — a bare `owner/name` slug, a canonical
 * repo URL, or any deeper github.com URL (blob/tree/PR/issue) — into its
 * `owner` / `repo` pair, or null when the input is not a valid GitHub repo.
 */
export function parseGithubRepoInput(value: string | null | undefined): GithubRepoRef | null {
  if (typeof value !== "string") return null;
  const slug = gitHubRepoSlug(normalizeGitHubRepoUrl(value));
  if (!slug) return null;
  const [owner, repo] = slug.split("/");
  return owner && repo ? { owner, repo } : null;
}

/**
 * Sanitize an optional branch/tag/SHA the viewer forwards to GitHub. Returns
 * the trimmed ref or null when it is empty or cannot be safely embedded in a
 * URL (whitespace, control chars, `?`/`#`, path traversal, or over-long).
 */
export function sanitizeGithubRef(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > GITHUB_REPO_REF_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\s?#]/.test(trimmed)) return null;
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) return null;
  return trimmed;
}

export function sanitizeGithubObjectSha(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return GITHUB_OBJECT_SHA_PATTERN.test(normalized) ? normalized : null;
}

/** Distinct repository identities represented by a submitted URL batch. */
export function githubRepoCandidates(
  urls: readonly string[],
): Array<{ ref: GithubRepoRef; urls: string[] }> {
  const candidates = new Map<string, { ref: GithubRepoRef; urls: string[] }>();
  for (const url of urls) {
    const parsed = parseGithubRepoInput(url);
    if (!parsed) continue;
    const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
    const existing = candidates.get(key);
    if (existing) existing.urls.push(url);
    else candidates.set(key, { ref: parsed, urls: [url] });
  }
  return [...candidates.values()];
}

/** Validate and deeply detach a snapshot crossing a persistence boundary. */
export function normalizeGithubRepoSnapshot(value: unknown): GithubRepoSnapshot | null {
    if (!isRecord(value) || value.version !== 1) return null;
    const owner = typeof value.owner === "string" ? value.owner.trim() : "";
    const repo = typeof value.repo === "string" ? value.repo.trim() : "";
    const defaultBranch = sanitizeGithubRef(
      typeof value.defaultBranch === "string" ? value.defaultBranch : null,
    );
    const resolvedRef = sanitizeGithubRef(
      typeof value.resolvedRef === "string" ? value.resolvedRef : null,
    );
    const commitSha = sanitizeGithubObjectSha(
      typeof value.commitSha === "string" ? value.commitSha : null,
    );
    const fetchedAt =
      typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt))
        ? new Date(value.fetchedAt).toISOString()
        : null;
    if (
      !owner
      || owner.length > GITHUB_REPO_IDENTITY_MAX_LENGTH
      || !repo
      || repo.length > GITHUB_REPO_IDENTITY_MAX_LENGTH
      || !defaultBranch
      || !resolvedRef
      || !commitSha
      || !fetchedAt
      || (value.visibility !== "public" && value.visibility !== "private" && value.visibility !== "internal")
      || !Number.isSafeInteger(value.stars)
      || (value.stars as number) < 0
      || !Number.isSafeInteger(value.forks)
      || (value.forks as number) < 0
      || typeof value.truncated !== "boolean"
      || !Array.isArray(value.tree)
      || value.tree.length > GITHUB_REPO_TREE_ENTRY_CAP
    ) {
      return null;
    }
    const optionalString = (candidate: unknown, maxLength: number): string | undefined | null => {
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "string") return null;
      const trimmed = candidate.trim();
      return trimmed && trimmed.length <= maxLength ? trimmed : null;
    };
    const description = optionalString(value.description, GITHUB_REPO_DESCRIPTION_MAX_LENGTH);
    const primaryLanguage = optionalString(value.primaryLanguage, GITHUB_REPO_METADATA_MAX_LENGTH);
    const licenseSpdx = optionalString(value.licenseSpdx, GITHUB_REPO_METADATA_MAX_LENGTH);
    if (description === null || primaryLanguage === null || licenseSpdx === null) return null;

    const tree: GithubRepoTreeEntry[] = [];
    const pathTypes = new Map<string, GithubRepoTreeEntry["type"]>();
    for (const rawEntry of value.tree) {
      if (!isRecord(rawEntry)) return null;
      const path = rawEntry.path;
      const sha = sanitizeGithubObjectSha(typeof rawEntry.sha === "string" ? rawEntry.sha : null);
      if (
        !isValidGithubRepoPath(path)
        || (rawEntry.type !== "blob" && rawEntry.type !== "tree")
        || !sha
        || pathTypes.has(path)
        || (
          rawEntry.size !== undefined
          && (!Number.isSafeInteger(rawEntry.size) || (rawEntry.size as number) < 0)
        )
      ) {
        return null;
      }
      pathTypes.set(path, rawEntry.type);
      tree.push({
        path,
        type: rawEntry.type,
        sha,
        ...(rawEntry.size === undefined ? {} : { size: rawEntry.size as number }),
      });
    }
    for (const path of pathTypes.keys()) {
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index++) {
        if (pathTypes.get(segments.slice(0, index).join("/")) === "blob") return null;
      }
    }

    let readme: GithubRepoReadme | null = null;
    if (value.readme !== null) {
      if (!isRecord(value.readme)) return null;
      const path = value.readme.path;
      const markdown = typeof value.readme.markdown === "string" ? value.readme.markdown : null;
      if (
        !isValidGithubRepoPath(path)
        || markdown === null
        || new TextEncoder().encode(markdown).byteLength > GITHUB_REPO_README_BYTE_CAP
      ) {
        return null;
      }
      readme = { path, markdown };
    }

    const snapshot: GithubRepoSnapshot = {
      version: 1,
      owner,
      repo,
      ...(description === undefined ? {} : { description }),
      ...(primaryLanguage === undefined ? {} : { primaryLanguage }),
      ...(licenseSpdx === undefined ? {} : { licenseSpdx }),
      visibility: value.visibility,
      stars: value.stars as number,
      forks: value.forks as number,
      defaultBranch,
      resolvedRef,
      commitSha,
      fetchedAt,
      truncated: value.truncated,
      tree,
      readme,
    };
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
      <= GITHUB_REPO_SNAPSHOT_BYTE_CAP
      ? snapshot
      : null;
}

/** The repository's github.com landing page. */
export function githubRepoWebUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

/** A file's github.com blob URL at a given ref. */
export function githubRepoFileWebUrl(owner: string, repo: string, ref: string, filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${githubRepoWebUrl(owner, repo)}/blob/${encodeURIComponent(ref)}/${encoded}`;
}

export function githubRepoReadmeLinkUrl(
  repo: { owner: string; repo: string; commitSha: string; readmePath: string },
  href: string,
): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    const resolved = new URL(
      trimmed,
      githubRepoFileWebUrl(repo.owner, repo.repo, repo.commitSha, repo.readmePath),
    );
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

/** The repository's github.com tree URL at a given ref. */
export function githubRepoTreeWebUrl(owner: string, repo: string, ref: string): string {
  return `${githubRepoWebUrl(owner, repo)}/tree/${encodeURIComponent(ref)}`;
}

/** The loopback endpoint the viewer fetches (relative, like every research route). */
export function githubRepoViewEndpoint(repo: string, ref?: string | null): string {
  const params = new URLSearchParams({ repo });
  const sanitized = sanitizeGithubRef(ref);
  if (sanitized) params.set("ref", sanitized);
  return `/api/research/github-repo?${params.toString()}`;
}

export function githubRepoFileEndpoint(repo: string, sha: string): string {
  const params = new URLSearchParams({ repo, sha });
  return `/api/research/github-repo/file?${params.toString()}`;
}

/** A node in the nested view the client renders from a flat tree listing. */
export type RepoTreeNode = {
  name: string;
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  children?: RepoTreeNode[];
};

/**
 * Fold a flat, recursive git-tree listing into a nested tree. Intermediate
 * directory levels are materialized so a deep blob path still renders under
 * its parent folders; explicit `tree` rows share the same node by path.
 */
export function buildGithubRepoTree(entries: readonly GithubRepoTreeEntry[]): RepoTreeNode[] {
  const roots: RepoTreeNode[] = [];
  const byPath = new Map<string, RepoTreeNode>();
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const segments = entry.path.split("/").filter(Boolean);
    let parent: RepoTreeNode | null = null;
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;
      let node = byPath.get(currentPath);
      if (!node) {
        const type = isLeaf ? entry.type : "tree";
        node = { name: segment, path: currentPath, type, sha: isLeaf ? entry.sha : "" };
        if (type === "tree") node.children = [];
        if (entry.type === "blob" && isLeaf && entry.size !== undefined) node.size = entry.size;
        byPath.set(currentPath, node);
        if (parent) parent.children!.push(node);
        else roots.push(node);
      } else if (isLeaf) {
        // A path that surfaces as both a directory and a leaf is malformed in a
        // real git tree; keep the directory shape and ignore the duplicate.
        node.type = entry.type;
        node.sha = entry.sha;
        if (entry.size !== undefined) node.size = entry.size;
      }
      parent = node;
    }
  }
  return roots;
}

/** Human-readable byte count for a file row (never a raw numeric size alone). */
export function formatGithubBytes(size: number | undefined): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${trimFloat(kib < 10 ? kib.toFixed(1) : String(Math.round(kib)))} KB`;
  const mib = kib / 1024;
  return `${trimFloat(mib < 10 ? mib.toFixed(1) : String(Math.round(mib)))} MB`;
}

function trimFloat(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
