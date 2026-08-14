import path from "node:path";

import type { CaveProject } from "./cave-projects-types.ts";
import { projectById, projectForRoot } from "./cave-projects.ts";
import { realpathOrResolve } from "./server/canonical-path.ts";

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
 * The registered project whose `.worktrees/` directory contains BOTH the
 * requested root and the cwd the runtime actually resolved for this turn.
 *
 * Separator-exact and traversal-safe: every path is canonicalized with
 * `realpathOrResolve` (collapsing `..` escapes AND symlinks) and must sit
 * strictly BELOW `<project>/.worktrees/`, so `/proj-evil/...`,
 * `/proj/.worktrees` itself, and `/proj/.worktrees/../..` all miss.
 *
 * Checking the resolved cwd is the security half: the requested root is
 * client-supplied, so on its own it only proves the CLIENT spelled a path
 * under a registered project. A symlink at `<project>/.worktrees/<name>`
 * pointing anywhere else would otherwise hand the caller the parent project's
 * grant while the harness ran outside it. `resolvedCwd` arrives realpathed
 * from `resolveLocalRuntimeCwd`, so requiring it under the same prefix pins
 * authorization to where the work will actually happen.
 *
 * Canonicalizing the project root is the correctness half, and it is required
 * for the check above to be usable: `project.root` is stored as registered,
 * so a project registered through a symlinked path — or any root with a
 * symlinked ancestor, `/var -> /private/var` on macOS being the everyday case
 * — builds a prefix the realpathed cwd can never start with, and every
 * legitimate `.worktrees/<branch>` chat fails closed as unregistered. Putting
 * both sides in one namespace never widens containment: a symlink that
 * escapes the project resolves outside the prefix and still misses.
 */
function worktreeParentProject(
  root: string,
  resolvedCwd: string,
  projects: CaveProject[],
): CaveProject | null {
  const requested = realpathOrResolve(root);
  const realCwd = realpathOrResolve(resolvedCwd);
  for (const project of projects) {
    const prefix = realpathOrResolve(project.root) + path.sep + ".worktrees" + path.sep;
    if (
      requested.startsWith(prefix) &&
      requested.length > prefix.length &&
      realCwd.startsWith(prefix) &&
      realCwd.length > prefix.length
    ) {
      return project;
    }
  }
  return null;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    rel === "" ||
    (
      rel !== ".." &&
      !rel.startsWith(".." + path.sep) &&
      !path.isAbsolute(rel) &&
      !rel.split(path.sep).includes("..")
    )
  );
}

export type TaskWorktreeProjectAccessArgs = {
  projects: CaveProject[];
  startNewConversation: boolean;
  hasExistingConversation: boolean;
  taskProjectId?: string | null;
  taskCwd?: string | null;
  requestedProjectRoot?: string;
  resolvedCwd: string;
};

export function taskWorktreeProjectAccessId(
  args: TaskWorktreeProjectAccessArgs,
): string | null {
  if (
    !args.startNewConversation ||
    args.hasExistingConversation ||
    !args.taskProjectId ||
    !args.taskCwd ||
    !args.requestedProjectRoot ||
    args.taskCwd !== args.requestedProjectRoot
  ) {
    return null;
  }

  const taskProject = projectById(args.taskProjectId, args.projects);
  if (!taskProject) return `unregistered:${args.requestedProjectRoot}`;

  // Board worktrees are allowed as a first-turn shortcut only when the
  // symlink-resolved runtime cwd remains inside the task's registered project.
  // Otherwise the normal unregistered-project chokepoint must deny the turn
  // instead of authorizing one project while spawning the harness elsewhere.
  if (!isInsideRoot(taskProject.root, args.resolvedCwd)) {
    return `unregistered:${args.resolvedCwd}`;
  }

  return args.taskProjectId;
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

  const worktreeParent = worktreeParentProject(projectRoot, args.resolvedCwd, args.projects);
  if (worktreeParent) return worktreeParent.id;

  return `unregistered:${projectRoot}`;
}
