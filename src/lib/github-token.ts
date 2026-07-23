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
import { readEnvLocalValue } from "@/lib/env-file";
import { getLocalEncryptedSecret } from "@/lib/local-encrypted-vault";
import { loadVaultMap, resolveVaultManagedSecret } from "@/lib/vault";
export { GITHUB_TOKEN_ENV_KEYS } from "./github-token-env";
import { GITHUB_TOKEN_ENV_KEYS } from "./github-token-env";

export function resolveGitHubTokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function resolveGitHubToken(): string | null {
  // Cave-managed storage takes precedence over a same-named credential
  // inherited from a launcher. This lets an installation use any supported
  // Node, desktop, or harness launch path without a launcher silently
  // replacing the credential deliberately configured in Cave.
  const map = loadVaultMap();
  const managed = resolveVaultManagedSecret("GITHUB_PAT", map.GITHUB_PAT)?.trim();
  if (managed) return managed;

  // Keep supporting encrypted entries created before their vault-map metadata
  // existed, and the legacy writable .env.local location.
  const encrypted = getLocalEncryptedSecret("GITHUB_PAT")?.trim();
  if (encrypted) return encrypted;
  const localEnv = readEnvLocalValue("GITHUB_PAT")?.trim();
  if (localEnv) return localEnv;

  const launcherPat = process.env.GITHUB_PAT?.trim();
  return launcherPat || resolveGitHubTokenFromEnvironment();
}
