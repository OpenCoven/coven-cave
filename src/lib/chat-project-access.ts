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
  /** The requesting familiar's own workspace dir (realpath-resolved), when it exists. */
  familiarWorkspace?: string;
};

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
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
