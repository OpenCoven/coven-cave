/**
 * Whether the desktop's `gh` CLI has a stored login (keyring or hosts.yml)
 * that a process spawned with `env` would use.
 *
 * Val's 2026-10-09 decision on #5845: "GitHub on" may use the desktop's
 * existing `gh` keyring login. This only asks `gh auth status`; it never
 * runs `gh auth token`, never reads the token, and never writes it into an
 * env. A harness spawned with the same HOME / GH_CONFIG_DIR reaches the same
 * login through `gh` itself, so reporting it grants nothing new.
 *
 * Token variables are removed from the probe's env so the answer reflects the
 * stored login only; a token already in the env is handled by
 * prepareTurnConnectors before this is consulted.
 */
import { execFile } from "node:child_process";
import { GITHUB_HARNESS_TOKEN_ENV_KEYS } from "../github-token-env.ts";

const PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;

const TOKEN_ENV_KEYS = new Set<string>([
  ...GITHUB_HARNESS_TOKEN_ENV_KEYS,
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
]);

export type GhAuthStatusRunner = (env: NodeJS.ProcessEnv) => Promise<boolean>;

/** The env the probe runs with: no token variables, never interactive. */
export function ghStatusProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!TOKEN_ENV_KEYS.has(key.toUpperCase())) out[key] = value;
  }
  out.GH_PROMPT_DISABLED = "1";
  out.GH_NO_UPDATE_NOTIFIER = "1";
  return out;
}

/** Exit status 0 from `gh auth status --hostname github.com`; output is discarded. */
export const runGhAuthStatus: GhAuthStatusRunner = (env) =>
  new Promise((resolve) => {
    try {
      execFile(
        process.platform === "win32" ? "gh.exe" : "gh",
        ["auth", "status", "--hostname", "github.com"],
        { env: ghStatusProbeEnv(env), timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (error) => resolve(!error),
      );
    } catch {
      resolve(false);
    }
  });

const cache = new Map<string, { at: number; value: Promise<boolean> }>();

function cacheKey(env: NodeJS.ProcessEnv): string {
  return [env.HOME, env.USERPROFILE, env.GH_CONFIG_DIR, env.XDG_CONFIG_HOME, env.PATH]
    .map((value) => value ?? "")
    .join("\0");
}

/**
 * Cached per HOME / gh config / PATH for a minute so a busy chat does not
 * spawn `gh` on every turn. Failures are cached the same way.
 */
export function hasGhStoredLogin(
  env: NodeJS.ProcessEnv,
  options: { run?: GhAuthStatusRunner; now?: () => number } = {},
): Promise<boolean> {
  const run = options.run ?? runGhAuthStatus;
  const now = (options.now ?? Date.now)();
  const key = cacheKey(env);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = run(env).then((ok) => ok === true, () => false);
  cache.set(key, { at: now, value });
  return value;
}

/** Test seam: forget cached probe results. */
export function resetGhStoredLoginCache(): void {
  cache.clear();
}
