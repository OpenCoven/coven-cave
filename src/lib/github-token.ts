/**
 * Resolve a GitHub credential for Cave's own GitHub API routes.
 *
 * A locally configured `GITHUB_PAT` remains authoritative, but Cave is also
 * commonly launched from an existing developer or harness environment. Keep
 * those standard token names here rather than making individual routes depend
 * on one installer, OS, or runtime's configuration convention.
 *
 * Do not pass the returned value to child-process environments. The server
 * uses it only for direct requests to api.github.com.
 */
import { resolveSecret } from "@/lib/vault";

export const GITHUB_TOKEN_ENV_KEYS = [
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
] as const;

export function resolveGitHubTokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function resolveGitHubToken(): string | null {
  return resolveSecret("GITHUB_PAT") ?? resolveGitHubTokenFromEnvironment();
}
