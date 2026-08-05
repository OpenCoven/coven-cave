/**
 * Pure model for the Code surface (cave-k0ua) — the Codex-style multi-session
 * coding tab. Keeps session grouping, badge derivation, and tab vocabulary out
 * of the React tree so they stay behaviorally testable (repo convention:
 * behavioral tests for pure logic, source pins for wiring).
 */

import type { SessionRow } from "@/lib/types";
import { normalizeProjectRoot } from "./cave-projects-types.ts";
import type { PendingCodeOpen } from "./pending-code-open.ts";

/** Workbench tabs within a selected session. Diff/Files/Terminal/PR land in
 *  follow-up PRs; the vocabulary is fixed here so deep links stay stable. */
export const CODE_WORKBENCH_TABS = ["diff", "files", "terminal", "pr"] as const;
export type CodeWorkbenchTab = (typeof CODE_WORKBENCH_TABS)[number];

export function isCodeWorkbenchTab(value: string | null | undefined): value is CodeWorkbenchTab {
  return (CODE_WORKBENCH_TABS as readonly string[]).includes(value ?? "");
}

/**
 * Map a legacy `?wtab=` deep link onto the review rail (cave-0rcku).
 *
 * `diff` was renamed `changes` to match the panel it mounts. `files` and
 * `terminal` resolve to null: both are now permanent parts of the room — a
 * column and a drawer — rather than tabs, so those links land on a room that
 * already shows them and the rail keeps whatever it was going to show.
 */
export function codeRailTabForWorkbenchTab(
  tab: CodeWorkbenchTab | null | undefined,
): "changes" | "pr" | null {
  if (tab === "diff") return "changes";
  if (tab === "pr") return "pr";
  return null;
}

/**
 * Room layout thresholds (cave-k3a9u).
 *
 * These are the ONE source of truth for how much width each zone needs; the
 * CSS `minSize` strings are derived from them so a number can never drift
 * between the constraint and the decision to apply it.
 *
 * They are measured against the Room's own box, never the viewport. The
 * approved design is explicit about this — "container queries or measured
 * panel width drive compact behavior; viewport width alone is insufficient
 * because the Room can appear beside other pages" — and it is not a
 * formality: the Room renders inside the role-surface host beside the app
 * sidebar and can be placed in a split, so viewport width systematically
 * overstates the width the Room actually got.
 */
export const CODE_ROOM_RAIL_WIDTH_PX = 256;

/** The workbench's three columns (cave-0rcku): file tree, source, review rail. */
export const CODE_ROOM_TREE_WIDTH_PX = 272;
export const CODE_ROOM_MIN_VIEWER_WIDTH_PX = 380;
export const CODE_ROOM_MIN_REVIEW_WIDTH_PX = 280;

/** Below this the three columns cannot all be legible, so the workbench drills
 *  in (Files / Source / Review) instead of showing three crushed columns. */
export const CODE_ROOM_SPLIT_MIN_WIDTH_PX =
  CODE_ROOM_TREE_WIDTH_PX + CODE_ROOM_MIN_VIEWER_WIDTH_PX + CODE_ROOM_MIN_REVIEW_WIDTH_PX;

/** Below this the session rail cannot sit beside a workbench that still fits
 *  its split, so the rail becomes the landing step. Derived from the two
 *  zones it must accompany, which is what keeps this breakpoint and the split
 *  breakpoint from disagreeing the way 768px and 900px did. */
export const CODE_ROOM_RAIL_MIN_WIDTH_PX =
  CODE_ROOM_RAIL_WIDTH_PX + CODE_ROOM_SPLIT_MIN_WIDTH_PX;

/**
 * The narrow workbench's three steps (cave-0rcku). `source` is the landing
 * step: this is a reading surface, and the file you opened is what you came
 * for. The terminal is NOT a step — it is the drawer, present at every width,
 * so narrowing the room never takes the shell away.
 */
