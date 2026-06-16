/**
 * Shared familiar-id guard for routes that interpolate `id` into a filesystem
 * path (e.g. `familiarWorkspace(id)`). Constraining the id to a strict slug —
 * alphanumerics plus `_`/`-`, no path separator, no `..` — keeps those routes
 * from becoming arbitrary-directory-read primitives. Callers MUST gate on this
 * before touching the filesystem; helpers re-assert it as an inline barrier.
 */
const VALID_FAMILIAR_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isValidFamiliarId(id: string): boolean {
  // The regex already excludes `/`, `\`, and `.`, so `..` is impossible; the
  // explicit check documents the invariant for readers and static analysis.
  return VALID_FAMILIAR_ID.test(id) && !id.includes("..");
}
