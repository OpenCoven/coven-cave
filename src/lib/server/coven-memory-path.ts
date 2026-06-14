import path from "node:path";
import { homedir } from "node:os";
import { isMemoryFilePathAllowed } from "./memory-file-sources.ts";

/**
 * Resolve a daemon coven-memory entry to an absolute, allow-listed file path.
 *
 * The daemon reports memory entries with a relative `path` of the form
 * `<familiarId>/<...>.md` (e.g. `sage/2026-05-24.md`). On disk these live under
 * `~/.coven/workspaces/familiars/<familiarId>/memory/<...>`. This maps the relative
 * path to that absolute location and returns it ONLY when it passes the shared
 * memory allow-list (which resolves the path and verifies containment) — so a
 * traversal-laden or out-of-tree path yields `undefined` rather than a readable path.
 *
 * Returns `undefined` when the path can't be resolved or isn't allowed; callers
 * fall back to the entry's excerpt.
 */
export function resolveCovenMemoryFullPath(
  entry: { path?: string; familiar_id?: string },
  home = homedir(),
): string | undefined {
  const rawPath = entry.path?.trim();
  if (!rawPath) return undefined;

  // An already-absolute path is honored only if it's within an allowed root.
  if (path.isAbsolute(rawPath)) {
    return isMemoryFilePathAllowed(rawPath, home) ? rawPath : undefined;
  }

  const familiarId = entry.familiar_id?.trim();
  if (!familiarId) return undefined;

  // Normalize separators and strip a redundant leading "<familiarId>/" prefix.
  let rel = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel === familiarId) return undefined;
  if (rel.startsWith(`${familiarId}/`)) rel = rel.slice(familiarId.length + 1);
  if (!rel) return undefined;

  // Inline traversal barrier: reject any `..` segment in either the id or the
  // remainder before constructing the candidate (defense in depth alongside the
  // allow-list containment check below).
  const segments = [familiarId, ...rel.split("/")];
  if (segments.some((s) => s === ".." || s === "" || s === ".")) return undefined;

  const candidate = path.join(
    home,
    ".coven",
    "workspaces",
    "familiars",
    familiarId,
    "memory",
    ...rel.split("/"),
  );
  return isMemoryFilePathAllowed(candidate, home) ? candidate : undefined;
}
