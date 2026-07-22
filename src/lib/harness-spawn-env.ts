/**
 * Harness spawn env — the vault-scoping enforcement point (cave-4nu6).
 *
 * `resolveSecret()` caches every resolved vault value into `process.env`, and
 * `covenSpawnEnv()` forwards the full process env, so without intervention
 * every spawned harness inherits every secret. This module subtracts, at
 * spawn time, the vault-managed keys whose `scope` does not grant the familiar
 * being spawned (denylist subtraction — PATH/HOME and non-vault env stay
 * intact). Unscoped entries are shared and pass through, so existing
 * vault.yaml files behave exactly as before.
 *
 * Use this instead of `covenSpawnEnv()` for anything that runs a harness
 * (`coven run`, adapter binaries, `codex exec`) or the daemon. Spawns with no
 * familiar context (capability probes, automation/assist runners, the daemon)
 * get shared keys only — scoped secrets flow exclusively through the Cave
 * spawn path of a granted familiar.
 */

import { covenSpawnEnv } from "./coven-bin.ts";
import { GITHUB_TOKEN_ENV_KEYS } from "./github-token-env.ts";
import { isVaultKeyGrantedTo, loadVaultMap, type VaultMap } from "./vault.ts";

/**
 * Return the explicitly opted-in external credential names that a harness may
 * inherit. Cave strips GitHub credentials from every generic child process,
 * so an installation that supplies a token through its launcher must opt in
 * before a Codex, Hermes, OpenCode, or other harness receives one.
 */
export function allowedHarnessEnvKeys(): Set<string> {
  return new Set(
    (process.env.COVEN_HARNESS_ALLOW_ENV_KEYS ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

/** Restore only explicitly allowed launcher-provided GitHub token aliases. */
export function restoreAllowedGitHubTokenEnv(
  env: NodeJS.ProcessEnv,
  allowed = allowedHarnessEnvKeys(),
  managedKeys = new Set(Object.keys(loadVaultMap(true))),
): NodeJS.ProcessEnv {
  for (const key of GITHUB_TOKEN_ENV_KEYS) {
    // An alias with a vault entry may have been cached in process.env by an
    // earlier request. An opt-in is for a launcher-provided credential, never
    // a way to bypass the vault's familiar scope.
    if (!allowed.has(key) || managedKeys.has(key)) continue;
    const value = process.env[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

/** Pure: delete from `env` every vault-managed key not granted to `familiarId`. */
export function subtractScopedVaultKeys(
  env: NodeJS.ProcessEnv,
  map: VaultMap,
  familiarId?: string | null,
): NodeJS.ProcessEnv {
  for (const [key, entry] of Object.entries(map)) {
    if (!isVaultKeyGrantedTo(entry, familiarId)) delete env[key];
  }
  return env;
}

/**
 * `covenSpawnEnv()` minus scoped vault keys the familiar is not granted.
 * The vault map is force-reloaded per spawn so a just-tightened scope applies
 * immediately — spawns are per chat turn and the map is a tiny local file.
 */
export function harnessSpawnEnv(familiarId?: string | null): NodeJS.ProcessEnv {
  const map = loadVaultMap(true);
  const env = subtractScopedVaultKeys(covenSpawnEnv(), map, familiarId);
  return restoreAllowedGitHubTokenEnv(env, undefined, new Set(Object.keys(map)));
}
