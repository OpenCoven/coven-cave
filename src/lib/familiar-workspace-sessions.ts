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
 */
export function isFamiliarWorkspaceRoot(
  projectRoot: string | null | undefined,
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): boolean {
  const root = normalizeProjectRoot(projectRoot);
  if (root === "/") return false;
  const prefixes = [familiarWorkspacesRoot, ...declaredWorkspaceRoots]
    .map((p) => normalizeProjectRoot(p))
    .filter((p) => p !== "/");
  return prefixes.some(
    (prefix) => root === prefix || root.startsWith(`${prefix}/`),
  );
}

/**
 * Drop sessions whose `project_root` is a familiar-workspace root. Sessions
 * with no/rootless project ("(no project)" bucket) and real registered-project
 * sessions are always kept. Pure — safe to call on the response path.
 */
export function collapseFamiliarWorkspaceSessions(
  sessions: SessionRow[],
  familiarWorkspacesRoot: string,
  declaredWorkspaceRoots: readonly string[] = [],
): SessionRow[] {
  return sessions.filter(
    (session) =>
      !isFamiliarWorkspaceRoot(
        session.project_root,
        familiarWorkspacesRoot,
        declaredWorkspaceRoots,
      ),
  );
}
