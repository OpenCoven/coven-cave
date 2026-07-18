import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// Build-artifact / noise directories the folder browser hides. Dotfiles are
// hidden separately (Finder-style), so a picker over $HOME stays readable.
const SKIP = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "target",
  "out",
]);

export function homeRoot(): string {
  return path.resolve(homedir());
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

/** Immediate visible subdirectories of `dir` (one level), sorted, noise-skipped. */
export function listSubdirs(dir: string): DirEntry[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP.has(d.name))
    .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
