// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const scratchRoot = path.join(process.cwd(), ".test-artifacts", "skill-package-install");
await rm(scratchRoot, { recursive: true, force: true });
await mkdir(scratchRoot, { recursive: true });

const prevPlugins = process.env.COVEN_MARKETPLACE_PLUGINS_DIR;
const prevHome = process.env.COVEN_HOME;
const prevRealHome = process.env.HOME;
process.env.COVEN_MARKETPLACE_PLUGINS_DIR = path.join(scratchRoot, "plugins");
process.env.COVEN_HOME = path.join(scratchRoot, "coven-home");
process.env.HOME = path.join(scratchRoot, "home");

try {
  const source = path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "worldbuilding", "skills", "worldbuilder");
  await mkdir(path.join(source, "references"), { recursive: true });
  await mkdir(path.join(source, "scripts"), { recursive: true });
  await writeFile(path.join(source, "SKILL.md"), "# Worldbuilder\n", "utf8");
  await writeFile(path.join(source, "references", "guide.md"), "guide", "utf8");
  await writeFile(path.join(source, "scripts", "helper.sh"), "echo ok\n", "utf8");

  const { installSkillPackage } = await import("./skill-package-install.ts");

  const first = await installSkillPackage({ packId: "worldbuilding", skillId: "worldbuilder", targets: ["coven", "agents"] });
  assert.equal(first.ok, true);
  assert.equal(first.alreadyInstalled, false);
  const covenTarget = path.join(process.env.COVEN_HOME, "skills", "worldbuilder");
  const agentsTarget = path.join(process.env.HOME, ".agents", "skills", "worldbuilder");
  assert.deepEqual(first.installedTo.sort(), [agentsTarget, covenTarget].sort());
  assert.equal(await readFile(path.join(covenTarget, "SKILL.md"), "utf8"), "# Worldbuilder\n");
  assert.equal(await readFile(path.join(covenTarget, "references", "guide.md"), "utf8"), "guide");
  assert.equal(await readFile(path.join(agentsTarget, "scripts", "helper.sh"), "utf8"), "echo ok\n");

  await writeFile(path.join(covenTarget, "SKILL.md"), "local edit\n", "utf8");
  const second = await installSkillPackage({ packId: "worldbuilding", skillId: "worldbuilder" });
  assert.equal(second.alreadyInstalled, true, "second install does not touch existing destination");
  assert.equal(await readFile(path.join(covenTarget, "SKILL.md"), "utf8"), "local edit\n");

  await assert.rejects(() => installSkillPackage({ packId: "../x", skillId: "worldbuilder" }), /invalid pack id/);
  await assert.rejects(() => installSkillPackage({ packId: "worldbuilding", skillId: "bad/skill" }), /invalid skill id/);

  await mkdir(path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "worldbuilding", "skills", "empty"), { recursive: true });
  await assert.rejects(() => installSkillPackage({ packId: "worldbuilding", skillId: "empty" }), /missing SKILL.md/);
} finally {
  if (prevPlugins === undefined) delete process.env.COVEN_MARKETPLACE_PLUGINS_DIR; else process.env.COVEN_MARKETPLACE_PLUGINS_DIR = prevPlugins;
  if (prevHome === undefined) delete process.env.COVEN_HOME; else process.env.COVEN_HOME = prevHome;
  if (prevRealHome === undefined) delete process.env.HOME; else process.env.HOME = prevRealHome;
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("skill-package-install.test.ts: ok");
