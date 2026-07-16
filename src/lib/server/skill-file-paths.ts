import path from "node:path";
import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { covenHome } from "@/lib/coven-paths";

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
const HOME_SKILL_ROOT_SUBPATHS = [".claude", ".coven", ".codex", ".cursor", ".gemini", path.join(".agents", "skills")];
const PROJECT_SKILL_ROOT_SUBPATHS = [path.join(".agents", "skills")];
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
    candidateStat = await lstat(/* turbopackIgnore: true */ fullPath);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) return false;
    candidateRealPath = await realpath(/* turbopackIgnore: true */ fullPath);
  } catch {
    return false;
  }

  if (path.basename(candidateRealPath) === CODEX_AUTOMATION_FILE_NAME) {
    try {
      const automationsRoot = await realpath(
        /* turbopackIgnore: true */ path.join(home, ".codex", "automations"),
      );
      return isWithinRoot(candidateRealPath, automationsRoot);
    } catch {
      return false;
    }
  }

  for (const sub of HOME_SKILL_ROOT_SUBPATHS) {
    try {
      const rootRealPath = await realpath(
        /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ home, sub),
      );
      if (isWithinRoot(candidateRealPath, rootRealPath)) return true;
    } catch {
      // Missing harness roots are not previewable roots.
    }
  }

  for (const sub of PROJECT_SKILL_ROOT_SUBPATHS) {
    try {
      const rootRealPath = await realpath(
        /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ process.cwd(), sub),
      );
      if (isWithinRoot(candidateRealPath, rootRealPath)) return true;
    } catch {
      // Missing project roots are not previewable roots.
    }
  }

  return false;
}

/**
 * Guard for DELETE /api/skills/local — removing a scanned skill's directory.
 *
 * Deleting a directory recursively from a user-supplied path is a destructive
 * primitive, so it is constrained HARD: the target's realpath must be an
 * IMMEDIATE child of one of the two skill scan roots (`covenHome()/skills` or
 * `~/.claude/skills`), must be a real directory (not a symlink), and can never
 * be a root itself or anything nested deeper/outside. This matches exactly what
 * `/api/skills/local` enumerates, so you can only delete a skill you can see.
 */
export async function isRemovableSkillDir(dir: string, home = homedir()): Promise<boolean> {
  if (!dir) return false;

  let real: string;
  try {
    const st = await lstat(/* turbopackIgnore: true */ dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    real = await realpath(/* turbopackIgnore: true */ dir);
  } catch {
    return false;
  }

  const parent = path.dirname(real);
  const rootCandidates = [
    path.join(covenHome(), "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(process.cwd(), ".agents", "skills"),
  ];
  for (const root of rootCandidates) {
    try {
      const rootReal = await realpath(/* turbopackIgnore: true */ root);
      // Must be a DIRECT child of a scan root — never the root itself, never nested.
      if (parent === rootReal && real !== rootReal) return true;
    } catch {
      // Missing root → not a removable location.
    }
  }
  return false;
}
