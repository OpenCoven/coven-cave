import { realpathSync } from "node:fs";
import { confirmProjectRoot, loadProjects } from "../cave-projects.ts";
import { validateCaveProjectRoot } from "./project-paths.ts";
import { authenticateProjectFolder } from "./native-folder-authentication.ts";

const activeConfirmations = new Set<string>();

/** Server-owned snapshot + fresh native authentication + locked identity recheck. */
export async function confirmProjectFolderWithHuman(
  id: string,
  deps: { authenticate: (reason: string) => Promise<boolean> } = { authenticate: authenticateProjectFolder },
) {
  if (activeConfirmations.size) {
    return { ok: false as const, status: 409, code: "project_folder_confirmation_busy", error: "A folder confirmation is already open. Finish it, then retry." };
  }
  activeConfirmations.add(id);
  try {
    const project = (await loadProjects()).find((entry) => entry.id === id);
    if (!project) return { ok: false as const, status: 404, code: "project_not_found", error: "not found" };
    const validated = validateCaveProjectRoot(project.root);
    if (!validated.ok) return { ok: false as const, status: 400, code: "project_root_unavailable", error: validated.error };
    const expected = { root: project.root, realpath: realpathSync.native(/* turbopackIgnore: true */ validated.root) };
    const approved = await deps.authenticate(`Confirm ${project.name}’s project folder:\n${expected.realpath}`);
    if (!approved) {
      return { ok: false as const, status: 403, code: "project_folder_authentication_required", error: "Authenticate on this Mac to confirm the folder. Use Touch ID, then retry." };
    }
    const result = await confirmProjectRoot(id, validateCaveProjectRoot, expected);
    if (!result) return { ok: false as const, status: 404, code: "project_not_found", error: "not found" };
    if (!result.ok) return { ok: false as const, status: 409, code: "project_root_moved", error: result.error };
    return result;
  } finally {
    activeConfirmations.delete(id);
  }
}
