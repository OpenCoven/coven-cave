/** Standard launcher aliases for a GitHub credential, excluding Cave's local PAT. */
export const GITHUB_TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
] as const;

/**
 * GitHub credential names a harness can receive after Cave applies its
 * familiar scope or explicit launcher opt-in. `GITHUB_PAT` is deliberately
 * separate from the standard aliases above because it can also be Cave's
 * local credential and must never be restored from a launcher in that case.
 */
export const GITHUB_HARNESS_TOKEN_ENV_KEYS = [
  "GITHUB_PAT",
  ...GITHUB_TOKEN_ENV_KEYS,
] as const;
