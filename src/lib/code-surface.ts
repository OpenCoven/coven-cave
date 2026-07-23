/**
 * Pure model for the Code surface (cave-k0ua) — the Codex-style multi-session
 * coding tab. Keeps session grouping, badge derivation, and tab vocabulary out
 * of the React tree so they stay behaviorally testable (repo convention:
 * behavioral tests for pure logic, source pins for wiring).
 */

import type { SessionRow } from "@/lib/types";

/** Workbench tabs within a selected session. Diff/Files/Terminal/PR land in
 *  follow-up PRs; the vocabulary is fixed here so deep links stay stable. */
export const CODE_WORKBENCH_TABS = ["diff", "files", "terminal", "pr"] as const;
export type CodeWorkbenchTab = (typeof CODE_WORKBENCH_TABS)[number];

export function isCodeWorkbenchTab(value: string | null | undefined): value is CodeWorkbenchTab {
  return (CODE_WORKBENCH_TABS as readonly string[]).includes(value ?? "");
}

/** Top-level surface tabs: the session workbench, or the absorbed GitHub view. */
export const CODE_TOP_TABS = ["sessions", "github"] as const;
export type CodeTopTab = (typeof CODE_TOP_TABS)[number];

export function isCodeTopTab(value: string | null | undefined): value is CodeTopTab {
  return (CODE_TOP_TABS as readonly string[]).includes(value ?? "");
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
    topTab: isCodeTopTab(rawTop) ? rawTop : "sessions",
    workbenchTab: isCodeWorkbenchTab(rawTab) ? rawTab : "diff",
  };
}
