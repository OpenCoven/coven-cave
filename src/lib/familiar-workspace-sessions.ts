/**
 * familiar-workspace-sessions.ts
 *
 * The unscoped/global sessions dashboard shows EVERY session the daemon knows,
 * including the flood of auto-generated per-familiar workspace runs (daily
 * journal narratives, thread reflections) whose `project_root` is a familiar's
 * own workspace under `~/.coven/workspaces/familiars/<id>`. Those legitimately
 * exist, but they drown the handful of real project sessions and make the
 * global list look "contradictory" versus the clean, project-scoped familiar
 * homes (which drop them via project-grant scoping).
 *
 * This module is a PURE classifier + filter. It never touches the filesystem;
 * the caller passes the already-resolved familiar-workspace roots (from
 * coven-paths) so this stays trivially unit-testable. Callers opt in — the
 * default unscoped behaviour is unchanged, so nothing silently disappears.
 */

import { normalizeProjectRoot } from "@/lib/cave-projects-types";
import type { SessionRow } from "@/lib/types";

/**
 * True when `projectRoot` is inside the familiar-workspaces tree — either the
 * shared `<workspacesRoot>/familiars/...` prefix or one of the explicitly
 * declared per-familiar workspace roots (familiars.toml can relocate them).
 *
 * Matching is prefix-based on normalized paths so both the workspace root
 * itself and any nested subdir (notes/, memory/, ...) are recognized.
 *
 * Purely path-based: it has no knowledge of registered projects, so a project
 * whose root literally lives inside the familiar-workspaces tree would match.
 * That is not a real configuration (project roots and familiar workspaces are
 * distinct trees), but callers that need to guarantee an exemption should
 * filter such roots out before calling.
 */
export function isFamiliarWorkspaceRoot(
  projectRoot: string | null | undefined,
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): boolean {
  return matchesFamiliarWorkspacePrefix(
    projectRoot,
    normalizeFamiliarWorkspacePrefixes(familiarWorkspacesRoot, declaredWorkspaceRoots),
  );
}

/**
 * Normalize the familiar-workspace prefix list once. Pulled out so the filter
 * below builds it a single time instead of per-session (Copilot review: avoid
 * re-normalizing the same prefixes for every row on large session lists).
 */
function normalizeFamiliarWorkspacePrefixes(
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): string[] {
  return [familiarWorkspacesRoot, ...declaredWorkspaceRoots]
    .map((p) => normalizeProjectRoot(p))
    .filter((p) => p !== "/");
}

/** Prefix test against an already-normalized prefix list. */
function matchesFamiliarWorkspacePrefix(
  projectRoot: string | null | undefined,
  normalizedPrefixes: readonly string[],
): boolean {
  const root = normalizeProjectRoot(projectRoot);
  if (root === "/") return false;
  return normalizedPrefixes.some(
    (prefix) => root === prefix || root.startsWith(`${prefix}/`),
  );
}

/**
 * Drop sessions whose `project_root` is a familiar-workspace root. Sessions
 * with no/rootless project (the "(no project)" bucket) are kept, as are all
 * sessions whose root is not inside the familiar-workspaces tree — which in
 * normal configurations means every real registered-project session, since
 * project roots live outside that tree. Pure — safe to call on the response
 * path.
 */
export function collapseFamiliarWorkspaceSessions(
  sessions: SessionRow[],
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): SessionRow[] {
  // Normalize the prefix list once, then test each row inline.
  const prefixes = normalizeFamiliarWorkspacePrefixes(familiarWorkspacesRoot, declaredWorkspaceRoots);
  return sessions.filter(
    (session) => !matchesFamiliarWorkspacePrefix(session.project_root, prefixes),
  );
}
