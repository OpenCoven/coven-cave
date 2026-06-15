import path from "node:path";
import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";

/**
 * Allow-list for the Capabilities skill-preview reader (/api/skills/file).
 *
 * Skills surface in the Capabilities map with an on-disk `path` (a SKILL.md,
 * Codex automation.toml, or a harness instructions file like CLAUDE.md /
 * AGENTS.md). To render that file server-side from a user-supplied path, the
 * path MUST be constrained to the well-known harness/skill roots under $HOME —
 * otherwise the route is an arbitrary-file-read primitive.
 *
 * The guard rejects symlinks, resolves both the candidate and root through the
 * filesystem, and only allows expected instruction/skill filenames. This keeps
 * the preview endpoint from exposing arbitrary markdown or symlink targets from
 * broad harness directories.
 */
const SKILL_ROOT_SUBPATHS = [".claude", ".coven", ".codex", ".cursor", ".gemini"];
const ALLOWED_SKILL_FILE_NAMES = new Set(["SKILL.md", "CLAUDE.md", "AGENTS.md"]);
const CODEX_AUTOMATION_FILE_NAME = "automation.toml";

export const MAX_SKILL_FILE_PREVIEW_BYTES = 512 * 1024;

function isWithinRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function isAllowedSkillFileName(fullPath: string): boolean {
  const basename = path.basename(fullPath);
  return ALLOWED_SKILL_FILE_NAMES.has(basename) || basename === CODEX_AUTOMATION_FILE_NAME;
}

export async function isAllowedSkillFilePath(fullPath: string, home = homedir()): Promise<boolean> {
  if (!fullPath || !isAllowedSkillFileName(fullPath)) return false;

  let candidateStat;
  let candidateRealPath: string;
  try {
    candidateStat = await lstat(fullPath);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) return false;
    candidateRealPath = await realpath(fullPath);
  } catch {
    return false;
  }

  if (path.basename(candidateRealPath) === CODEX_AUTOMATION_FILE_NAME) {
    try {
      const automationsRoot = await realpath(path.join(home, ".codex", "automations"));
      return isWithinRoot(candidateRealPath, automationsRoot);
    } catch {
      return false;
    }
  }

  for (const sub of SKILL_ROOT_SUBPATHS) {
    try {
      const rootRealPath = await realpath(path.join(home, sub));
      if (isWithinRoot(candidateRealPath, rootRealPath)) return true;
    } catch {
      // Missing harness roots are not previewable roots.
    }
  }

  return false;
}
