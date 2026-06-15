import path from "node:path";
import { homedir } from "node:os";

/**
 * Allow-list for the Capabilities skill-preview reader (/api/skills/file).
 *
 * Skills surface in the Capabilities map with an on-disk `path` (a SKILL.md, or
 * a harness instructions file like CLAUDE.md / AGENTS.md). To render that file
 * as styled markdown we read it server-side from a user-supplied path, so the
 * path MUST be constrained to the well-known harness/skill roots under $HOME —
 * otherwise the route is an arbitrary-file-read primitive.
 *
 * The barrier is the inline `path.resolve` + containment check below: the
 * resolved candidate must live within one of the allow-listed roots and carry a
 * `.md` extension. A traversal-laden or out-of-tree path fails containment and
 * yields `false`, so the caller returns 403 and the UI falls back to the
 * scanned description/excerpt.
 */
const SKILL_ROOT_SUBPATHS = [".claude", ".coven", ".codex", ".cursor", ".gemini"];

function isWithinRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function isAllowedSkillFilePath(fullPath: string, home = homedir()): boolean {
  if (!fullPath) return false;
  const resolved = path.resolve(/* turbopackIgnore: true */ fullPath);
  // Only markdown files are previewable — skills and harness instructions are
  // markdown; anything else (plugin binaries, configs) is not a skill doc.
  if (path.extname(resolved).toLowerCase() !== ".md") return false;
  return SKILL_ROOT_SUBPATHS.some((sub) =>
    isWithinRoot(resolved, path.resolve(/* turbopackIgnore: true */ path.join(home, sub))),
  );
}
