/**
 * review-file-tree — the Review Deck's changed-file list, as flat rows.
 *
 * Replaces the horizontal tab strip, which truncated paths, collapsed duplicate
 * basenames onto each other, and put `aria-expanded` on what were really
 * options. Both modes flatten to one row list so the navigator can render a
 * single roving-focus listbox/tree instead of nested interactive containers:
 *
 *   - flat — files grouped under a sticky directory header, one level deep.
 *   - tree — directories nested and individually collapsible.
 *
 * Pure and JSX-free so the grouping, duplicate detection, and filtering rules
 * are unit-testable under plain `node --experimental-strip-types`.
 */

import type { ReviewFile } from "./use-review-source";

export type NavMode = "flat" | "tree";

export type NavRow =
  | { kind: "group"; id: string; path: string; label: string }
  | { kind: "dir"; id: string; path: string; label: string; level: number; collapsed: boolean }
  | {
      kind: "file";
      id: string;
      path: string;
      /** Basename — what the row leads with. */
      name: string;
      /** Directory context shown after the name; empty when the group header already says it. */
      parent: string;
      /** True when another changed file shares this basename — the case the old tabs lost. */
      duplicate: boolean;
      level: number;
      file: ReviewFile;
    };

/** The repo root has no directory name; say so rather than rendering an empty header. */
export const ROOT_GROUP = "(repo root)";

export function fileRowId(path: string): string {
  return `rd-file-${path}`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirname(path: string): string {
  const base = basename(path);
  return path.slice(0, Math.max(0, path.length - base.length - 1));
}

/** Case-insensitive substring match on the full path — a filter, not a fuzzy find. */
export function filterFiles(files: readonly ReviewFile[], query: string): ReviewFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...files];
  return files.filter((file) => file.path.toLowerCase().includes(needle));
}

function duplicateBasenames(files: readonly ReviewFile[]): Set<string> {
  const seen = new Map<string, number>();
  for (const file of files) {
    const base = basename(file.path);
    seen.set(base, (seen.get(base) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [base, count] of seen) if (count > 1) dupes.add(base);
  return dupes;
}

type TreeNode = { dirs: Map<string, TreeNode>; files: ReviewFile[] };

function emptyNode(): TreeNode {
  return { dirs: new Map(), files: [] };
}

/**
 * Build the navigator's rows. `collapsedDirs` holds the tree-mode directories
 * the reviewer has closed; everything else is open, so a fresh navigator shows
 * the whole change rather than making them expand into it.
 */
export function buildNavRows(
  files: readonly ReviewFile[],
  options: { mode: NavMode; collapsedDirs?: ReadonlySet<string> },
): NavRow[] {
  const dupes = duplicateBasenames(files);
  const rows: NavRow[] = [];

  const fileRow = (file: ReviewFile, level: number, showParent: boolean): NavRow => {
    const name = basename(file.path);
    const parent = dirname(file.path);
    return {
      kind: "file",
      id: fileRowId(file.path),
      path: file.path,
      name,
      // A duplicate basename needs its whole parent path to be told apart; a
      // unique one only needs the nearest directory as a reminder.
      parent: showParent && parent ? (dupes.has(name) ? parent : (parent.split("/").pop() ?? "")) : "",
      duplicate: dupes.has(name),
      level,
      file,
    };
  };

  if (options.mode === "flat") {
    const groups = new Map<string, ReviewFile[]>();
    for (const file of files) {
      const dir = dirname(file.path) || ROOT_GROUP;
      const bucket = groups.get(dir);
      if (bucket) bucket.push(file);
      else groups.set(dir, [file]);
    }
    for (const [dir, bucket] of groups) {
      rows.push({ kind: "group", id: `rd-group-${dir}`, path: dir, label: dir });
      for (const file of bucket) rows.push(fileRow(file, 0, false));
    }
    return rows;
  }

  const root = emptyNode();
  for (const file of files) {
    let node = root;
    for (const segment of file.path.split("/").slice(0, -1)) {
      let next = node.dirs.get(segment);
      if (!next) {
        next = emptyNode();
        node.dirs.set(segment, next);
      }
      node = next;
    }
    node.files.push(file);
  }

  const collapsed = options.collapsedDirs ?? new Set<string>();
  const walk = (node: TreeNode, level: number, prefix: string) => {
    for (const [dir, child] of node.dirs) {
      const path = prefix ? `${prefix}/${dir}` : dir;
      const isCollapsed = collapsed.has(path);
      rows.push({ kind: "dir", id: `rd-dir-${path}`, path, label: dir, level, collapsed: isCollapsed });
      if (!isCollapsed) walk(child, level + 1, path);
    }
    for (const file of node.files) rows.push(fileRow(file, level, false));
  };
  walk(root, 0, "");
  return rows;
}

/** Only file rows are navigable — group headers and directories aren't targets. */
export function navigableFiles(rows: readonly NavRow[]): string[] {
  return rows.filter((row): row is Extract<NavRow, { kind: "file" }> => row.kind === "file").map((row) => row.path);
}

/**
 * Where `key` moves the selection within the navigable rows. Returns the path
 * to open, or null when the key isn't a movement. `j`/`k` mirror the arrows so
 * the list is usable without leaving the home row.
 */
export function nextNavPath(paths: readonly string[], current: string | null, key: string): string | null {
  if (paths.length === 0) return null;
  const index = current == null ? -1 : paths.indexOf(current);
  const at = index < 0 ? 0 : index;
  switch (key) {
    case "j":
    case "ArrowDown":
      return paths[Math.min(paths.length - 1, at + 1)];
    case "k":
    case "ArrowUp":
      return paths[Math.max(0, at - 1)];
    case "Home":
      return paths[0];
    case "End":
      return paths[paths.length - 1];
    case "Enter":
    case " ":
      return paths[at];
    default:
      return null;
  }
}

export const STATUS_GLYPH: Record<ReviewFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

/** Why a file shows no diff, in the words the reader needs. */
export function noPatchCopy(reason: ReviewFile["noPatchReason"]): { title: string; hint: string } | null {
  if (reason === "github") {
    return {
      title: "No text diff from GitHub",
      hint: "GitHub returns no patch for binary files, or for a file too large for its own diff response. The file is part of this pull request — review it on GitHub.",
    };
  }
  if (reason === "budget") {
    return {
      title: "Patch not included",
      hint: "This file exceeded the diff route's shared patch budget, so its metadata arrived without a patch. The deck says so rather than showing a partial diff as complete.",
    };
  }
  return null;
}
