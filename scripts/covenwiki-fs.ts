// CovenWiki shared filesystem helpers (Phase 1, cave-whji).
//
// Extracted from scripts/covenwiki-regen.ts so both sides of the Phase 3
// staleness contract share ONE walk and ONE stat inventory: the
// `source.fingerprint` a generator writes into manifest.json and the live
// fingerprint `covenwiki-regen status` computes must be built from an
// identical inventory, or every wiki reads as permanently "stale". Sharing
// the implementation makes the parity structural instead of aspirational
// (see the computeSourceFingerprint contract note in src/lib/covenwiki-regen.ts).

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { StatEntry } from "../src/lib/covenwiki-regen.ts";

/** Directories never counted as wiki source (build output, deps, VCS). */
export const SKIP_DIRS = new Set([".git", "node_modules", ".worktrees", ".next", "target"]);

/** Recursively collect file paths under root, skipping hidden dirs + SKIP_DIRS. */
export function walk(root: string, out: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

/**
 * Stat-only inventory of a repo root — the exact input of the Phase 3
 * fingerprint contract (repo-relative POSIX paths + size + mtimeMs).
 */
export function statInventory(repoRoot: string): StatEntry[] {
  const files: string[] = [];
  walk(repoRoot, files);
  return files.map((file) => {
    const st = statSync(file);
    return {
      path: path.relative(repoRoot, file).split(path.sep).join("/"),
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  });
}
