/** Standard launcher aliases for a GitHub credential, excluding Cave's local PAT. */
export const GITHUB_TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
] as const;
