/**
 * Diff · PR rail model for the Coding Desk (cave-0rcku).
 *
 * The `Cody Code Reading v2` frame docks review beside the source rather than
 * over it: a rail you drag to resize, double-click to swap between a reading
 * width and half the room, and close to a 28px spine that still prints the
 * diffstat. This module owns the arithmetic and the review bookkeeping so the
 * component stays a renderer.
 *
 * The spine is the load-bearing part. A closed panel that vanished would make
 * "is there anything to review?" unanswerable without reopening it, so the
 * collapsed state keeps the one fact that decides whether you reopen — how big
 * the diff is.
 */

/**
 * Rail tabs. `changes` is the working tree; `pr` is the pull request;
 * `filesystem` is the AFS delta (cave-je2q9) — a session's agent-filesystem
 * change set, provenance timeline, and commit action, which is a different
 * thing from the checkout's working tree.
 */
export const CODE_RAIL_TABS = ["changes", "pr", "filesystem"] as const;
export type CodeRailTab = (typeof CODE_RAIL_TABS)[number];

import { CODE_ROOM_MIN_VIEWER_WIDTH_PX, CODE_ROOM_TREE_WIDTH_PX } from "./code-surface.ts";

export function isCodeRailTab(value: string | null | undefined): value is CodeRailTab {
  return (CODE_RAIL_TABS as readonly string[]).includes(value ?? "");
}

/** Narrower than this and a unified diff wraps into unreadable confetti. */
export const CODE_RAIL_MIN_WIDTH_PX = 280;
/** The rail is context, never the subject — past this the viewer starves. */
export const CODE_RAIL_MAX_FRACTION = 0.62;
/** Resting width: wide enough for a hunk, narrow enough to keep the source lead. */
export const CODE_RAIL_DEFAULT_WIDTH_PX = 360;
/** Closed width — the spine. Wide enough for vertical text plus the diffstat. */
export const CODE_RAIL_SPINE_WIDTH_PX = 28;

/** What the rail must leave beside it: the fixed tree column and the source
 *  viewer at its minimum. A fraction of the room alone let a drag starve the
 *  viewer to 146px at the narrowest split (#5729). */
export const CODE_RAIL_RESERVED_PX = CODE_ROOM_TREE_WIDTH_PX + CODE_ROOM_MIN_VIEWER_WIDTH_PX;

/**
 * Clamp a dragged width against the room it has to live in.
 *
 * The ceiling is the smaller of a fraction of the room and whatever the tree
 * and a minimum-width viewer leave over.
 *
 * When the room itself is too small to honour the minimum, the minimum wins and
 * the caller's overflow rules take over: silently returning a sub-minimum width
 * would render a rail whose contents cannot be read, which is the failure the
 * minimum exists to prevent.
 */
export function clampCodeRailWidth(widthPx: number, roomWidthPx: number): number {
  const max = Math.max(
    CODE_RAIL_MIN_WIDTH_PX,
    Math.min(Math.round(roomWidthPx * CODE_RAIL_MAX_FRACTION), Math.round(roomWidthPx) - CODE_RAIL_RESERVED_PX),
  );
  if (!Number.isFinite(widthPx)) return CODE_RAIL_DEFAULT_WIDTH_PX;
  return Math.min(max, Math.max(CODE_RAIL_MIN_WIDTH_PX, Math.round(widthPx)));
}

/**
 * The width double-clicking the divider toggles to and from — the frame's
 * "double-click for half width". Half the room when the rail is at its reading
 * width, back to the reading width when it is already wide.
 */
export function toggleCodeRailWidth(widthPx: number, roomWidthPx: number): number {
  const half = clampCodeRailWidth(Math.round(roomWidthPx / 2), roomWidthPx);
  const resting = clampCodeRailWidth(CODE_RAIL_DEFAULT_WIDTH_PX, roomWidthPx);
  return Math.abs(widthPx - half) <= 2 ? resting : half;
}

/**
 * Is this rail at (or past) its widened width? Drives the widen/restore icon.
 * Measured against the clamped half, which the reserve can hold below half the
 * room, so a widened rail always reads as widened. A room too narrow to widen
 * at all is never "wide".
 */
