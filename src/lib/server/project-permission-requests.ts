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
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";

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

/**
 * True when this is the human operator reading (not a familiar, not a write).
 * Two shapes:
 *   - their own desktop on a loopback origin, for the read surfaces above;
 *   - the same human on their own phone — the native app sends the mobile header
 *     (→ surface "mobile") and only ever GETs to read. The request already
 *     cleared the server's front gate (token / same-origin / tailnet-trust) to
 *     reach this route, so a mobile GET is the trusted human; writes (POST) still
 *     fall through to the familiar requirement.
 */
function isHumanRead(req: Request | undefined, surface: ProjectPermissionSurface): boolean {
  if (!req) return false;
  if (isLocalOrigin(req) && LOCAL_HUMAN_READ_SURFACES.has(surface)) return true;
  if (surface === "mobile" && (req.method ?? "GET").toUpperCase() === "GET") return true;
  return false;
}

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
    // Not a *registered* project — but the path may still be a legitimate read
    // target the traversal guard already permits: a familiar's own workspace
    // (~/.coven/workspaces/familiars/<id>), an openclaw research dir, or the cwd.
    // Let the human browse those (the Code tab surfaces familiar workspaces);
    // familiars still need a real registered-project grant, and writes still need
    // a familiar.
    if (!familiarId && isHumanRead(args.request, surface) && resolveAllowedProjectPath(requestedPath)) {
      return;
    }
    throw new ProjectAccessDeniedError("project is not registered for permission checks");
  }
  if (!familiarId) {
    // The human (their own desktop, or their phone) may read a registered
    // project's files without a familiar. Familiars stay gated; writes still
    // need one.
    if (isHumanRead(args.request, surface)) {
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
