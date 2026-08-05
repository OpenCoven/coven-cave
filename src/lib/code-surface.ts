/**
 * Pure model for the Code surface (cave-k0ua) — the Codex-style multi-session
 * coding tab. Keeps session grouping, badge derivation, and tab vocabulary out
 * of the React tree so they stay behaviorally testable (repo convention:
 * behavioral tests for pure logic, source pins for wiring).
 */

import type { SessionRow } from "@/lib/types";
import {
  isAbsoluteProjectPath,
  normalizeProjectRoot,
  projectRootsEqual,
  resolvePathWithinProjectRoot,
} from "./cave-projects-types.ts";
import type { PendingCodeOpen } from "./pending-code-open.ts";

/** Workbench tabs within a selected session. Diff/Files/Terminal/PR land in
 *  follow-up PRs; the vocabulary is fixed here so deep links stay stable. */
export const CODE_WORKBENCH_TABS = ["diff", "files", "terminal", "pr"] as const;
export type CodeWorkbenchTab = (typeof CODE_WORKBENCH_TABS)[number];

export function isCodeWorkbenchTab(value: string | null | undefined): value is CodeWorkbenchTab {
  return (CODE_WORKBENCH_TABS as readonly string[]).includes(value ?? "");
}

/**
 * Context dock tabs in the three-zone Coding Room (cave-98o51). The terminal is
 * no longer one of these — it is the Room's persistent center, which is the
 * whole point of the redesign: diffs and files sit BESIDE a running shell
 * instead of competing with it for one canvas.
 */
export const CODE_DOCK_TABS = [
  "changes",
  "files",
  "pr",
  "inspector",
  "github",
  "browser",
] as const;
export type CodeDockTab = (typeof CODE_DOCK_TABS)[number];

export function isCodeDockTab(value: string | null | undefined): value is CodeDockTab {
  return (CODE_DOCK_TABS as readonly string[]).includes(value ?? "");
}

/**
 * Map a legacy `?wtab=` workbench tab onto the dock. `diff` was renamed
 * `changes` to match the panel it mounts, and `terminal` resolves to null —
 * that deep link now lands on the always-present center, so the dock keeps
 * whatever it was showing rather than being forced somewhere arbitrary.
 */
export function codeDockTabForWorkbenchTab(
  tab: CodeWorkbenchTab | null | undefined,
): CodeDockTab | null {
  if (tab === "diff") return "changes";
  if (tab === "files") return "files";
  if (tab === "pr") return "pr";
  return null;
}

/** How much room the context dock takes beside the terminal center. Browser and
 *  GitHub open `expanded` because a native webview — or a list/detail split —
 *  squeezed into a sidebar renders a column of wrapped text nobody can use. */
export const CODE_DOCK_SIZES = ["collapsed", "normal", "expanded"] as const;
export type CodeDockSize = (typeof CODE_DOCK_SIZES)[number];

/** Dock tabs that need the expanded width to be legible at all. Selecting one
 *  from a normal or collapsed dock widens it rather than rendering something
 *  unusable. */
export function codeDockTabWantsExpanded(tab: CodeDockTab): boolean {
  return tab === "browser" || tab === "github";
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

/** Resolve a Files-tab path without relying on the host OS's path flavor. */
export function resolveCodeWorkbenchFilePath(projectRoot: string, candidatePath: string): string {
  if (Boolean(isAbsoluteProjectPath(candidatePath))) return candidatePath;
  return `${projectRoot.replace(/\/$/, "")}/${candidatePath.replace(/^\.?\//, "")}`;
}

/** Validate and canonicalize immutable root provenance carried by a routed open. */
export function codePendingOpenProjectRoot(
  open: PendingCodeOpen | null | undefined,
): string | null {
  const root = open?.root;
  if (
    !root?.trim() ||
    /[\0-\x1f\x7f]/.test(root) ||
    !isAbsoluteProjectPath(root)
  ) {
    return null;
  }
  const normalized = normalizeProjectRoot(root);
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) return null;
  const candidatePath = open?.path;
  if (candidatePath && !resolvePathWithinProjectRoot(normalized, candidatePath)) return null;
  return normalized;
}

/**
 * Resolve a routed open to the workbench that owns its captured root. Root
 * provenance scopes the dock, while an immutable source session chooses the
 * host workbench when it is still available. If that session has since changed
 * projects, it still hosts the handoff; the dock keeps the captured root.
 */
export function codeSessionForPendingOpen(
  rows: readonly SessionRow[],
  open: PendingCodeOpen,
): SessionRow | null {
  const capturedRoot = codePendingOpenProjectRoot(open);
  if (!capturedRoot) return null;
  const byRoot = rows.find(
    (row) =>
      isCodeRailSession(row) &&
      projectRootsEqual(codeSessionWorkRoot(row), capturedRoot),
  );
  const byId = open.sessionId
    ? rows.find((row) => isCodeRailSession(row) && row.id === open.sessionId)
    : undefined;
  return byId ?? byRoot ?? null;
}

export type CodePendingOpenResolution =
  | { status: "waiting"; capturedRoot: string; target: null }
  | { status: "invalid"; capturedRoot: null; target: null }
  | { status: "absent"; capturedRoot: string; target: null }
  | { status: "ready"; capturedRoot: string; target: SessionRow };

/**
 * Keep rooted opens pending until the current scoped inventory is authoritative.
 * Rootless historical payloads fail closed: a session id or selected workbench
 * must never be used to infer the missing immutable root.
 */
export function resolveCodePendingOpen(
  rows: readonly SessionRow[],
  open: PendingCodeOpen,
  sessionsLoaded: boolean,
): CodePendingOpenResolution {
  const capturedRoot = codePendingOpenProjectRoot(open);
  if (!capturedRoot) {
    return { status: "invalid", capturedRoot: null, target: null };
  }
  if (!sessionsLoaded) {
    return { status: "waiting", capturedRoot, target: null };
  }
  const target = codeSessionForPendingOpen(rows, open);
  if (!target) {
    return { status: "absent", capturedRoot, target: null };
  }
  return { status: "ready", capturedRoot, target };
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
