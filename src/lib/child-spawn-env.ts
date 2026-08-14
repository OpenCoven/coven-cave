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

function comparableEnvKey(key: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? key.toUpperCase() : key;
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
    const comparableKey = comparableEnvKey(key, platform);
    if (
      SIDECAR_INTERNAL_ENV_PREFIXES.some((prefix) => comparableKey.startsWith(prefix)) ||
      FORBIDDEN_SPAWN_ENV_KEYS.some((forbidden) => comparableKey === forbidden)
    ) {
      delete env[key];
    }
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
