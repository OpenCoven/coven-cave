export const PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE =
  "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE";

/** No Touch ID prompt can appear on this device, so folder pins cannot change here. */
export const PROJECT_FOLDER_AUTHENTICATION_UNAVAILABLE_CODE =
  "project_folder_authentication_unavailable";

export const PROJECT_ROOT_WORKSPACE_HELP =
  "Project folders can live anywhere on this computer — any folder works except your home folder itself or the top of a drive.";

export const PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR =
  "Choose a specific folder for this project — your home folder itself or the top of a drive can't be a project root.";

/** True when a project creation/grant failure carries the out-of-workspace code. */
export function isProjectRootOutsideAllowedWorkspace(code: string | null | undefined): boolean {
  return code === PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE;
}
