// Pure version-comparison helpers + shared types for the desktop update check.
// Server-safe (no window / browser APIs) so the API route and client can both import it.

/**
 * The platform/arch targets we ship installers for. Keyed the same way as the
 * Tauri updater manifest (`<os>-<arch>`) so the client can resolve its own
 * target from the OS plugin and pick a direct installer download.
 */
export type DownloadTarget = "darwin-aarch64" | "darwin-x86_64" | "windows-x86_64" | "linux-x86_64";

/** Direct installer download URLs per platform, resolved from a release's assets. */
export type DownloadUrls = Partial<Record<DownloadTarget, string>>;

export type UpdateStatus = {
  /** The running app's version (from package.json via APP_VERSION). */
  current: string;
  /** Latest released version (tag without the leading "v"), or null if unknown. */
  latest: string | null;
  /** True when `latest` is strictly newer than `current`. */
  available: boolean;
  /** Where to send the user to download (GitHub release page) — last-resort fallback. */
  url: string;
  /**
   * Direct installer download URLs per platform (DMG / MSI / AppImage). The
   * client picks its own target so "Download" downloads an installer instead of
   * just opening the release page. Empty when assets couldn't be resolved.
   */
  downloads?: DownloadUrls;
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

/** A GitHub release asset (subset of the fields we care about). */
export type ReleaseAsset = { name?: string; browser_download_url?: string };

/**
 * Map a release's assets to direct, user-installable downloads per platform.
 * Prefers the end-user installer for each target (DMG on macOS, MSI on Windows,
 * AppImage on Linux) over the updater artifacts (`.app.tar.gz`) and skips the
 * detached `.sig` signatures. Returns only the targets we found an asset for.
 */
export function resolveDownloadUrls(assets: ReleaseAsset[]): DownloadUrls {
  const out: DownloadUrls = {};
  const pick = (test: (name: string) => boolean): string | undefined => {
    for (const a of assets) {
      const name = a.name;
      if (!name || !a.browser_download_url) continue;
      if (name.endsWith(".sig")) continue;
      if (test(name)) return a.browser_download_url;
    }
    return undefined;
  };

  const macArm = pick((n) => /aarch64\.dmg$/i.test(n));
  const macX64 = pick((n) => /x86_64\.dmg$/i.test(n));
  const win = pick((n) => /\.msi$/i.test(n)) ?? pick((n) => /-setup\.exe$/i.test(n));
  const linux = pick((n) => /\.AppImage$/i.test(n));

  if (macArm) out["darwin-aarch64"] = macArm;
  if (macX64) out["darwin-x86_64"] = macX64;
  if (win) out["windows-x86_64"] = win;
  if (linux) out["linux-x86_64"] = linux;
  return out;
}

/**
 * Resolve the running platform to a download target key. `os`/`arch` come from
 * the Tauri OS plugin (`platform()` → "macos"|"windows"|"linux"…, `arch()` →
 * "aarch64"|"x86_64"…). Returns null when we don't ship for that combination.
 */
export function downloadTargetFor(os: string, arch: string): DownloadTarget | null {
  if (os === "macos") return arch === "aarch64" ? "darwin-aarch64" : "darwin-x86_64";
  if (os === "windows") return "windows-x86_64";
  if (os === "linux") return "linux-x86_64";
  return null;
}

/**
 * Pick the best direct download for the running platform, falling back through
 * the other macOS arch (universal-ish) and finally to the release page so the
 * Download button always points at *something* downloadable.
 */
export function pickDownloadUrl(
  status: Pick<UpdateStatus, "downloads" | "url">,
  os: string,
  arch: string,
): string {
  const downloads = status.downloads ?? {};
  const target = downloadTargetFor(os, arch);
  if (target && downloads[target]) return downloads[target]!;
  // macOS arch mismatch (e.g. Rosetta arch report): offer the other mac build.
  if (os === "macos") {
    const other = downloads["darwin-aarch64"] ?? downloads["darwin-x86_64"];
    if (other) return other;
  }
  return status.url;
}
