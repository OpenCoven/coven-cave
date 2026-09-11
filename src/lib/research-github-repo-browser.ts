/**
 * research-github-repo-browser.ts — the file-browser logic behind the saved
 * GitHub repository modal (cave-3aww3).
 *
 * Everything here is pure so the rail's hard parts — chain collapsing, the
 * flat filter ranking, indent clamping, and the "can Cave preview this?"
 * question — are testable without React. The viewer component owns only the
 * state machine and the markup.
 */

import {
  formatGithubBytes,
  type GithubRepoTreeEntry,
  type RepoTreeNode,
} from "./research-github-repo.ts";

/**
 * Deepest level the rail indents to. Past this, rows stop moving right —
 * a vendored checkout can nest a dozen levels and the name column is what
 * matters, not a faithful rendering of the spine.
 */
export const REPO_TREE_MAX_INDENT = 5;

/** Above this, Cave shows a "too large to preview" pane instead of the blob. */
export const REPO_FILE_PREVIEW_BYTE_LIMIT = 2 * 1024 * 1024;

/** Extensions Cave can never render as text. */
const BINARY_EXTENSIONS = new Set([
  "7z", "bin", "bz2", "class", "dat", "db", "dll", "dmg", "doc", "docx", "dylib",
  "ear", "exe", "gz", "ico", "jar", "keystore", "lib", "mp3", "mp4", "mov", "o",
  "odt", "ogg", "otf", "pdf", "pkg", "png", "ppt", "pptx", "pyc", "rar", "so",
  "sqlite", "tar", "tgz", "ttf", "wasm", "wav", "webm", "woff", "woff2", "xls",
  "xlsx", "zip",
]);

const IMAGE_EXTENSIONS = new Set([
  "apng", "avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tiff", "webp",
]);

/** What the content pane can do with a given blob. */
export type RepoFileKind = "text" | "image" | "binary";

