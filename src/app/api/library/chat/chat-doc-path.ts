/**
 * chat-doc-path.ts
 *
 * Path security and resolution logic for the library chat route.
 * Extracted so it can be tested independently of the HTTP layer.
 *
 * Security contract:
 *   - The resolved real path must be within ~/.openclaw/workspace/sage/research/
 *   - No symlink escapes (realpath is used)
 *   - No null bytes, no non-absolute inputs
 *   - Max file size: 200KB
 *   - Target must be a regular file
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const SAGE_RESEARCH_ROOT = path.join(
  homedir(),
  ".openclaw",
  "workspace",
  "sage",
  "research",
);

const MAX_DOC_BYTES = 200 * 1024; // 200KB

export type LibraryChatDocResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "forbidden" | "not_found" | "too_large" | "not_file" };

export type LibraryChatDocumentRead =
  | { ok: true; path: string; content: string }
  | { ok: false; reason: "forbidden" | "not_found" | "too_large" | "not_file" };

type LibraryChatDocPathOptions = {
  researchRoot?: string;
};

function isWithinRoot(value: string, root: string): boolean {
  const relative = path.relative(root, value);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function listResearchEntries(root: string): Array<{ path: string; isFile: boolean }> {
  const entries: Array<{ path: string; isFile: boolean }> = [];

  function walk(dir: string) {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        entries.push({ path: fullPath, isFile: false });
        walk(fullPath);
      } else if (dirent.isFile()) {
        entries.push({ path: fullPath, isFile: true });
      }
    }
  }

  walk(root);
  return entries;
}

/**
 * Resolve and validate a raw (absolute) path for library chat access.
 *
 * Returns `{ ok: true, path }` when the path is safe, exists, is a regular
 * file, and is within the sage research root. Otherwise returns a typed
 * failure reason for the caller to translate to an HTTP status.
 */
export function resolveLibraryChatDocPath(
  rawPath: string,
  options: LibraryChatDocPathOptions = {},
): LibraryChatDocResolution {
  // Basic sanity: must be non-empty, no null bytes, must be absolute.
  if (!rawPath || rawPath.includes("\0") || !path.isAbsolute(rawPath)) {
    return { ok: false, reason: "forbidden" };
  }

  // Normalize to remove any .. sequences before attempting realpath.
  const normalized = path.normalize(rawPath);

  // Resolve the real research root (handles symlinks in the home path itself).
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync(options.researchRoot ?? SAGE_RESEARCH_ROOT);
  } catch {
    // Research root doesn't exist yet — nothing can be found within it.
    return { ok: false, reason: "not_found" };
  }

  // Resolve the requested path, following all symlinks.
  let resolvedPath: string;
  try {
    resolvedPath = fs.realpathSync(normalized);
  } catch {
    // Path doesn't exist at all.
    return { ok: false, reason: "not_found" };
  }

  // Security check: resolved path must be inside the research root.
  if (!isWithinRoot(resolvedPath, resolvedRoot)) {
    return { ok: false, reason: "forbidden" };
  }

  const matchedEntry = listResearchEntries(resolvedRoot).find((entry) => entry.path === resolvedPath);
  if (!matchedEntry) {
    return { ok: false, reason: "not_found" };
  }

  if (!matchedEntry.isFile) {
    return { ok: false, reason: "not_file" };
  }

  const stat = fs.statSync(matchedEntry.path);

  if (stat.size > MAX_DOC_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  return { ok: true, path: matchedEntry.path };
}

export function readLibraryChatDocument(
  rawPath: string,
  options: LibraryChatDocPathOptions = {},
): LibraryChatDocumentRead {
  const resolution = resolveLibraryChatDocPath(rawPath, options);
  if (!resolution.ok) return resolution;

  try {
    return {
      ok: true,
      path: resolution.path,
      // turbopackIgnore: true — path is runtime-validated, not a build-time import.
      content: fs.readFileSync(/* turbopackIgnore: true */ resolution.path, "utf-8"),
    };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}
