const SAFE_PANE_ERROR_MESSAGE = "This page hit an unexpected error. Try again.";

export function workspacePaneResetKey(instanceId: string, landmark: string): string {
  return JSON.stringify([instanceId, landmark]);
}

export function workspacePaneErrorMessage(_thrown: unknown): string {
  return SAFE_PANE_ERROR_MESSAGE;
}
