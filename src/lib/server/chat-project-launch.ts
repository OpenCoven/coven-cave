import path from "node:path";

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

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
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

export type ProjectlessGenerationLaunchInput = {
  origin: SessionOrigin | null | undefined;
  /** True when the request named a project root of its own. */
  hasRequestedProjectRoot: boolean;
  sshRuntime: boolean;
  /** Remote home directory used for the ssh generation runtime. */
  sshHome: string;
  /**
   * Resume root recovered from the conversation's persisted runtime or, for a
   * daemon-spawned thread, from the daemon's session list.
   */
  resumeCwd?: string;
  /**
   * `resumeCwd` with symlinks resolved, or undefined when it could not be
   * resolved. The containment test below MUST run on this rather than on the
   * raw string: the spawn later realpaths the root and enforces only "inside
   * $HOME", so a symlink planted in the familiar's own workspace — which the
   * familiar can write to — would otherwise pass a lexical check here and land
   * the run in a different project entirely, with the gate skipped.
   */
  resumeCwdResolved?: string;
  /** Already symlink-resolved by resolveFamiliarWorkspace. */
  familiarWorkspace?: string;
  /**
   * Whether the resume root maps to a REGISTERED project.
   *
   * The workspace exemption below rests on the premise that a familiar's
   * workspace is not a registered project and so carries no grant to check.
   * Nothing enforced that premise: a user may register a project whose root
   * lives under `~/.coven/workspaces/familiars/<id>/`, and for such a root the
   * exemption applied to a genuinely registered project — the same bypass shape
   * cave-o3nq7 closed, narrowed to projects inside a familiar workspace.
   *
   * The caller resolves this (it owns the project registry); the decision stays
   * pure. Undefined reads as "not registered", which preserves the exemption
   * for callers that cannot answer — the containment test still has to pass
   * first, so this never widens the exemption beyond the workspace. (cave-g8fqc)
   */
  resumeCwdIsRegisteredProject?: boolean;
};

export type ProjectlessGenerationLaunchDecision =
  /** Auth-free: the familiar's own workspace (or its ssh equivalent). */
  | { kind: "workspace"; root: string }
  /** A hidden generation with no safe workspace to fall back to. */
  | { kind: "unavailable" }
  /** Must pass authorizeChatProjectLaunch like any other root. */
  | { kind: "gated" };

/**
 * Decide whether a hidden generation may skip the project launch gate.
 *
 * A hidden generation is exempt because it runs in the familiar's OWN
 * workspace, which is not a registered project and carries no grant to check.
 * That exemption never extended to a resume root: the conversation runtime and
 * the daemon session list (cave-yjnr) both name real project directories, and
 * the daemon's list is global — it is not scoped to the requesting familiar,
 * and its rows carry no familiar id to scope it by. Adopting one unchecked let
 * a caller name any session's id with a hidden origin and be launched in that
 * session's project without holding a grant for it (cave-o3nq7).
 *
 * So a resume root is gated exactly like the typed-chat path already gates it,
 * unless it resolves inside the familiar's own workspace — the multi-turn
 * canvas case, where turn 1 legitimately ran auth-free in that workspace and
 * persisted it as the conversation runtime.
 *
 * That last exemption is further narrowed to roots that are not REGISTERED
 * projects (cave-g8fqc). "A workspace carries no grant to check" is a premise,
 * not a guarantee: a user can register a project whose root lives under the
 * workspace, and the exemption then applied to a real project — letting a
 * hidden turn 2 skip re-authorization on it, and a turn 1 naming a daemon
 * session rooted there launch with no grant at all.
 */
export function projectlessGenerationLaunch(
  input: ProjectlessGenerationLaunchInput,
): ProjectlessGenerationLaunchDecision {
  if (input.hasRequestedProjectRoot) return { kind: "gated" };
  if (!isProjectlessGenerationOrigin(input.origin)) return { kind: "gated" };
  if (input.sshRuntime) return { kind: "workspace", root: input.sshHome };

  const workspace = input.familiarWorkspace?.trim();
  const resume = input.resumeCwd?.trim();
  if (!resume) {
    return workspace ? { kind: "workspace", root: workspace } : { kind: "unavailable" };
  }
  // A resume root that would not resolve is gated rather than dropped back to
  // the workspace: falling back would hand an auth-free run to a caller who
  // named an unresolvable root.
  const resolved = input.resumeCwdResolved?.trim();
  if (!resolved) return { kind: "gated" };
  // Containment alone is not enough. The exemption describes an UNREGISTERED
  // workspace directory; a registered project that happens to sit inside the
  // workspace has a grant to check, so it is gated like any other project
  // root (cave-g8fqc).
  if (workspace && isInsideRoot(workspace, resolved) && !input.resumeCwdIsRegisteredProject) {
    return { kind: "workspace", root: resolved };
  }
  return { kind: "gated" };
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
