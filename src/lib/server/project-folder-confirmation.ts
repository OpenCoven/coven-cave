import { realpathSync } from "node:fs";
import { confirmProjectRoot, loadProjects } from "../cave-projects.ts";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "./project-paths.ts";
import { authenticateProjectFolder, type ProjectFolderAuthentication } from "./native-folder-authentication.ts";
import {
  PROJECT_FOLDER_AUTHENTICATION_UNAVAILABLE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} from "../project-root-guidance.ts";

const activeConfirmations = new Set<string>();

/** Server-owned snapshot + fresh native authentication + locked identity recheck. */
export async function confirmProjectFolderWithHuman(
  id: string,
  deps: {
    authenticate: (reason: string) => Promise<ProjectFolderAuthentication>;
    realpath?: (root: string) => string;
  } = { authenticate: authenticateProjectFolder },
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
    let realpath: string;
    try {
      realpath = deps.realpath?.(validated.root)
        ?? realpathSync.native(/* turbopackIgnore: true */ validated.root);
    } catch {
      return { ok: false as const, status: 400, code: "project_root_unavailable", error: "The project folder is no longer available. Choose it again and retry." };
    }
    // Registration and root edits refuse $HOME and volume roots. A registered
    // root retargeted to one must not be pinned there by confirmation either.
    if (!isAllowedNewProjectRoot(realpath)) {
      return { ok: false as const, status: 403, code: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE, error: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR };
    }
    const expected = { root: project.root, realpath };
    const approved = await deps.authenticate(`Confirm ${project.name}’s project folder:\n${expected.realpath}`);
    if (approved === "unavailable") {
      return { ok: false as const, status: 409, code: PROJECT_FOLDER_AUTHENTICATION_UNAVAILABLE_CODE, error: "Touch ID isn’t available on this device, so the folder can’t be confirmed here. Remove the project and add its folder again to start chats in it." };
    }
    if (approved !== true) {
      return { ok: false as const, status: 403, code: "project_folder_authentication_required", error: "Authenticate on this Mac to confirm the folder. Use Touch ID, then retry." };
    }
    const result = await confirmProjectRoot(id, (root) => {
      const validatedUnderLock = validateCaveProjectRoot(root);
      if (validatedUnderLock.ok && !isAllowedNewProjectRoot(validatedUnderLock.root)) {
        return { ok: false, error: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR };
      }
      return validatedUnderLock;
    }, expected);
    if (!result) return { ok: false as const, status: 404, code: "project_not_found", error: "not found" };
    if (!result.ok) return { ok: false as const, status: 409, code: "project_root_moved", error: result.error };
    return result;
  } finally {
    activeConfirmations.delete(id);
  }
}
