import { copyText } from "./clipboard.ts";
import { isTauri } from "./tauri-platform.ts";

/**
 * Links in chat that point at a file or folder on this machine.
 *
 * A familiar writes `[report](/Users/me/notes/report.md)`, `file:///…`,
 * `~/notes`, or a project-relative `[guide](docs/guide.md#L12)`. The browser
 * resolves every one of those against the page, so the click used to land on
 * `http://127.0.0.1:<port>/Users/…` in the embedded browser — a page that
 * cannot exist. A local path now opens in the system file manager instead:
 * a folder opens, a file is selected in its folder. Nothing is ever launched,
 * so a link cannot run a script by being clicked.
 */

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
// `path:42` or `path:42:7` — an editor-style line reference, not part of the name.
const LINE_SUFFIX_RE = /:\d+(?::\d+)?$/;

/**
 * First segments that mark an absolute POSIX path as a filesystem path rather
 * than an app route. `/settings` or `/#chat-…` are Cave pages; `/Users/…` is
 * a file. A path outside these roots is left alone rather than guessed at.
 */
const FILESYSTEM_ROOTS = new Set([
  "Applications",
  "Library",
  "System",
  "Users",
  "Volumes",
  "etc",
  "home",
  "media",
  "mnt",
  "nix",
  "opt",
  "private",
  "root",
  "run",
  "srv",
  "tmp",
  "usr",
  "var",
]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripLineSuffix(path: string): string {
  return path.replace(LINE_SUFFIX_RE, "");
}

/** A relative href that reads as a path (`docs/a.md`, `./x`, `..\\x`, `README.md`). */
function looksLikeRelativePath(path: string): boolean {
  if (!path || /[\n\r\t]/.test(path)) return false;
  return /[\\/]/.test(path) || /\.[A-Za-z0-9]{1,10}$/.test(path);
}

/** Join a project root and a relative path, resolving `.` and `..`. */
function joinProjectPath(projectRoot: string, relative: string): string {
  const windows = WINDOWS_DRIVE_RE.test(projectRoot);
  const separator = windows ? "\\" : "/";
  const leading = windows ? "" : "/";
  // On Windows the first segment is the drive, which `..` cannot climb past.
  const floor = windows ? 1 : 0;
  const segments = projectRoot.split(/[\\/]+/).filter(Boolean);
  for (const segment of relative.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > floor) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return leading + segments.join(separator);
}

/**
 * The local path a chat link points at, or null when it is not one: a web
 * link, an app route, a fragment, or a relative path with no project to
 * resolve it against. `~` stays unexpanded; the desktop shell expands it.
 */
export function localPathFromHref(rawHref: string, projectRoot: string | null = null): string | null {
  const raw = rawHref.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("?") || raw.startsWith("//")) return null;

  if (/^file:/i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    // A file URL naming another host is a network share, not this machine.
    if (url.host && url.host !== "localhost") return null;
    let path = safeDecode(url.pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1).replace(/\//g, "\\");
    return path ? stripLineSuffix(path) : null;
  }

  const bare = raw.split("#")[0].split("?")[0];
  if (!bare) return null;
  const path = stripLineSuffix(safeDecode(bare));

  // Checked before the scheme test: `C:` would otherwise read as a scheme.
  if (WINDOWS_DRIVE_RE.test(path)) return path;
  if (SCHEME_RE.test(path)) return null;
  if (path === "~" || path.startsWith("~/")) return path;
  if (path.startsWith("/")) {
    return FILESYSTEM_ROOTS.has(path.split("/")[1] ?? "") ? path : null;
  }
  if (!projectRoot || !looksLikeRelativePath(path)) return null;
  return joinProjectPath(projectRoot, path);
}

/** What the system file manager is called here, for the link's tooltip. */
export function revealLocalPathLabel(): string {
  if (typeof navigator === "undefined") return "Show in folder";
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  if (/mac/i.test(platform)) return "Show in Finder";
  if (/win/i.test(platform)) return "Show in File Explorer";
  return "Show in folder";
}

export type RevealLocalPathOutcome = "revealed" | "copied" | "failed";

/**
 * Show `path` in the system file manager. A browser has no way to do that,
 * and the desktop shell refuses a path that does not exist; either way the
 * path is copied so the person can still get to it.
 */
export async function revealLocalPath(path: string): Promise<RevealLocalPathOutcome> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_reveal_path", { path });
      return "revealed";
    } catch (error) {
      console.warn("[local-path-link] The desktop shell could not show this path.", error);
    }
  }
  return (await copyText(path)) ? "copied" : "failed";
}
