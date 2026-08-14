const DEFINITELY_GONE_SESSION_CODES = new Set([
  "session_not_found",
  "session_not_live",
]);

type DaemonErrorEnvelope = {
  ok: boolean;
  status: number;
  data?: unknown;
};

/** Read only Coven's canonical `{ error: { code } }` response shape. */
export function daemonErrorCode(response: DaemonErrorEnvelope): string | null {
  if (response.ok || !response.data || typeof response.data !== "object") return null;
  const error = (response.data as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * HTTP status alone is not session authority: a proxy can synthesize 404/410
 * while an unreachable daemon or hub still owns live work. Only Coven's typed
 * terminal-session codes prove that a kill target is already gone.
 */
export function daemonSessionAlreadyGone(response: DaemonErrorEnvelope): boolean {
  const code = daemonErrorCode(response);
  return code !== null && DEFINITELY_GONE_SESSION_CODES.has(code);
}
