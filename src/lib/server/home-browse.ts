import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

// Non-dot build-artifact / noise directories the folder browser hides. Dot
// folders stay visible because they may themselves be intentional project
// roots (for example, a configuration repository).
const SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "out",
]);

export function homeRoot(): string {
  return path.resolve(homedir());
}

/**
 * Pseudo-location the folder browser uses to list the machine's volume roots
 * (drives on Windows, `/` on POSIX). Never a real path — `::` cannot start an
 * absolute path on either platform, so it can't collide with a directory.
 */
export const DRIVES_LOCATION = "::drives";

/**
 * Absolute volume roots browsable on this machine: `/` on POSIX, the existing
 * drive roots (`C:\`, `D:\`, …) on Windows.
 */
export function listSystemRoots(): string[] {
  if (process.platform !== "win32") return ["/"];
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      /* drive letter not present or not readable — skip it */
    }
  }
  return roots.length > 0 ? roots : [path.parse(homeRoot()).root];
}

/** `listSystemRoots()` as picker entries (name === path for a volume root). */
export function listSystemRootEntries(): DirEntry[] {
  return listSystemRoots().map((root) => ({ name: root, path: root }));
}

/**
 * The volume root an absolute request lives on, taken from the trusted
 * `listSystemRoots()` allowlist. The user-derived root is used only in an
 * equality check — the returned string is the allowlist's own element, so
 * downstream walks anchor on a server-derived path, never request text.
 */
function trustedVolumeRoot(raw: string): string | null {
  const wanted = path.parse(path.resolve(raw)).root;
  // win32 drive letters are case-insensitive (`c:\` names `C:\`, and a
  // lowercase USERPROFILE drive would otherwise 403 every navigation), so
  // fold case before comparing. POSIX keeps exact matching ("/" only).
  const fold = (value: string) => (process.platform === "win32" ? value.toUpperCase() : value);
  for (const root of listSystemRoots()) {
    if (fold(root) === fold(wanted)) return root;
  }
  return null;
}

/**
 * Resolve a browse request for the folder picker. Empty requests land on
 * $HOME (the picker's entry point) and relative requests stay $HOME-anchored,
 * but absolute requests may name any directory: the walk simply starts from
 * the request's own volume root (`/` or `X:\`) instead of $HOME, so the
 * trusted-allowlist walk in resolveWithinRoot still builds the real path
 * entirely from fs-provided entry names.
 */
export function resolveBrowsableDir(requested: string | null | undefined): string | null {
  const raw = (requested ?? "").trim();
  if (raw === "") return homeRoot();
  if (!path.isAbsolute(raw)) return resolveWithinRoot(homeRoot(), raw);
  const root = trustedVolumeRoot(raw);
  if (root === null) return null;
  return resolveWithinRoot(root, raw);
}

/**
 * The requested path expressed as clean relative segments beneath `root`, or
 * `null` when it escapes `root`. Pure (no filesystem access) — the segments are
 * only ever compared against real directory-entry names, never used as a path.
 */
export function sanitizeRelSegments(
  root: string,
  requested: string | null | undefined,
): string[] | null {
  const base = path.resolve(root);
  const raw = (requested ?? "").trim();
  // Absolute requests win over `base` (path.resolve semantics); relative ones
  // join onto it. We only care about the resulting relative segments.
  const resolved = raw === "" ? base : path.resolve(base, raw);
  const rel = path.relative(base, resolved);
  if (rel === "") return [];
  if (path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  if (segments.some((segment) => segment === "" || segment === "..")) return null;
  return segments;
}

/**
 * Resolve a requested directory to a real path guaranteed to sit within `root`.
 *
 * Walks down from the trusted `root`, descending only into directory entries
 * that actually exist and whose name matches the next requested segment. The
 * path handed to the filesystem is therefore built entirely from `root` plus
 * fs-provided entry names — the user-supplied string is used only in an equality
 * check, never as a path. That defuses `js/path-injection` (the "select from a
 * trusted allowlist" pattern) rather than trusting a boolean containment guard.
 *
 * Returns `null` when the request escapes `root` or names a non-existent dir.
 */
export function resolveWithinRoot(
  root: string,
  requested: string | null | undefined,
): string | null {
  const base = path.resolve(root);
  const segments = sanitizeRelSegments(base, requested);
  if (segments === null) return null;

  let current = base;
  for (const wanted of segments) {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }
    const match = dirents.find((d) => d.isDirectory() && d.name === wanted);
    if (!match) return null;
    // `match.name` comes from the filesystem, not the request.
    current = path.join(current, match.name);
  }
  return current;
}

export type DirEntry = { name: string; path: string };

export type CreateSubdirResult =
  | { ok: true; path: string }
  | { ok: false; reason: "invalid-parent" | "invalid-name" | "exists" | "create-failed" };

