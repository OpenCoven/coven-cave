import fs from "node:fs";
import path from "node:path";

export type BeadsWorkspaceResolution =
  | { ok: true; beadsDir: string }
  | { ok: false; error: "not a Beads workspace" | "unsafe Beads workspace" };

/**
 * Resolve a workspace only when `.beads` is a real directory under this exact
 * canonical project root. Never follow a symlink: BEADS_DIR controls where bd
 * writes, so accepting one can turn a displayed project into another project's
 * mutation target.
 */
export function resolveSafeBeadsWorkspace(repoRoot: string): BeadsWorkspaceResolution {
  const beadsDir = path.join(repoRoot, ".beads");
  try {
    const entry = fs.lstatSync(beadsDir);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return { ok: false, error: "unsafe Beads workspace" };
    const canonicalBeads = fs.realpathSync(beadsDir);
    if (canonicalBeads !== beadsDir || !canonicalBeads.startsWith(repoRoot + path.sep)) {
      return { ok: false, error: "unsafe Beads workspace" };
    }
    return { ok: true, beadsDir };
  } catch {
    return { ok: false, error: "not a Beads workspace" };
  }
}
