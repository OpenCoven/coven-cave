import path from "node:path";

import type { CaveProject } from "./cave-projects-types.ts";
import { projectForRoot } from "./cave-projects.ts";

export type ChatProjectAccessArgs = {
  projects: CaveProject[];
  /** Explicit projectRoot from the request body, when the client sent one. */
  requestedProjectRoot?: string;
  /** Recorded cwd of the resumed conversation, when no explicit root rides. */
  resumeCwd?: string;
  /** The cwd the runtime scope resolved for this turn. */
  resolvedCwd: string;
  /** Legacy caller context. Familiar workspaces no longer bypass project registration. */
  familiarWorkspace?: string;
};

/**
 * The registered project whose `.worktrees/` directory contains `root`, if
 * any. Separator-exact and traversal-safe: the candidate is `path.resolve`d
 * (collapsing `..` escapes) and must sit strictly BELOW
 * `<project>/.worktrees/`, so `/proj-evil/...`, `/proj/.worktrees` itself,
 * and `/proj/.worktrees/../..` all miss.
 */
function worktreeParentProject(root: string, projects: CaveProject[]): CaveProject | null {
  const resolved = path.resolve(root);
  for (const project of projects) {
    const prefix = path.resolve(project.root) + path.sep + ".worktrees" + path.sep;
    if (resolved.startsWith(prefix) && resolved.length > prefix.length) return project;
  }
  return null;
}

/**
 * Resolve the project id a chat request must hold a grant for, or null when
 * the request is not project-scoped (no permission check applies).
 *
 * Registered projects win: an explicit or resumed root that maps to a project
 * returns that project's id so the grant check runs. A root that matches no
 * project fails closed as `unregistered:<root>`. Familiar workspaces are not
 * exempt: Chat requires a registered project for new and continued turns.
 *
 * A second carve-out routes rather than skips the check: an explicit root
 * sitting below a registered project's `.worktrees/` directory authorizes
 * against THAT project. Worktrees are intentionally not separate project
 * records (see the Board handoff exemption in the send route), so a
 * `.worktrees/<branch>` checkout — e.g. the Code surface's fresh-worktree
 * kickoff — must vet the familiar's grant on the parent project instead of
 * fail-closing as an arbitrary unregistered directory. The grant check still
 * runs; no access is conceded.
 */
export function chatProjectAccessId(args: ChatProjectAccessArgs): string | null {
  const explicitRoot = args.requestedProjectRoot?.trim() || undefined;
  const resumedRoot = !explicitRoot ? args.resumeCwd?.trim() || undefined : undefined;
  const projectRoot = explicitRoot ?? resumedRoot;
  if (!projectRoot) return null;

  const project =
    projectForRoot(projectRoot, args.projects) ??
    projectForRoot(args.resolvedCwd, args.projects);
  if (project) return project.id;

  const worktreeParent = worktreeParentProject(projectRoot, args.projects);
  if (worktreeParent) return worktreeParent.id;

  return `unregistered:${projectRoot}`;
}
