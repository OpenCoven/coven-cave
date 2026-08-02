/** Stable error contract for desktop-only local request rejections. */
export const LOCAL_REQUEST_REQUIRED_CODE = "local_request_required";

export const LOCAL_PROJECT_CREATION_MESSAGE =
  "Project registration must happen from the Cave desktop or a localhost browser session on the computer that owns the folder. Open one there, then try again.";

export class ProjectCreationError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ProjectCreationError";
    this.code = code;
  }
}

export function projectErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : undefined;
}