export function createSubdirWithinRoot(
  root: string,
  requestedParent: string | null | undefined,
  requestedName: string,
): CreateSubdirResult {
  const parent = resolveWithinRoot(root, requestedParent);
  if (!parent) return { ok: false, reason: "invalid-parent" };

  const name = requestedName.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    path.basename(name) !== name ||
    name.includes("\\")
  ) {
    return { ok: false, reason: "invalid-name" };
  }

  // The parent is validated at runtime against real entries beneath $HOME.
  // Keep Turbopack from interpreting that dynamic path as a project-root glob
  // and tracing the entire checkout into the standalone sidecar bundle.
  const target = path.join(/* turbopackIgnore: true */ parent, name);
  try {
    fs.mkdirSync(target);
    return { ok: true, path: target };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code === "EEXIST"
    ) {
      return { ok: false, reason: "exists" };
    }
    return { ok: false, reason: "create-failed" };
  }
}

/**
 * Create a subdirectory beneath a picker-browsable parent. Same widening as
 * resolveBrowsableDir: relative parents stay $HOME-anchored, absolute parents
 * walk from their own volume root. The drives pseudo-location is not a real
 * parent and resolves to invalid-parent.
 */
export function createSubdirInBrowsableDir(
  requestedParent: string | null | undefined,
  requestedName: string,
): CreateSubdirResult {
  const raw = (requestedParent ?? "").trim();
  const root = path.isAbsolute(raw) ? trustedVolumeRoot(raw) : homeRoot();
  if (root === null) return { ok: false, reason: "invalid-parent" };
  return createSubdirWithinRoot(root, raw, requestedName);
}

// ── Sidebar places (Explorer's "Quick access" / "This PC", rebuilt in-app) ───

/**
 * A jump-off location in the picker's sidebar. The web build has no native
 * dialog, so reaching Downloads or a second drive used to mean walking down
 * from $HOME one folder at a time; these are the shortcuts that removes.
 */
export type PlaceKind = "home" | "known" | "drive";

export type Place = {
  /** Stable identity the client maps to an icon ("downloads", "drive:C:\"). */
  id: string;
  name: string;
  path: string;
  kind: PlaceKind;
};

export type PlaceGroup = {
  id: "quick" | "this-pc";
  label: string;
  places: Place[];
};

/**
 * How long a probe that shells out (the known-folder registry read, the volume
 * label read) stays good for. The picker re-reads places every time it opens
 * and neither source changes often, so this keeps a burst of opens to one
 * subprocess without pinning stale drives for a whole session.
 */
const PLACE_PROBE_TTL_MS = 60_000;

type Probe<T> = { at: number; value: T };

let userShellFoldersProbe: Probe<Map<string, string>> | null = null;
let driveLabelProbe: Probe<Map<string, string>> | null = null;

/** Expand the `%VAR%` references a REG_EXPAND_SZ value carries. */
function expandWindowsEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

/**
 * `HKCU\…\Explorer\User Shell Folders` as value-name → path.
 *
 * This is where a known folder *actually* lives. OneDrive redirects Desktop,
 * Documents, and Pictures out of `%USERPROFILE%` on most consumer installs, so
 * guessing `~/Documents` would point the sidebar at a folder the user never
 * sees in Explorer. Failure is non-fatal — callers fall back to the
 * $HOME-relative guess.
 */
function readUserShellFolders(): Map<string, string> {
  const now = Date.now();
  if (userShellFoldersProbe && now - userShellFoldersProbe.at < PLACE_PROBE_TTL_MS) {
    return userShellFoldersProbe.value;
  }
  const values = new Map<string, string>();
  try {
    const probe = spawnSync(
      "reg.exe",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
      ],
      { encoding: "utf8", timeout: 4_000, windowsHide: true },
    );
    for (const line of (probe.stdout ?? "").split(/\r?\n/)) {
      // "    Personal    REG_EXPAND_SZ    %USERPROFILE%\Documents"
      const match = /^\s+(\S.*?)\s{2,}REG_(?:EXPAND_)?SZ\s{2,}(.+?)\s*$/.exec(line);
      if (match) values.set(match[1], expandWindowsEnv(match[2]));
    }
  } catch {
    /* reg.exe missing or blocked — the $HOME-relative fallback still works */
  }
  userShellFoldersProbe = { at: now, value: values };
  return values;
}

/**
 * Explorer's Quick-access folders in the order its sidebar lists them.
 * `registryValue` is the win32 source of truth; `dirName` is the
 * $HOME-relative fallback used on every other platform (and whenever the
 * registry read comes up empty).
 */
