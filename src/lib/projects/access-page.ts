/**
 * access-page.ts
 *
 * Pure derivations for the Chat → Projects "Project access" page: the
 * workspaces/repositories section split, the none → read → full click cycle,
 * the toolbar's access counts, the search filter, and the minimal mutation
 * set behind "Set all" / "Reset all". No React, no fetch — everything here
 * unit-tests in isolation, and the component binds these to
 * /api/project-grants (POST upserts a direct grant at a level, DELETE
 * removes it).
 */

import { normalizeProjectRoot } from "../cave-projects-types.ts";
import type { ProjectAccessLevel } from "../project-access-levels.ts";

/** Tri-state a row pill can show: no grant, read, or full ("write"). */
export type AccessState = "none" | ProjectAccessLevel;

export type ProjectSection = "workspaces" | "repositories";

export const SECTION_ORDER: readonly ProjectSection[] = ["workspaces", "repositories"];

export const SECTION_LABELS: Record<ProjectSection, string> = {
  workspaces: "Workspaces",
  repositories: "Repositories",
};

/**
 * Roots inside a `.coven/workspaces` tree are familiar workspaces; every
 * other registered project is treated as a repository. Purely path-based —
 * mirrors isFamiliarWorkspaceRoot's default prefix without needing $HOME
 * (client code never knows the absolute workspaces root).
 */
export function classifyProjectSection(root: string | null | undefined): ProjectSection {
  const norm = normalizeProjectRoot(root);
  return /\/\.coven\/workspaces(\/|$)/.test(norm) ? "workspaces" : "repositories";
}

/** Stable partition of an (already sorted) project list into the two sections. */
export function splitProjectsBySection<T extends { root: string }>(
  projects: readonly T[],
): Record<ProjectSection, T[]> {
  const workspaces: T[] = [];
  const repositories: T[] = [];
  for (const project of projects) {
    (classifyProjectSection(project.root) === "workspaces" ? workspaces : repositories).push(project);
  }
  return { workspaces, repositories };
}

/** Click cycle on a row: none → read → full (write) → none. */
export function nextAccessState(current: AccessState): AccessState {
  if (current === "none") return "read";
  if (current === "read") return "write";
  return "none";
}

/** Pill face per state. `action` narrates what the next click does (titles,
 *  aria-labels), so the cycle is discoverable without documentation. */
export function accessStateMeta(state: AccessState): {
  label: string;
  action: string;
} {
  if (state === "read") return { label: "Read", action: "grant full access" };
  if (state === "write") return { label: "Full", action: "remove access" };
  return { label: "No access", action: "grant read access" };
}

export type AccessCounts = { none: number; read: number; write: number };

/** Toolbar tally — one dot per state, counted over EVERY project (never the
 *  filtered subset), so the numbers always describe the familiar's whole map. */
export function accessCounts(states: Iterable<AccessState>): AccessCounts {
  const counts: AccessCounts = { none: 0, read: 0, write: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
}

/** Case-insensitive name/path substring filter (same contract the hub used). */
export function filterProjectsByQuery<T extends { name: string; root: string }>(
  projects: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...projects];
  return projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q),
  );
}

export type AccessOp =
  | { projectId: string; op: "grant"; access: ProjectAccessLevel }
  | { projectId: string; op: "revoke" };

/**
 * The minimal real mutations behind "Set all"/"Reset all": no-ops are skipped
 * (already at the target level, or nothing to revoke), so a bulk action never
 * fires redundant requests. `direct` maps projectId → the familiar's direct
 * grant level; group-inherited access is not a direct grant and is therefore
 * never "revoked" here (the protocol has no deny overrides).
 */
export function setAllOps(
  projectIds: readonly string[],
  direct: ReadonlyMap<string, ProjectAccessLevel>,
  target: AccessState,
): AccessOp[] {
  const ops: AccessOp[] = [];
  for (const projectId of projectIds) {
    const current = direct.get(projectId) ?? null;
    if (target === "none") {
      if (current) ops.push({ projectId, op: "revoke" });
    } else if (current !== target) {
      ops.push({ projectId, op: "grant", access: target });
    }
  }
  return ops;
}
