import type { CaveProject } from "./cave-projects.ts";

export type AddChatProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string };

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
 * caller's local project list updates in place. When the root is already
 * registered (only the grant is missing) pass `existingProjectId` to skip
 * creation. `fetchImpl` is injectable for tests.
 */
export async function addChatProject(args: {
  root: string;
  familiarId: string | null;
  createProject: (name: string, root: string) => Promise<CaveProject | null>;
  existingProjectId?: string | null;
  name?: string;
  fetchImpl?: typeof fetch;
}): Promise<AddChatProjectResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const root = args.root.trim();
  if (!root) return { ok: false, error: "missing project root" };

  let projectId = args.existingProjectId ?? null;
  if (!projectId) {
    const name = (args.name ?? "").trim() || projectNameForRoot(root);
    const project = await args.createProject(name, root);
    if (!project) return { ok: false, error: "could not register project" };
    projectId = project.id;
  }

  // Grant the active familiar access. A no-familiar context (operator/Supreme
  // view) has nothing to grant and is left to the server's own access rules.
  if (args.familiarId) {
    const res = await doFetch("/api/project-grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetFamiliarId: args.familiarId, projectId }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : `grant failed (${res.status})`,
      };
    }
  }

  return { ok: true, projectId };
}
