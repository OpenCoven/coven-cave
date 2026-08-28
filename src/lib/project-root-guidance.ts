export const PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE =
  "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE";

export const PROJECT_ROOT_WORKSPACE_HELP =
  "Project folders can live anywhere on this computer — any folder works except your home folder itself or the top of a drive.";

export const PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR =
  "Choose a specific folder for this project — your home folder itself or the top of a drive can't be a project root.";

/**
 * Compose the inline guidance a project entry point shows when the server
 * refuses a root. For the containment code this is the server's shared error
 * plus the shared workspace help — what was rejected and what IS allowed, in
 * one message. Any other code/error passes through unchanged, so no entry
 * point has to know the boundary itself. Client guidance only: it never
 * changes what the server accepts.
 */
export function projectRootRejectionMessage(
  code: string | undefined,
  error: string,
): string {
  return code === PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE
    ? `${error} ${PROJECT_ROOT_WORKSPACE_HELP}`
    : error;
}