export function repoPathExtension(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function repoFileKind(path: string): RepoFileKind {
  const ext = repoPathExtension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return BINARY_EXTENSIONS.has(ext) ? "binary" : "text";
}

/** True when the pane must refuse the blob rather than print bytes at it. */
export function repoFileIsPreviewable(
  path: string,
  size: number | undefined,
): boolean {
  if (repoFileKind(path) !== "text") return false;
  return !(typeof size === "number" && size > REPO_FILE_PREVIEW_BYTE_LIMIT);
}

/**
 * Fold every single-child directory chain into one row.
 *
 * A vendored checkout spends most of its depth on directories that exist only
 * to hold the next directory — `build/src/chrome/browser/ui/mori` is six rows
 * carrying one piece of information. Joining them takes the observed depth of
 * such a repo from 7 to 3 with no user action, which is why this design has no
 * collapse-all: after this there is very little left to collapse.
 *
 * Only directory→directory chains collapse. A directory holding exactly one
 * FILE keeps its own row, because that file is a destination and hiding the
 * folder it lives in would break the breadcrumb's correspondence to the tree.
 */
export function collapseSingleChildChains(nodes: readonly RepoTreeNode[]): RepoTreeNode[] {
  return nodes.map((node) => {
    if (node.type !== "tree") return node;
    let name = node.name;
    let current = node;
    // Walk down while this directory's ONLY child is itself a directory.
    while (
      current.children?.length === 1
      && current.children[0].type === "tree"
    ) {
      current = current.children[0];
      name = `${name}/${current.name}`;
    }
    return {
      ...current,
      name,
      children: collapseSingleChildChains(current.children ?? []),
    };
  });
}

/** One rendered rail row in tree (unfiltered) mode. */
export type RepoTreeRow = {
  node: RepoTreeNode;
  /** Real nesting level, before the indent clamp. */
  depth: number;
  /** Rails to draw — `min(depth, REPO_TREE_MAX_INDENT)`. */
  indent: number;
  expanded: boolean;
};

/**
 * Flatten the collapsed tree into the rows the rail paints, honouring which
 * directories are open. Directories sort before files at every level, which is
 * the order every Git host lists a tree in.
 */
export function flattenRepoTree(
  nodes: readonly RepoTreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): RepoTreeRow[] {
  const ordered = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const rows: RepoTreeRow[] = [];
  for (const node of ordered) {
    const isOpen = node.type === "tree" && expanded.has(node.path);
    rows.push({
      node,
      depth,
      indent: Math.min(depth, REPO_TREE_MAX_INDENT),
      expanded: isOpen,
    });
    if (isOpen && node.children?.length) {
      rows.push(...flattenRepoTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

/** One row of the flat, ranked list the filter switches the rail to. */
export type RepoFilterHit = {
  path: string;
  /** Basename — identifies from the left, so it is never truncated first. */
  name: string;
  /** Parent directory, shown dimmed after the name. Empty at the root. */
  dir: string;
  sha: string;
  size?: number;
  score: number;
};

/**
 * Rank files against a filter query. Files only: with 119 entries behind a
 * seven-level spine the audience is a developer who knows the filename, and a
 * directory hit in that list is a row that cannot be opened.
 *
 * Ranking, best first: basename prefix, basename substring, then path
 * substring. Ties break on the shorter path, so `README.md` outranks
 * `docs/vendor/README.md` for the query `readme`.
 */
export function filterRepoFiles(
  entries: readonly GithubRepoTreeEntry[],
  query: string,
  limit = 200,
): RepoFilterHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: RepoFilterHit[] = [];
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const lowerPath = entry.path.toLowerCase();
    const slash = entry.path.lastIndexOf("/");
    const name = slash === -1 ? entry.path : entry.path.slice(slash + 1);
    const lowerName = name.toLowerCase();
    let score: number;
    if (lowerName.startsWith(needle)) score = 0;
    else if (lowerName.includes(needle)) score = 1;
    else if (lowerPath.includes(needle)) score = 2;
    else continue;
    hits.push({
      path: entry.path,
      name,
      dir: slash === -1 ? "" : entry.path.slice(0, slash),
      sha: entry.sha,
      ...(entry.size === undefined ? {} : { size: entry.size }),
      score,
    });
  }
  hits.sort((a, b) => (
    a.score !== b.score
      ? a.score - b.score
      : a.path.length !== b.path.length
        ? a.path.length - b.path.length
        : a.path.localeCompare(b.path)
  ));
  return hits.slice(0, limit);
}

/**
 * Breadcrumb segments for a path. Longer than `keep` segments renders
 * `root / … / parent / file`: the ends carry the meaning, the middle is spine.
 */
export type RepoCrumb = { key: string; name: string; path: string | null };

export function repoBreadcrumb(path: string, keep = 4): RepoCrumb[] {
  const segments = path.split("/").filter(Boolean);
  const crumb = (name: string, index: number): RepoCrumb => ({
    key: `${index}:${name}`,
    name,
    path: segments.slice(0, index + 1).join("/"),
  });
  if (segments.length <= keep) return segments.map(crumb);
  return [
    crumb(segments[0], 0),
    { key: "ellipsis", name: "…", path: null },
    crumb(segments[segments.length - 2], segments.length - 2),
    crumb(segments[segments.length - 1], segments.length - 1),
  ];
}

/**
 * Every ancestor directory of a path, so selecting a filter hit can open the
 * tree down to it when the filter clears.
 */
export function repoAncestorPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) out.push(segments.slice(0, i).join("/"));
  return out;
}

/**
 * The directory rows that must be open for `target` to be visible.
 *
 * Chain collapsing means a rendered row's path is the DEEPEST directory in the
 * chain it absorbed, so `repoAncestorPaths` alone does not name it: revealing
 * `a/b/c/file.ts` in a tree whose single row is `a/b/c` needs that row's path,
 * not `a`, `a/b`, `a/b/c` individually. Matching on the rendered rows instead
 * of on the string is what makes a breadcrumb segment clickable — the segment
 * `a` re-roots onto whichever collapsed row actually contains it.
 */
export function repoPathsToReveal(
  nodes: readonly RepoTreeNode[],
  target: string,
): string[] {
  const out: string[] = [];
  const walk = (level: readonly RepoTreeNode[]) => {
    for (const node of level) {
      if (node.type !== "tree") continue;
      // `target` is inside this directory, or IS it — either way it opens.
      if (target === node.path || target.startsWith(`${node.path}/`) || node.path.startsWith(`${target}/`)) {
        out.push(node.path);
        if (node.children?.length) walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * The size column's text. Directories show their child count rather than a
 * byte total, which a git tree listing does not carry.
 */
export function repoRowSizeLabel(node: RepoTreeNode): string {
  if (node.type === "tree") {
    const count = node.children?.length ?? 0;
    return count > 0 ? String(count) : "";
  }
  const kind = repoFileKind(node.path);
  if (kind === "binary") return "bin";
  return formatGithubBytes(node.size) ?? "";
}
