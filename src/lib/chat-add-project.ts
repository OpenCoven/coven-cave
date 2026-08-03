import type { CaveProject } from "./cave-projects.ts";
import { projectErrorCode, type ProjectCreationError } from "./project-errors.ts";
import { emitProjectRegistryMutation } from "./project-registry-events.ts";

export type AddChatProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string; code?: string };

export type CreateProjectOptions = {
  emitMutation?: boolean;
  /** Explicit identity tint persisted on the project (absent → auto root-hash tint). */
  color?: string;
  /** Canonical GitHub link — callers must pre-normalize via normalizeGitHubRepoUrl. */
  repoUrl?: string;
  /** Receives a typed creation failure when a nullable creator cannot return it. */
  onError?: (error: ProjectCreationError) => void;
};

/** Derive a human project name from a working-directory path — its leaf folder.
 *  `/Users/me/code/coven-cave` → `coven-cave`. Falls back to the raw root. */
export function projectNameForRoot(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? root;
}

/**
 * Register a working directory as a Cave project and grant the active familiar
 * access to it, so an orphaned chat — one whose cwd sits outside every
 * registered project — can proceed instead of failing the 403 project-access
 * check.
 *
 * Two-step because registering a root only makes the access check resolve to a
 * real project id; the familiar still needs a grant unless it is Supreme. Both
 * calls are user-initiated (the human clicked "Add project"), which the grant
 * route accepts — it only rejects agent-relayed approvals.
 *
 * `createProject` is threaded in from the caller's `useProjects()` hook so the
 * caller's local project list updates in place. Creation suppresses its normal
 * registry notification here; this helper emits once after the bundled grant
 * completes. When the root is already registered (only the grant is missing)
 * pass `existingProjectId` to skip creation. Callers that created the project
 * immediately before the grant can pass `projectJustCreated` so failed grants
 * still fan out the new registry entry. `fetchImpl` is injectable for tests.
 */
export async function addChatProject(args: {
  root: string;
  familiarId: string | null;
  createProject: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  /** Prefer this when available so server error messages survive nullable callers. */
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  existingProjectId?: string | null;
  projectJustCreated?: boolean;
  name?: string;
  fetchImpl?: typeof fetch;
}): Promise<AddChatProjectResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const root = args.root.trim();
  if (!root) return { ok: false, error: "missing project root" };

  let projectId = args.existingProjectId ?? null;
  let createdProject = false;
  if (!projectId) {
    const reportedFailure: { error: ProjectCreationError | null } = { error: null };
    try {
      const name = (args.name ?? "").trim() || projectNameForRoot(root);
      const createOptions: CreateProjectOptions = {
        emitMutation: false,
        onError: (error) => {
          reportedFailure.error = error;
        },
      };
      const project = args.createProjectOrThrow
        ? await args.createProjectOrThrow(name, root, createOptions)
        : await args.createProject(name, root, createOptions);
      if (!project) {
        const error = reportedFailure.error;
        const code = error ? projectErrorCode(error) : undefined;
        return {
          ok: false,
          error: error?.message ?? "could not register project",
          ...(code ? { code } : {}),
        };
      }
      projectId = project.id;
      createdProject = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not register project";
      const code = projectErrorCode(error);
      return {
        ok: false,
        error: message,
        ...(code ? { code } : {}),
      };
    }
  }

  // Grant the active familiar access. A no-familiar context (operator/Supreme
  // view) has nothing to grant and is left to the server's own access rules.
  if (args.familiarId) {
    let res: Response;
    try {
      res = await doFetch("/api/project-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetFamiliarId: args.familiarId, projectId }),
      });
      if (!res.ok) {
        // Creation still succeeded, so publish that partial registry mutation
        // even though the bundled grant did not complete.
        if (createdProject || args.projectJustCreated) emitProjectRegistryMutation();
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        return {
          ok: false,
          error: typeof data.error === "string" ? data.error : `grant failed (${res.status})`,
        };
      }
    } catch (error) {
      if (createdProject || args.projectJustCreated) emitProjectRegistryMutation();
      return {
        ok: false,
        error: error instanceof Error ? error.message : "grant failed",
      };
    }
  }

  emitProjectRegistryMutation();
  return { ok: true, projectId };
}
