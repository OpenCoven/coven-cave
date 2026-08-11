import path from "node:path";

import type { CaveProject } from "./cave-projects-types.ts";
import { projectById, projectForRoot } from "./cave-projects.ts";

export type ChatProjectAccessArgs = {
  projects: CaveProject[];
  /** Explicit projectRoot from the request body, when the client sent one. */
  requestedProjectRoot?: string;
  /** Recorded cwd of the resumed conversation, when no explicit root rides. */
  resumeCwd?: string;
  /** The cwd the runtime scope resolved for this turn. */
  resolvedCwd: string;
  /** The requesting familiar's own workspace dir (realpath-resolved), when it exists. */
  familiarWorkspace?: string;
};

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
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
 * returns that project's id so the grant check runs. An explicit root that
 * matches no project fails closed as `unregistered:<root>` — audited through
 * the shared permission chokepoint, and only Supreme can proceed — with one
 * exemption: the familiar's OWN workspace. Chats with no project selected
 * boot there, the daemon records that dir as the session's cwd, and clients
 * echo the recorded cwd back as an explicit projectRoot on later turns.
 * Fail-closing on it denied the familiar its own home ("project access
 * denied" 403 on turn 2 of every no-project chat).
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

  if (!explicitRoot) return null;

  if (args.familiarWorkspace && samePath(explicitRoot, args.familiarWorkspace)) {
    return null;
  }

  return `unregistered:${projectRoot}`;
}
