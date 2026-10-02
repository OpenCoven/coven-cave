// Dependency-neutral child-process environment scrubbing.
//
// Keep this module free of Vault and binary-discovery imports: both layers
// need these pure operations without creating an import cycle.

// These aliases may authenticate Cave's own API routes or steer Node/runtime
// discovery. Do not leak launcher credentials or runtime flags into arbitrary
// installers, probes, or harness sessions.
const FORBIDDEN_SPAWN_ENV_KEYS = [
  "GITHUB_PAT",
  "GITHUB_TOKEN",
  "COVEN_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "NODE_OPTIONS",
  "NPM_CONFIG_NODE_OPTIONS",
  "COVEN_BIN",
  "COVEN_VAULT_FILE",
] as const;

const SIDECAR_INTERNAL_ENV_PREFIXES = ["COVEN_CAVE_", "__NEXT_PRIVATE_"] as const;

// The server's own process mode and pnpm's lifecycle keys describe the process
// that launched Cave, not the user's environment. A child that inherits them
// runs every Node tool in the server's mode: `next build` from a harness shell
// picked the development React and failed while CI stayed green (#5701), and
// `npm install` under `production` skips devDependencies. The PTY terminal has
// dropped these since #403 (server.ts `PTY_ENV_DROPPED`); the harness/daemon
// baseline must match it (#5731). Keep the two lists identical — server.ts
// stays import-free of src/ so the packaged sidecar can run it standalone.
const INHERITED_PROCESS_MODE_ENV_KEYS = ["NODE_ENV", "INIT_CWD", "PNPM_SCRIPT_SRC_DIR"] as const;

function comparableEnvKey(key: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? key.toUpperCase() : key;
}

export function isInheritedProcessModeEnvKey(
  key: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const comparableKey = comparableEnvKey(key, platform);
  return INHERITED_PROCESS_MODE_ENV_KEYS.some((inherited) => comparableKey === inherited);
}

/**
 * Remove the launching process's mode (`NODE_ENV`) and pnpm lifecycle keys from
 * a spawn env, in place, so a child starts with them unset the way CI does.
 */
export function scrubInheritedProcessModeEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    if (isInheritedProcessModeEnvKey(key, platform)) delete env[key];
  }
  return env;
}

export function isForbiddenSpawnEnvKey(
  key: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const comparableKey = comparableEnvKey(key, platform);
  return (
    isSidecarInternalEnvKey(key, platform) ||
    FORBIDDEN_SPAWN_ENV_KEYS.some((forbidden) => comparableKey === forbidden)
  );
}

export function isSidecarInternalEnvKey(
  key: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const comparableKey = comparableEnvKey(key, platform);
  return SIDECAR_INTERNAL_ENV_PREFIXES.some((prefix) => comparableKey.startsWith(prefix));
}

/**
 * Remove Cave/sidecar-internal variables (and forbidden token keys) from a
 * spawn env, in place.
 */
export function scrubSidecarInternalEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    if (isForbiddenSpawnEnvKey(key, platform)) delete env[key];
  }
  return env;
}

/**
 * Pure discovery boundary: copy/scrub `source`, then delete every key declared
 * by the supplied Vault-map snapshot, regardless of familiar scope.
 */
export function vaultFreeDiscoveryEnv(
  source: NodeJS.ProcessEnv,
  map: Readonly<Record<string, unknown>>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = scrubSidecarInternalEnv({ ...source }, platform);
  const managedKeys = new Set(
    Object.keys(map).map((key) => comparableEnvKey(key, platform)),
  );
  for (const key of Object.keys(env)) {
    if (managedKeys.has(comparableEnvKey(key, platform))) delete env[key];
  }
  return env;
}
