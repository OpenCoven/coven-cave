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
import { isVaultKeyGrantedTo, loadVaultMap, type VaultMap } from "./vault.ts";

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
  return subtractScopedVaultKeys(covenSpawnEnv(), loadVaultMap(true), familiarId);
}
