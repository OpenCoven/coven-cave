/** Run an automatic reflection only when no persisted report is known. */
export async function runAutoReflectionIfMissing(
  familiarId: string,
  sessionId: string,
  reflect: () => Promise<void>,
): Promise<void> {
  try {
    const response = await fetch(`/api/familiars/${encodeURIComponent(familiarId)}/self-reports/${encodeURIComponent(sessionId)}`);
    if (response.ok) {
      const result = await response.json();
      if (result?.ok === true && result.report?.sessionId === sessionId) return;
    }
  } catch {
    // Lookup is best-effort; server-side atomic admission remains authoritative.
  }
  // Keep generation outside the lookup catch: never retry a failed paid run.
  await reflect();
}
