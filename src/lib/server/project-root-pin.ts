import fs from "node:fs";
import path from "node:path";
import type { CaveProject } from "../cave-projects-types.ts";
import { loadProjects } from "../cave-projects.ts";
import { ChatProjectLaunchError } from "./chat-project-launch.ts";

type PinnedProject = Pick<CaveProject, "id" | "name" | "root" | "rootRealpath">;

/** Return only the confirmed directory, never a freshly adopted symlink target. */
export function pinnedProjectRoot(project: PinnedProject): string | null {
  const pin = project.rootRealpath;
  if (!pin || !path.isAbsolute(pin)) return null;
  try {
    return fs.realpathSync.native(/* turbopackIgnore: true */ project.root) === pin
      && fs.realpathSync.native(/* turbopackIgnore: true */ pin) === pin
      ? pin : null;
  } catch {
    return null;
  }
}

/** Recheck immediately before dispatch/spawn, including every retry. */
export function assertPinnedLaunchRoot(project: PinnedProject, expectedCwd: string): void {
  if (!project.rootRealpath) {
    throw new ChatProjectLaunchError("project_root_unconfirmed", 409,
      `Confirm ${project.name}’s folder in project settings before starting chat.`);
  }
  let cwd: string | null = null;
  try {
    cwd = fs.realpathSync.native(/* turbopackIgnore: true */ expectedCwd);
  } catch { /* A removed folder cannot retain launch authority. */ }
  const pin = pinnedProjectRoot(project);
  const relative = pin && cwd ? path.relative(pin, cwd) : null;
  if (!pin || cwd !== expectedCwd || relative === null || relative === ".."
    || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new ChatProjectLaunchError("project_root_moved", 409,
      `${project.name}’s folder now resolves somewhere else. Confirm the folder in project settings before starting chat.`);
  }
}

export function assertCurrentPinnedLaunchRootIn(
  projects: readonly PinnedProject[],
  projectId: string,
  expectedCwd: string,
  projectName = "This project",
): void {
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new ChatProjectLaunchError("project_root_moved", 409,
      `${projectName} is no longer registered. Choose a project in settings before starting chat.`);
  }
  assertPinnedLaunchRoot(project, expectedCwd);
}

export async function assertCurrentPinnedLaunchRoot(
  projectId: string,
  expectedCwd: string,
  projectName?: string,
): Promise<void> {
  assertCurrentPinnedLaunchRootIn(await loadProjects(), projectId, expectedCwd, projectName);
}
