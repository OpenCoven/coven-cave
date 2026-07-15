import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";
import { writeFileAtomic } from "@/lib/server/atomic-write";
import {
  composeSkillMd,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_INSTRUCTIONS_BYTES,
  MAX_SKILL_NAME_CHARS,
  SKILL_BUILD_ROOTS,
  slugifySkillName,
  type SkillBuildRootId,
} from "@/lib/skill-build-format";

/**
 * Skill authoring for the Marketplace "Build" tab.
 *
 * Composes a SKILL.md (via the shared client/server formatter in
 * src/lib/skill-build-format.ts, so the live preview and the written file are
 * the same artifact) and writes it to `<root>/<slug>/SKILL.md` inside one of
 * the four local skill roots the app already scans — a built skill is
 * immediately visible in the Skills tab and to the harnesses that load that
 * root.
 *
 * Writes are creation-only: an existing skill directory is refused
 * (`code: "exists"`), never overwritten. The slug is path-safe by
 * construction (slugifySkillName only emits `[a-z0-9-]`).
 */

export { composeSkillMd, SKILL_BUILD_ROOTS, slugifySkillName, type SkillBuildRootId };

export type SkillBuildInput = {
  name: string;
  description: string;
  instructions: string;
  root: SkillBuildRootId;
  tags?: string[];
};

export type SkillBuildResult =
  | { ok: true; slug: string; dir: string; path: string }
  | { ok: false; code: "invalid" | "exists" | "io"; error: string };

type RootOptions = { home?: string; covenHome?: string };

// Must stay in lockstep with skill-scan.ts scan roots — that is what makes a
// built skill immediately visible in the Skills tab.
export function resolveBuildRoot(root: SkillBuildRootId, opts: RootOptions = {}): string | null {
  const home = opts.home ?? homedir();
  switch (root) {
    case "coven":
      return path.join(opts.covenHome ?? covenHome(), "skills");
    case "claude":
      return path.join(home, ".claude", "skills");
    case "codex":
      return path.join(home, ".codex", "skills");
    case "agents":
      return path.join(home, ".agents", "skills");
    default:
      return null;
  }
}

export function validateSkillBuildInput(input: SkillBuildInput): string | null {
  if (!input.name.trim()) return "name required";
  if (input.name.trim().length > MAX_SKILL_NAME_CHARS) return `name too long (max ${MAX_SKILL_NAME_CHARS} characters)`;
  if (!input.description.trim()) return "description required";
  if (input.description.trim().length > MAX_SKILL_DESCRIPTION_CHARS) {
    return `description too long (max ${MAX_SKILL_DESCRIPTION_CHARS} characters)`;
  }
  if (!input.instructions.trim()) return "instructions required";
  if (Buffer.byteLength(input.instructions, "utf8") > MAX_SKILL_INSTRUCTIONS_BYTES) {
    return "instructions too large (max 64 KB)";
  }
  if (!SKILL_BUILD_ROOTS.some((root) => root.id === input.root)) return "unknown destination root";
  if (!slugifySkillName(input.name)) return "name must contain letters or numbers";
  return null;
}

export async function buildSkill(input: SkillBuildInput, opts: RootOptions = {}): Promise<SkillBuildResult> {
  const invalid = validateSkillBuildInput(input);
  if (invalid) return { ok: false, code: "invalid", error: invalid };

  const rootDir = resolveBuildRoot(input.root, opts);
  if (!rootDir) return { ok: false, code: "invalid", error: "unknown destination root" };

  const slug = slugifySkillName(input.name);
  const dir = path.join(rootDir, slug);
  const filePath = path.join(dir, "SKILL.md");

  try {
    await stat(dir);
    return { ok: false, code: "exists", error: `a skill with id "${slug}" already exists at ${dir}` };
  } catch {
    // Missing directory is the happy path.
  }

  try {
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(filePath, composeSkillMd(input));
  } catch (err) {
    return { ok: false, code: "io", error: err instanceof Error ? err.message : "write failed" };
  }

  return { ok: true, slug, dir, path: filePath };
}
