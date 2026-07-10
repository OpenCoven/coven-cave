const FALLBACK_MESSAGE = "Unexpected pane error";

export function workspacePaneResetKey(instanceId: string, landmark: string): string {
  return JSON.stringify([instanceId, landmark]);
}

export function workspacePaneErrorMessage(thrown: unknown): string {
  if (typeof thrown === "string") return thrown.trim() || FALLBACK_MESSAGE;

  try {
    if (thrown instanceof Error) return thrown.message.trim() || FALLBACK_MESSAGE;
  } catch {
    // Hostile thrown values must not prevent the pane fallback from rendering.
  }

  return FALLBACK_MESSAGE;
}
