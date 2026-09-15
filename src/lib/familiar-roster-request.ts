/**
 * Familiar-roster loads are last-request-wins.
 *
 * Callers increment their generation before starting a load and consult this
 * guard before publishing any result, error, or settled state, so a slow
 * response from an abandoned request cannot overwrite a newer roster.
 *
 * It lived in `canonical-memory.ts` until that module went with the vault. It
 * was never vault code — the roster is the familiar list, not memory — so it
 * moved here rather than being deleted alongside its former neighbours.
 */
export function isLatestFamiliarRosterRequest(
  requestGeneration: number,
  latestGeneration: number,
): boolean {
  return requestGeneration === latestGeneration;
}
