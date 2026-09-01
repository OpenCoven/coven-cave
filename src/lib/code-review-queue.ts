import { gitHubRepoSlug, normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import {
  codeSessionActivity,
  codeSessionDiffstat,
  isCodeRailSession,
} from "@/lib/code-surface";
import type { SessionRow } from "@/lib/types";

export type CodeQueueMode = "reviewable" | "all";

export type CodeSessionEligibility = {
  reviewable: boolean;
  reason:
    | "eligible"
    | "archived"
    | "generated"
    | "rootless"
    | "unverified_git"
    | "non_github"
    | "workspace_unclassified"
    | "familiar_workspace";
};

export type CodeReviewGroup = {
  key: string;
  label: string;
  sessions: SessionRow[];
};

export type CodeReviewQueue = {
  groups: CodeReviewGroup[];
  sessions: SessionRow[];
  reviewableCount: number;
  allLocalCount: number;
  excludedCount: number;
  outsideCurrentFilter: boolean;
};

type GroupRecord = {
  key: string;
  label: string;
  sessions: SessionRow[];
  bestPriority: number;
  newestUpdate: number;
};

function projectLabel(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return base || trimmed || "(unknown)";
}

function updatedAt(row: SessionRow): number {
  const parsed = Date.parse(row.updated_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reviewPriority(row: SessionRow): number {
  const activity = codeSessionActivity(row);
  if (activity === "error") return 0;
  if (
    row.pullRequest &&
    (row.pullRequest.state ?? "open").toLowerCase() === "open" &&
    codeSessionDiffstat(row)
  ) {
    return 1;
  }
  if (activity === "running") return 2;
  if (codeSessionDiffstat(row)) return 3;
  return 4;
}

function compareSessions(a: SessionRow, b: SessionRow): number {
  const priorityDelta = reviewPriority(a) - reviewPriority(b);
  if (priorityDelta !== 0) return priorityDelta;
  const updateDelta = updatedAt(b) - updatedAt(a);
  if (updateDelta !== 0) return updateDelta;
  return a.id.localeCompare(b.id);
}

function groupKey(row: SessionRow, mode: CodeQueueMode): string {
  if (mode === "reviewable") {
    const repositoryUrl = row.git?.repositoryUrl?.trim();
    if (repositoryUrl) return repositoryUrl;
  }
  return row.project_root || "";
}

function groupLabel(row: SessionRow, mode: CodeQueueMode): string {
  if (mode === "reviewable") {
    const slug = gitHubRepoSlug(row.git?.repositoryUrl);
    if (slug) return slug;
  }
  return row.project_root ? projectLabel(row.project_root) : "(unknown)";
}

function buildGroups(rows: readonly SessionRow[], mode: CodeQueueMode): GroupRecord[] {
  const byKey = new Map<string, GroupRecord>();
  for (const row of rows) {
    const key = groupKey(row, mode);
    const label = groupLabel(row, mode);
    const existing = byKey.get(key);
    if (existing) existing.sessions.push(row);
    else byKey.set(key, { key, label, sessions: [row], bestPriority: Number.POSITIVE_INFINITY, newestUpdate: 0 });
  }

  const groups = [...byKey.values()];
  for (const group of groups) {
    group.sessions.sort(compareSessions);
    group.bestPriority = group.sessions.length ? reviewPriority(group.sessions[0]) : Number.POSITIVE_INFINITY;
    group.newestUpdate = group.sessions.reduce((newest, row) => Math.max(newest, updatedAt(row)), 0);
  }

  groups.sort((a, b) => {
    if (mode === "all") {
      if (!a.key && b.key) return 1;
      if (a.key && !b.key) return -1;
    }
    const priorityDelta = a.bestPriority - b.bestPriority;
    if (priorityDelta !== 0) return priorityDelta;
    const updateDelta = b.newestUpdate - a.newestUpdate;
    if (updateDelta !== 0) return updateDelta;
    const labelDelta = a.label.localeCompare(b.label);
    if (labelDelta !== 0) return labelDelta;
    return a.key.localeCompare(b.key);
  });

  return groups;
}

export function codeSessionEligibility(row: SessionRow): CodeSessionEligibility {
  if (row.archived_at) return { reviewable: false, reason: "archived" };
  if (row.generated) return { reviewable: false, reason: "generated" };
  if (!row.project_root.trim()) return { reviewable: false, reason: "rootless" };

  const git = row.git;
  if (!git || git.isWorktree !== true || !git.worktreeRoot?.trim()) {
    return { reviewable: false, reason: "unverified_git" };
  }

  const repositoryUrl = git.repositoryUrl?.trim();
  if (!repositoryUrl || normalizeGitHubRepoUrl(repositoryUrl) !== repositoryUrl) {
    return { reviewable: false, reason: "non_github" };
  }

  if (row.familiarWorkspace === undefined) {
    return { reviewable: false, reason: "workspace_unclassified" };
  }
  if (row.familiarWorkspace) return { reviewable: false, reason: "familiar_workspace" };
  return { reviewable: true, reason: "eligible" };
}

export function codeReviewQueue(
  rows: readonly SessionRow[],
  mode: CodeQueueMode,
  selectedId: string | null,
): CodeReviewQueue {
  const allLocal = rows.filter((row) => isCodeRailSession(row));
  const reviewable = allLocal.filter((row) => codeSessionEligibility(row).reviewable);
  const visible = mode === "reviewable" ? reviewable : allLocal;
  const groups = buildGroups(visible, mode);

  let outsideCurrentFilter = false;
  if (selectedId) {
    const selected = rows.find((row) => row.id === selectedId) ?? null;
    const alreadyVisible = visible.some((row) => row.id === selectedId);
    if (selected && !alreadyVisible) {
      outsideCurrentFilter = true;
      const key = groupKey(selected, mode);
      const label = groupLabel(selected, mode);
      const existingGroup = groups.find((group) => group.key === key);
      if (existingGroup) {
        if (!existingGroup.sessions.some((row) => row.id === selected.id)) existingGroup.sessions.push(selected);
      } else {
        groups.push({
          key,
          label,
          sessions: [selected],
          bestPriority: reviewPriority(selected),
          newestUpdate: updatedAt(selected),
        });
      }
    }
  }

  const flatSessions = groups.flatMap((group) => group.sessions);
  return {
    groups: groups.map(({ key, label, sessions }) => ({ key, label, sessions })),
    sessions: flatSessions,
    reviewableCount: reviewable.length,
    allLocalCount: allLocal.length,
    excludedCount: allLocal.length - reviewable.length,
    outsideCurrentFilter,
  };
}