export const CODE_WORKBENCH_STEPS = ["files", "source", "review"] as const;
export type CodeWorkbenchStep = (typeof CODE_WORKBENCH_STEPS)[number];

/** Live-region copy per step, so the announcement can't drift from the label. */
export const CODE_STEP_ANNOUNCEMENT: Record<CodeWorkbenchStep, string> = {
  files: "Files shown.",
  source: "Source shown.",
  review: "Review shown.",
};

/**
 * Does a measured box have room for a zone that needs `minWidth`?
 *
 * `width === null` means "not measured yet" — the first paint, SSR, or a test
 * environment without ResizeObserver. That is not the same as "too narrow", so
 * the caller supplies a viewport-derived guess to use until the real number
 * arrives. Guessing wide on a phone would flash a crushed two-column layout
 * before correcting, which is exactly the bug this replaces.
 */
export function codeRoomFits(
  width: number | null | undefined,
  minWidth: number,
  fallbackNarrow: boolean,
): boolean {
  if (width === null || width === undefined || !Number.isFinite(width) || width <= 0) {
    return !fallbackNarrow;
  }
  return width >= minWidth;
}

/** Can the Room show the session rail beside a usable workbench? */
export function codeRoomFitsRail(
  width: number | null | undefined,
  fallbackNarrow: boolean,
): boolean {
  return codeRoomFits(width, CODE_ROOM_RAIL_MIN_WIDTH_PX, fallbackNarrow);
}

/** Can the workbench show tree, source and review side by side? */
export function codeWorkbenchFitsSplit(
  width: number | null | undefined,
  fallbackNarrow: boolean,
): boolean {
  return codeRoomFits(width, CODE_ROOM_SPLIT_MIN_WIDTH_PX, fallbackNarrow);
}

/** Top-level surface tabs: the session workbench plus Activity (the former
 *  all-content GitHub feed) and focused GitHub slices. Legacy `ctab=github`
 *  deep links normalize onto Activity. */
export const CODE_TOP_TABS = ["sessions", "activity", "prs", "issues", "reviews"] as const;
export type CodeTopTab = (typeof CODE_TOP_TABS)[number];

export function isCodeTopTab(value: string | null | undefined): value is CodeTopTab {
  return (CODE_TOP_TABS as readonly string[]).includes(value ?? "");
}

/** The GitHub content tabs (every top tab except the session workbench). */
export const CODE_GITHUB_TABS = ["activity", "prs", "issues", "reviews"] as const;
export type CodeGithubTab = (typeof CODE_GITHUB_TABS)[number];

export function isCodeGithubTab(value: string | null | undefined): value is CodeGithubTab {
  return (CODE_GITHUB_TABS as readonly string[]).includes(value ?? "");
}

/** Normalize a raw `ctab` value to a top tab. The legacy `github` value (from
 *  deep links minted before Activity was named explicitly) lands on Activity so
 *  old links keep working. */
export function normalizeCodeTopTab(raw: string | null | undefined): CodeTopTab {
  if (isCodeTopTab(raw)) return raw;
  if (raw === "github") return "activity";
  return "sessions";
}

/** A project group in the session rail: one repo/root, newest work first. */
export type CodeRailGroup = {
  /** Absolute project root shared by the group's sessions. */
  root: string;
  /** Short display label (basename of the root). */
  label: string;
  sessions: SessionRow[];
};

/**
 * Sessions that belong on the Code surface: real conversations (not
 * generator-spawned runs) that haven't been archived. Mirrors the chat list's
 * visibility posture — the rail is a different lens over the same sessions,
 * so hiding rules must not drift apart.
 */
export function isCodeRailSession(row: SessionRow): boolean {
  if (row.archived_at) return false;
  if (row.generated) return false;
  return true;
}

function projectLabel(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return base || trimmed || "(unknown)";
}

