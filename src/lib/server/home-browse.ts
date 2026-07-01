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
 * Resolve a requested directory to a real path guaranteed to sit within `root`.
 *
 * The result is **reconstructed from validated path segments** off the fixed
 * `root`, so no raw user-supplied string ever reaches the filesystem — this
 * defuses `js/path-injection` rather than relying on a boolean "is it inside?"
 * guard (which CodeQL doesn't treat as a sanitizer). Returns `null` when the
 * request escapes `root`; an empty/absent request maps to `root` itself.
 */
export function resolveWithinRoot(
  root: string,
  requested: string | null | undefined,
): string | null {
  const base = path.resolve(root);
  const raw = (requested ?? "").trim();
  // Absolute requests win over `base` (path.resolve semantics); relative ones
  // join onto it. Either way we re-derive the path from the relative segments.
  const resolved = raw === "" ? base : path.resolve(base, raw);
  const rel = path.relative(base, resolved);
  if (rel === "") return base;
  if (path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  if (segments.some((segment) => segment === "..")) return null;
  return path.join(base, ...segments);
}

export type DirEntry = { name: string; path: string };

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
