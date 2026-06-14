// Pure version-comparison helpers + shared types for the desktop update check.
// Server-safe (no window / browser APIs) so the API route and client can both import it.

export type UpdateStatus = {
  /** The running app's version (from package.json via APP_VERSION). */
  current: string;
  /** Latest released version (tag without the leading "v"), or null if unknown. */
  latest: string | null;
  /** True when `latest` is strictly newer than `current`. */
  available: boolean;
  /** Where to send the user to download (GitHub release page). */
  url: string;
  /** ISO timestamp of when the check ran. */
  checkedAt: string;
  /** Present when the latest version could not be determined (network/rate-limit). */
  error?: string;
};

/** Parse "1.2.3" or "v1.2.3" (ignoring any pre-release/build suffix) into [major, minor, patch]. */
export function parseSemver(version: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a < b, 0 if equal (or unparseable), 1 if a > b. Compares major.minor.patch only. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** True when `latest` is a strictly newer release than `current`. */
export function isUpdateAvailable(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}
