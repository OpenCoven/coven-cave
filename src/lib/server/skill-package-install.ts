import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { covenHome } from "../coven-paths.ts";
import { isValidPackSlug } from "../knowledge-pack-types.ts";
import { marketplacePluginsRoot } from "./knowledge-packs.ts";

export type SkillPackageInstallTarget = "coven" | "agents";

export type SkillPackageInstallRequest = {
  packId: string;
  skillId: string;
  targets?: SkillPackageInstallTarget[];
};

export type SkillPackageInstallResult = {
  ok: true;
  installedTo: string[];
  alreadyInstalled: boolean;
};

function assertSkillPackageId(value: string, label: string): void {
  if (!isValidPackSlug(value)) throw new Error(`invalid ${label} id`);
}

function sourceSkillDir(packId: string, skillId: string): string {
  assertSkillPackageId(packId, "pack");
  assertSkillPackageId(skillId, "skill");
  const pluginsRoot = path.resolve(marketplacePluginsRoot());
  const packDir = path.resolve(pluginsRoot, packId);
  const skillsRoot = path.resolve(packDir, "skills");
  const source = path.resolve(skillsRoot, skillId);
  if (!packDir.startsWith(pluginsRoot + path.sep) || !source.startsWith(skillsRoot + path.sep)) {
    throw new Error("invalid skill source");
  }
  return source;
}

async function requireSkillMd(dir: string): Promise<void> {
  try {
    const st = await stat(path.join(dir, "SKILL.md"));
    if (!st.isFile()) throw new Error("missing SKILL.md");
  } catch {
    throw new Error("missing SKILL.md");
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeTargets(targets: unknown): SkillPackageInstallTarget[] {
  if (targets === undefined) return ["coven"];
  if (!Array.isArray(targets)) throw new Error("invalid targets");
  const out: SkillPackageInstallTarget[] = [];
  for (const target of targets) {
    if (target !== "coven" && target !== "agents") throw new Error("invalid targets");
    if (!out.includes(target)) out.push(target);
  }
  return out.length > 0 ? out : ["coven"];
}

function targetDir(target: SkillPackageInstallTarget, skillId: string): string {
  if (target === "coven") return path.join(covenHome(), "skills", skillId);
  return path.join(homedir(), ".agents", "skills", skillId);
}

export async function installSkillPackage(request: SkillPackageInstallRequest): Promise<SkillPackageInstallResult> {
  const source = sourceSkillDir(request.packId, request.skillId);
  await requireSkillMd(source);
  const targets = normalizeTargets(request.targets);
  const installedTo = targets.map((target) => targetDir(target, request.skillId));
  const existing = await Promise.all(installedTo.map(dirExists));
  if (existing.every(Boolean)) return { ok: true, installedTo, alreadyInstalled: true };

  for (let i = 0; i < installedTo.length; i += 1) {
    if (existing[i]) continue;
    await mkdir(path.dirname(installedTo[i]), { recursive: true });
    await cp(source, installedTo[i], {
      recursive: true,
      errorOnExist: false,
      force: false,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
  return { ok: true, installedTo, alreadyInstalled: false };
}