function newestUpdatedAt(rows: SessionRow[]): number {
  let newest = 0;
  for (const row of rows) {
    const t = Date.parse(row.updated_at);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

/**
 * Group rail sessions by project root, newest group first, newest session
 * first within each group. Empty roots collapse into a trailing "(unknown)"
 * group rather than being dropped — a session you can't find is worse than an
 * ugly label.
 */
export function groupCodeRailSessions(rows: SessionRow[]): CodeRailGroup[] {
  const byRoot = new Map<string, SessionRow[]>();
  for (const row of rows) {
    if (!isCodeRailSession(row)) continue;
    const root = row.project_root || "";
    const list = byRoot.get(root);
    if (list) list.push(row);
    else byRoot.set(root, [row]);
  }
  const groups: CodeRailGroup[] = [];
  for (const [root, sessions] of byRoot) {
    sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    groups.push({ root, label: root ? projectLabel(root) : "(unknown)", sessions });
  }
  groups.sort((a, b) => {
    if (!a.root && b.root) return 1;
    if (a.root && !b.root) return -1;
    return newestUpdatedAt(b.sessions) - newestUpdatedAt(a.sessions);
  });
  return groups;
}

/**
 * The branch attributable to *this session* — workBranch (conversation
 * snapshot) or a worktree's branch. Never falls back to `git.branch` for
 * shared checkouts: that's whatever the root has checked out at poll time,
 * not this session's work (cave-9q24 attribution rule).
 */
export function codeSessionBranch(row: SessionRow): string | null {
  if (row.workBranch) return row.workBranch;
  if (row.git?.isWorktree && row.git.branch) return row.git.branch;
  return row.pullRequest?.branch ?? null;
}

/** "+N −N" working-tree size, or null when unknown/clean. */
export function codeSessionDiffstat(row: SessionRow): string | null {
  const diff = row.diff;
  if (!diff) return null;
  if (!diff.additions && !diff.deletions) return null;
  return `+${diff.additions} \u2212${diff.deletions}`;
}

/**
 * The root this session's work actually happens in: its worktree when it has
 * one, else the project root. The workbench (Diff/Files/Terminal) scopes here
 * — pointing them at a shared checkout would show another session's churn
 * (cave-9q24).
 */
export function codeSessionWorkRoot(row: SessionRow): string {
  return row.git?.worktreeRoot || row.project_root;
}

/**
 * Resolve a routed open to the workbench that owns its captured root. Root
 * provenance outranks the raising session id; if no root matches, fail closed.
 */
export function codeSessionForPendingOpen(
  rows: readonly SessionRow[],
  open: PendingCodeOpen,
): SessionRow | null {
  if (open.root) {
    const targetRoot = normalizeProjectRoot(open.root);
    return (
      rows.find(
        (row) =>
          isCodeRailSession(row) &&
          normalizeProjectRoot(codeSessionWorkRoot(row)) === targetRoot,
      ) ?? null
    );
  }
  if (!open.sessionId) return null;
  return rows.find((row) => isCodeRailSession(row) && row.id === open.sessionId) ?? null;
}

export type CodeSessionActivity = "running" | "error" | "idle";

export function codeSessionActivity(row: SessionRow): CodeSessionActivity {
  if (row.status === "running") return "running";
  if (typeof row.exit_code === "number" && row.exit_code !== 0) return "error";
  return "idle";
}

export type CodeDeepLink = {
  sessionId: string | null;
  topTab: CodeTopTab;
  workbenchTab: CodeWorkbenchTab;
};

/**
 * Parse `?mode=code&session=<id>&ctab=<top>&wtab=<workbench>` search params.
 * Unknown values fall back to defaults instead of failing — deep links from
 * older builds must keep landing somewhere sensible.
 */
export function parseCodeDeepLink(params: Pick<URLSearchParams, "get">): CodeDeepLink {
  const rawTop = params.get("ctab");
  const rawTab = params.get("wtab");
  return {
    sessionId: params.get("session") || null,
    topTab: normalizeCodeTopTab(rawTop),
    workbenchTab: isCodeWorkbenchTab(rawTab) ? rawTab : "diff",
  };
}
