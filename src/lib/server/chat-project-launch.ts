import type { ProjectPermissionSurface } from "../project-access-levels.ts";
import type { SessionOrigin } from "../types.ts";

const PROJECTLESS_GENERATION_ORIGINS: ReadonlySet<SessionOrigin> = new Set([
  "canvas",
  "enhance",
  "journal",
]);

/**
 * Hidden generation runs are not conversations and retain their historical
 * familiar-workspace runtime. Every user-facing or automated chat origin
 * remains project-gated.
 */
export function isProjectlessGenerationOrigin(
  origin: SessionOrigin | null | undefined,
): boolean {
  return Boolean(origin && PROJECTLESS_GENERATION_ORIGINS.has(origin));
}

export type ChatProjectLaunchErrorCode =
  | "project_root_required"
  | "project_root_unavailable"
  | "project_root_not_directory"
  | "project_root_invalid"
  | "project_not_registered"
  | "project_access_denied";

export class ChatProjectLaunchError extends Error {
  readonly code: ChatProjectLaunchErrorCode;
  readonly status: 400 | 403;

  constructor(
    code: ChatProjectLaunchErrorCode,
    status: 400 | 403,
    message: string,
  ) {
    super(message);
    this.name = "ChatProjectLaunchError";
    this.code = code;
    this.status = status;
  }
}

export type ChatProjectLaunchDeps = {
  validateProjectRoot(
    root: string,
  ): { ok: true; root: string } | { ok: false; error: string };
  resolveProjectId(requestedRoot: string, resolvedRoot: string): string | null;
  isProjectRegistered(projectId: string): boolean;
  hasProjectAccess(
    familiarId: string,
    projectId: string,
    surface: ProjectPermissionSurface,
  ): Promise<boolean>;
};

export type ChatProjectLaunchInput = {
  familiarId: string;
  projectRoot: string | null | undefined;
  surface: ProjectPermissionSurface;
  /** Server-owned project association for an exact Board worktree handoff. */
  projectIdOverride?: string | null;
};

function validationError(error: string): ChatProjectLaunchError {
  if (error === "root does not exist") {
    return new ChatProjectLaunchError(
      "project_root_unavailable",
      400,
      "That project folder no longer exists. Choose another project before starting chat.",
    );
  }
  if (error === "root must be a directory") {
    return new ChatProjectLaunchError(
      "project_root_not_directory",
      400,
      "That project root is not a directory. Choose another project before starting chat.",
    );
  }
  return new ChatProjectLaunchError("project_root_invalid", 400, error);
}

/**
 * Fail-closed launch boundary shared by typed and voice Chat.
 *
 * Callers inject the repository-specific root, registry, and permission
 * adapters. Keeping the sequencing pure makes it directly testable and
 * guarantees no route can mint/queue/spawn before all three checks pass.
 */
export async function authorizeChatProjectLaunch(
  deps: ChatProjectLaunchDeps,
  input: ChatProjectLaunchInput,
): Promise<{ root: string; projectId: string }> {
  const requestedRoot = input.projectRoot?.trim();
  if (!requestedRoot) {
    throw new ChatProjectLaunchError(
      "project_root_required",
      400,
      "Choose a project this familiar can access before starting chat.",
    );
  }

  const validated = deps.validateProjectRoot(requestedRoot);
  if (!validated.ok) throw validationError(validated.error);

  const projectId =
    input.projectIdOverride?.trim() ||
    deps.resolveProjectId(requestedRoot, validated.root);
  if (
    !projectId ||
    projectId.startsWith("unregistered:") ||
    !deps.isProjectRegistered(projectId)
  ) {
    throw new ChatProjectLaunchError(
      "project_not_registered",
      400,
      "Choose a registered project before starting chat.",
    );
  }

  const allowed = await deps.hasProjectAccess(input.familiarId, projectId, input.surface);
  if (!allowed) {
    throw new ChatProjectLaunchError(
      "project_access_denied",
      403,
      "This familiar no longer has access to that project. Choose another project.",
    );
  }

  return {
    root: validated.root,
    projectId,
  };
}
