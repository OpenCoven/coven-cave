import path from "node:path";

import { loadProjects } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import {
  ProjectAccessDeniedError,
  assertProjectAccess,
  type ProjectPermissionSurface,
} from "@/lib/project-permissions";
import { MOBILE_ACCESS_HEADER } from "@/proxy-helpers";
import { isLocalOrigin } from "@/lib/server/local-origin";

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

/**
 * Read-only surfaces the human operator may use WITHOUT a familiar context —
 * but only from a loopback origin (their own desktop), never the phone /
 * tailnet. Familiars still require a grant; write surfaces always require a
 * familiarId.
 */
const LOCAL_HUMAN_READ_SURFACES: ReadonlySet<ProjectPermissionSurface> = new Set([
  "file-browse",
  "file-read",
  "project-api",
]);

export async function assertProjectApiAccess(args: {
  familiarId: string | null | undefined;
  path: string | null | undefined;
  surface: ProjectPermissionSurface;
  request?: Request;
}): Promise<void> {
  const { surface } = args;
  const familiarId = args.familiarId?.trim();
  const requestedPath = args.path?.trim();
  if (!requestedPath) {
    throw new ProjectAccessDeniedError("missing project path for permission check");
  }
  const projects = await loadProjects();
  const project = projectRootForPath(requestedPath, projects);
  if (!project) {
    throw new ProjectAccessDeniedError("project is not registered for permission checks");
  }
  if (!familiarId) {
    // The human at their own desktop (loopback) may read a registered project's
    // files without a familiar. Familiars stay gated; writes still need one.
    if (args.request && isLocalOrigin(args.request) && LOCAL_HUMAN_READ_SURFACES.has(surface)) {
      return;
    }
    throw new ProjectAccessDeniedError("missing familiarId for project access");
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
