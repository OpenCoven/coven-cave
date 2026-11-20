/**
 * Connection status for the PAT-backed integrations (GitHub, Asana).
 *
 * One definition of "connected", shared by each integration's own
 * /api/<name>/pat GET and by /api/connectors, which reports the same status
 * to the phone. Status only: these never return a credential value.
 */
import { hasLocalEncryptedSecret } from "@/lib/local-encrypted-vault";
import { resolveGitHubToken } from "@/lib/github-token";
import { resolveSecret } from "@/lib/vault";
import { readEnvLocalValue } from "@/lib/env-file";

export type PatSource = "encrypted" | "vault" | "env" | "none";

export type GitHubPatStatus = {
  hasPat: boolean;
  login: string | null;
  source: PatSource;
  canRemoveStoredPat: boolean;
};

export type AsanaPatStatus = {
  hasPat: boolean;
  login: string | null;
  source: PatSource;
};

const GITHUB_PAT_KEY = "GITHUB_PAT";
const ASANA_PAT_KEY = "ASANA_PAT";
const ASANA_USER_KEY = "ASANA_USER";

export function readGitHubPatStatus(): GitHubPatStatus {
  // Resolve from env, encrypted local vault, 1Password, or legacy .env.local.
  const localEnvPat = readEnvLocalValue(GITHUB_PAT_KEY);
  const hasEncryptedPat = hasLocalEncryptedSecret(GITHUB_PAT_KEY);
  const patFromVault = resolveSecret("GITHUB_PAT");
  const loginFromVault = resolveSecret("GITHUB_USERNAME");

  // The activity and action routes also accept credentials supplied by the
  // launcher (for example GH_TOKEN from a CLI/harness environment). Reflect
  // that here so an already-authenticated installation is not prompted to add
  // a duplicate Cave PAT.
  const hasPat = !!resolveGitHubToken();
  // Only storage Cave can actually delete is removable from this UI. A
  // launcher GITHUB_PAT or a vault reference can resolve through
  // resolveSecret(), but deleting it here would only disable it until restart.
  const canRemoveStoredPat = hasEncryptedPat || !!localEnvPat;
  const login = loginFromVault ?? process.env.GITHUB_USERNAME?.trim() ?? null;
  const source: PatSource = hasEncryptedPat
    ? "encrypted"
    : localEnvPat
      ? "env"
      : patFromVault
        ? "vault"
        : hasPat
          ? "env"
          : "none";

  return { hasPat, login, source, canRemoveStoredPat };
}

export function readAsanaPatStatus(): AsanaPatStatus {
  const patFromVault = resolveSecret(ASANA_PAT_KEY);
  const userFromVault = resolveSecret(ASANA_USER_KEY);

  const hasPat = !!(patFromVault ?? process.env.ASANA_PAT?.trim() ?? process.env.ASANA_ACCESS_TOKEN?.trim());
  const login = userFromVault ?? process.env.ASANA_USER?.trim() ?? null;
  const source: PatSource = hasLocalEncryptedSecret(ASANA_PAT_KEY)
    ? "encrypted"
    : patFromVault
      ? "vault"
      : hasPat
        ? "env"
        : "none";

  return { hasPat, login, source };
}
