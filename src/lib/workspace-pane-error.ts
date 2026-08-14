const FALLBACK_ERROR_MESSAGE = "Couldn't load this page. Try again.";

export function workspacePaneErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return FALLBACK_ERROR_MESSAGE;
}

export function workspacePaneResetKey(instanceId: string, landmark: string): string {
  return `${instanceId}:${landmark}`;
}
