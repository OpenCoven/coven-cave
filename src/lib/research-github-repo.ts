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
  /** Byte size for blobs; absent for trees. */
  size?: number;
};

export type GithubRepoReadme = {
  /** Repository-relative README path (e.g. `README.md`, `docs/README.md`). */
  path: string;
  markdown: string;
};

/** The normalized payload the server route returns for one repository view. */
export type GithubRepoView = {
  owner: string;
  repo: string;
  /** The repository's default branch, from the repo metadata. */
  defaultBranch: string;
  /** The ref the tree/readme were actually resolved at. */
  resolvedRef: string;
  /** True when the tree was cut down to `GITHUB_REPO_TREE_ENTRY_CAP` entries. */
  truncated: boolean;
  tree: GithubRepoTreeEntry[];
  readme: GithubRepoReadme | null;
};

/** A validated `owner/repo` pair. */
export type GithubRepoRef = { owner: string; repo: string };

/** Cap on tree entries the server returns (huge monorepos stay bounded). */
export const GITHUB_REPO_TREE_ENTRY_CAP = 400;
/** Cap on README bytes the server returns. */
export const GITHUB_REPO_README_BYTE_CAP = 256 * 1024;
/** Upper bound on an accepted branch/ref string. */
export const GITHUB_REPO_REF_MAX_LENGTH = 256;

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

/** The repository's github.com landing page. */
export function githubRepoWebUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

/** A file's github.com blob URL at a given ref. */
export function githubRepoFileWebUrl(owner: string, repo: string, ref: string, filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${githubRepoWebUrl(owner, repo)}/blob/${encodeURIComponent(ref)}/${encoded}`;
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

/** A node in the nested view the client renders from a flat tree listing. */
export type RepoTreeNode = {
  name: string;
  path: string;
  type: "blob" | "tree";
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
        node = { name: segment, path: currentPath, type };
        if (type === "tree") node.children = [];
        if (entry.type === "blob" && isLeaf && entry.size !== undefined) node.size = entry.size;
        byPath.set(currentPath, node);
        if (parent) parent.children!.push(node);
        else roots.push(node);
      } else if (isLeaf) {
        // A path that surfaces as both a directory and a leaf is malformed in a
        // real git tree; keep the directory shape and ignore the duplicate.
        node.type = entry.type;
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