const KNOWN_FOLDERS: Array<{
  id: string;
  name: string;
  registryValue: string;
  dirName: string;
}> = [
  { id: "desktop", name: "Desktop", registryValue: "Desktop", dirName: "Desktop" },
  {
    id: "downloads",
    name: "Downloads",
    registryValue: "{374DE290-123F-4565-9164-39C4925E467B}",
    dirName: "Downloads",
  },
  { id: "documents", name: "Documents", registryValue: "Personal", dirName: "Documents" },
  { id: "pictures", name: "Pictures", registryValue: "My Pictures", dirName: "Pictures" },
  { id: "music", name: "Music", registryValue: "My Music", dirName: "Music" },
  { id: "videos", name: "Videos", registryValue: "My Video", dirName: "Videos" },
];

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The known folders that actually exist on this machine, redirection-aware on
 * win32. Missing folders are dropped rather than rendered as dead rows.
 */
export function listKnownFolders(): Place[] {
  const registry = process.platform === "win32" ? readUserShellFolders() : new Map<string, string>();
  const places: Place[] = [];
  const seen = new Set<string>();
  for (const folder of KNOWN_FOLDERS) {
    const candidate = registry.get(folder.registryValue) ?? path.join(homeRoot(), folder.dirName);
    const resolved = path.resolve(candidate);
    if (seen.has(resolved) || !isDirectory(resolved)) continue;
    seen.add(resolved);
    places.push({ id: folder.id, name: folder.name, path: resolved, kind: "known" });
  }
  return places;
}

/** Win32_LogicalDisk.DriveType → the name Explorer shows for an unlabeled volume. */
const DRIVE_TYPE_LABELS: Record<number, string> = {
  2: "Removable Disk",
  3: "Local Disk",
  4: "Network Drive",
  5: "CD Drive",
  6: "RAM Disk",
};

/**
 * Volume label per drive root (`C:\` → "Local Disk", `D:\` → "Games"), so the
 * sidebar reads like Explorer's instead of listing bare letters. Node exposes
 * no volume-label API, hence the one cached CIM query; when it fails the map
 * is simply empty and rows fall back to the bare root.
 */
function readDriveLabels(): Map<string, string> {
  const now = Date.now();
  if (driveLabelProbe && now - driveLabelProbe.at < PLACE_PROBE_TTL_MS) return driveLabelProbe.value;
  const labels = new Map<string, string>();
  try {
    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // -InputObject @(...) keeps a single-drive machine an array instead of
        // collapsing to a bare object the way a piped ConvertTo-Json would.
        "ConvertTo-Json -Compress -InputObject @(Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType)",
      ],
      { encoding: "utf8", timeout: 8_000, windowsHide: true },
    );
    const parsed: unknown = JSON.parse(probe.stdout?.trim() || "[]");
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!row || typeof row !== "object") continue;
      const { DeviceID, VolumeName, DriveType } = row as {
        DeviceID?: unknown;
        VolumeName?: unknown;
        DriveType?: unknown;
      };
      if (typeof DeviceID !== "string") continue;
      const label =
        (typeof VolumeName === "string" && VolumeName.trim()) ||
        (typeof DriveType === "number" ? DRIVE_TYPE_LABELS[DriveType] : undefined) ||
        "Disk";
      labels.set(`${DeviceID}\\`.toUpperCase(), label);
    }
  } catch {
    /* PowerShell or CIM unavailable — unlabeled rows are still navigable */
  }
  driveLabelProbe = { at: now, value: labels };
  return labels;
}

/** Volume roots as sidebar places: "Local Disk (C:)" on win32, "/" elsewhere. */
export function listDrivePlaces(): Place[] {
  const roots = listSystemRoots();
  if (process.platform !== "win32") {
    return roots.map((root) => ({ id: `drive:${root}`, name: root, path: root, kind: "drive" }));
  }
  const labels = readDriveLabels();
  return roots.map((root) => {
    const label = labels.get(root.toUpperCase());
    return {
      id: `drive:${root}`,
      // "C:\" → "C:", matching the "Local Disk (C:)" shape Explorer uses.
      name: label ? `${label} (${root.slice(0, 2)})` : root,
      path: root,
      kind: "drive",
    };
  });
}

/**
 * The picker's sidebar: Quick access ($HOME plus the known folders that exist)
 * and This PC (every volume root). Every path here is server-derived, and the
 * client still navigates to it through resolveBrowsableDir's trusted walk — so
 * the sidebar is an accelerator, not a new trust boundary.
 */
export function listPlaceGroups(): PlaceGroup[] {
  const home = homeRoot();
  return [
    {
      id: "quick",
      label: "Quick access",
      places: [
        { id: "home", name: "Home", path: home, kind: "home" },
        ...listKnownFolders().filter((place) => place.path !== home),
      ],
    },
    { id: "this-pc", label: "This PC", places: listDrivePlaces() },
  ];
}

/** Immediate subdirectories of `dir` (one level), sorted and noise-skipped. */
export function listSubdirs(dir: string): DirEntry[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirents
    .filter((d) => d.isDirectory() && !SKIP.has(d.name))
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
