/**
 * session-project-scope.ts
 *
 * Pure helper that restricts a session list to what a familiar may see, by
 * project grant. The actual grant resolution lives in project-permissions.ts
 * (filesystem + audit); this module only applies an already-resolved permitted
 * set, so it stays pure and trivially testable.
 *
 * Policy (matches the chat surface's "(no project)" bucket):
 *   - A session whose `project_root` maps to a KNOWN project is kept only when
 *     that project is in `permittedProjects`.
 *   - A session whose `project_root` maps to NO known project (rootless or an
 *     ad-hoc cwd) is always kept — it surfaces under "(no project)".
 *
 * The supreme familiar passes the full project list as `permittedProjects`, so
 * nothing is dropped.
 */

import { normalizeProjectRoot, type CaveProject } from "@/lib/cave-projects-types";
import type { SessionRow } from "@/lib/types";

export function scopeSessionsToFamiliarProjects(
  sessions: SessionRow[],
  allProjects: CaveProject[],
  permittedProjects: CaveProject[],
): SessionRow[] {
  const knownRoots = new Set(allProjects.map((p) => normalizeProjectRoot(p.root)));
  const permittedRoots = new Set(permittedProjects.map((p) => normalizeProjectRoot(p.root)));
  return sessions.filter((session) => {
    const root = normalizeProjectRoot(session.project_root);
    if (!knownRoots.has(root)) return true; // unknown project → "(no project)" bucket
    return permittedRoots.has(root); // known project → only if granted
  });
}
