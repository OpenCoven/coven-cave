import path from "node:path";

import { loadProjects } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import {
  ProjectAccessDeniedError,
  assertProjectAccess,
  type ProjectPermissionSurface,
} from "@/lib/project-permissions";
import { MOBILE_ACCESS_HEADER } from "@/proxy-helpers";

function isWithinRoot(candidate: string, root: string): boolean {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath) &&
      !relativePath.split(path.sep).includes("..")
    )
  );
}

function projectRootForPath(value: string, projects: CaveProject[]): CaveProject | null {
  const candidate = path.resolve(value);
  const matches = projects
    .map((project) => ({ project, root: path.resolve(project.root) }))
    .filter(({ root }) => isWithinRoot(candidate, root))
    .sort((a, b) => b.root.length - a.root.length);
  return matches[0]?.project ?? null;
}

export async function assertProjectApiAccess(args: {
  familiarId: string | null | undefined;
  path: string | null | undefined;
  surface: ProjectPermissionSurface;
}): Promise<void> {
  const { surface } = args;
  const familiarId = args.familiarId?.trim();
  if (!familiarId) {
    throw new ProjectAccessDeniedError("missing familiarId for project access");
  }
  const requestedPath = args.path?.trim();
  if (!requestedPath) {
    throw new ProjectAccessDeniedError("missing project path for permission check");
  }
  const project = projectRootForPath(requestedPath, await loadProjects());
  if (!project) {
    throw new ProjectAccessDeniedError("project is not registered for permission checks");
  }
  await assertProjectAccess({ familiarId }, project.id, surface);
}

export function projectPermissionSurfaceForRequest(
  req: Request,
  fallback: ProjectPermissionSurface,
): ProjectPermissionSurface {
  if (req.headers.get(MOBILE_ACCESS_HEADER) === "1") return "mobile";
  return fallback;
}

export function projectAccessDeniedBody(error: ProjectAccessDeniedError) {
  return {
    body: { ok: false, error: error.message },
    status: error.status,
  };
}