export function isCodeRailWide(widthPx: number, roomWidthPx: number): boolean {
  const half = clampCodeRailWidth(Math.round(roomWidthPx / 2), roomWidthPx);
  const resting = clampCodeRailWidth(CODE_RAIL_DEFAULT_WIDTH_PX, roomWidthPx);
  return half > resting && widthPx >= half - 2;
}

/**
 * Per-file review bookkeeping — the frame's "viewed" checkbox and its
 * "N of M viewed" readout.
 *
 * Keyed by path and reconciled against the live file list on every read, so a
 * file that changes again after you ticked it does NOT stay ticked: `viewed`
 * means "I have read this version", and the diff panel already keys its rows by
 * path + status. Callers pass the current signature (status plus line counts)
 * and a stale entry is dropped.
 */
export type CodeRailViewedState = Record<string, string>;

/** The shape a viewed tick is recorded against. */
export type CodeRailFileShape = {
  path: string;
  status?: string | null;
  additions?: number | null;
  deletions?: number | null;
  /** The server's filesystem stamp. Status and line counts alone let an edit
   *  that keeps the same counts keep its tick (#5720 review). */
  version?: string | null;
};

/** The signature a viewed tick is recorded against. */
export function codeRailFileSignature(file: CodeRailFileShape): string {
  const base = `${file.status ?? ""}:${file.additions ?? 0}:${file.deletions ?? 0}`;
  return file.version ? `${base}:${file.version}` : base;
}

/** One mapping from a changes-API file to its viewed shape, for every caller. */
export function codeRailShapeOf(file: {
  path: string;
  status?: string | null;
  insertions?: number | null;
  deletions?: number | null;
  changeVersion?: string | null;
}): CodeRailFileShape {
  return {
    path: file.path,
    status: file.status,
    additions: file.insertions,
    deletions: file.deletions,
    version: file.changeVersion ?? null,
  };
}

export function isCodeRailFileViewed(
  viewed: CodeRailViewedState,
  file: CodeRailFileShape,
): boolean {
  return viewed[file.path] === codeRailFileSignature(file);
}

export function toggleCodeRailViewed(
  viewed: CodeRailViewedState,
  file: CodeRailFileShape,
): CodeRailViewedState {
  const next = { ...viewed };
  if (isCodeRailFileViewed(viewed, file)) delete next[file.path];
  else next[file.path] = codeRailFileSignature(file);
  return next;
}

export function countCodeRailViewed(
  viewed: CodeRailViewedState,
  files: readonly CodeRailFileShape[],
): number {
  return files.reduce((total, file) => total + (isCodeRailFileViewed(viewed, file) ? 1 : 0), 0);
}

/**
 * Widths of the two segments in the frame's added/removed bar, as percentages
 * that always sum to 100. A diff of nothing returns zeros so the caller can
 * hide the bar rather than paint a full-width lie.
 */
export function codeRailDiffBar(additions: number, deletions: number): {
  addedPct: number;
  removedPct: number;
} {
  const total = Math.max(0, additions) + Math.max(0, deletions);
  if (total <= 0) return { addedPct: 0, removedPct: 0 };
  const addedPct = Math.round((Math.max(0, additions) / total) * 100);
  return { addedPct, removedPct: 100 - addedPct };
}

/**
 * The next changed file not yet marked viewed, starting after `currentPath`
 * and wrapping — the desk's "Next unviewed" action (#5705). Null when every
 * file is viewed or there are none, so the control can disable itself
 * rather than reopen the file you are on.
 */
export function nextUnviewedCodeFile<T extends CodeRailFileShape>(files: readonly T[], viewed: CodeRailViewedState, currentPath: string | null): T | null {
  if (!files.length) return null;
  const start = currentPath ? files.findIndex((file) => file.path === currentPath) : -1;
  for (let offset = 1; offset <= files.length; offset += 1) {
    const candidate = files[(start + offset) % files.length];
    if (!isCodeRailFileViewed(viewed, candidate)) return candidate;
  }
  return null;
}

/**
 * A stable key for a changes snapshot: every file's path and viewed signature
 * (status, counts, filesystem stamp), order-insensitive. Two lists with the
 * same key describe the same worktree state (#5720 review).
 */
export function codeChangeSnapshotKey(files: readonly CodeRailFileShape[]): string {
  return files
    .map((file) => `${file.path}\u0000${codeRailFileSignature(file)}`)
    .sort()
    .join("\u0001");
}
