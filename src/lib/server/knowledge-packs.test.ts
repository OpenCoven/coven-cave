// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const scratchRoot = path.join(process.cwd(), ".test-artifacts", "knowledge-packs");
await rm(scratchRoot, { recursive: true, force: true });
await mkdir(scratchRoot, { recursive: true });

const prevPlugins = process.env.COVEN_MARKETPLACE_PLUGINS_DIR;
const prevVault = process.env.COVEN_KNOWLEDGE_DIR;
const prevProjects = process.env.CAVE_PROJECTS_PATH_OVERRIDE;
const prevCaveHome = process.env.COVEN_CAVE_HOME;
const prevCovenHome = process.env.COVEN_HOME;
process.env.COVEN_MARKETPLACE_PLUGINS_DIR = path.join(scratchRoot, "plugins");
process.env.COVEN_KNOWLEDGE_DIR = path.join(scratchRoot, "vault");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(scratchRoot, "projects.json");
process.env.COVEN_CAVE_HOME = path.join(scratchRoot, "cave-home");
// The projects store's reconciliation gate scans `covenHome()` for legacy
// entries; leave that at the real ~/.coven and the test reads (and can fail
// on) the developer's live state (cave-spqh).
process.env.COVEN_HOME = path.join(scratchRoot, ".coven");

try {
  const packDir = path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "worldbuilding");
  await mkdir(path.join(packDir, "templates"), { recursive: true });
  await writeFile(path.join(packDir, "pack.json"), JSON.stringify({
    schemaVersion: "opencoven.knowledge-pack.v1",
    id: "worldbuilding",
    displayName: "Worldbuilding",
    description: "Seed story entities",
    version: "1.0.0",
    defaultRoot: "world",
    folders: [
      { id: "characters", name: "Characters", description: "People in the story", storyQuestion: "Who matters?", entityType: "character", fields: [{ key: "role", label: "Role" }], templates: ["character"] },
      { id: "locations", name: "Locations", description: "Places in the story", storyQuestion: "Where are we?", entityType: "location", fields: [], templates: ["location"] },
    ],
    templates: [
      { id: "character", folder: "characters", name: "Character", path: "templates/character.md" },
      { id: "location", folder: "locations", name: "Location", path: "templates/location.md" },
    ],
    skills: ["worldbuilder"], prompts: [], workflows: [],
  }), "utf8");
  await writeFile(path.join(packDir, "templates", "character.md"), "---\ntitle: Character Template\ntags: [npc]\nstatus: draft\n---\n\n# Character\n", "utf8");
  await writeFile(path.join(packDir, "templates", "location.md"), "---\ntitle: Location Template\n---\n\n# Location\n", "utf8");
  await mkdir(path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "broken"), { recursive: true });
  await writeFile(path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "broken", "pack.json"), "not json", "utf8");

  const projects = await import("../cave-projects.ts");
  const { loadConfig } = await import("../cave-config.ts");
  const vault = await import("./knowledge-vault.ts");
  const packs = await import("./knowledge-packs.ts");

  const listed = await packs.listKnowledgePacks();
  assert.deepEqual(listed.map((pack) => pack.id), ["worldbuilding"], "broken packs are skipped");
  assert.equal((await packs.readKnowledgePack("../x")), null, "pack ids are validated before paths are built");
  await assert.rejects(
    () => packs.readPackTemplate("worldbuilding", { id: "../x", folder: "characters", name: "Bad", path: "templates/../secret.md" }),
    /invalid template id/,
  );
  await assert.rejects(
    () => packs.readPackTemplate("worldbuilding", { id: "character", folder: "characters", name: "Bad", path: "../secret.md" }),
    /invalid template path/,
  );

  const firstVault = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "vault" });
  assert.equal(firstVault.ok, true);
  assert.deepEqual(firstVault.collections, ["characters", "locations"]);
  assert.deepEqual(firstVault.created.sort(), [
    "characters/character",
    "characters/collection.yml",
    "locations/collection.yml",
    "locations/location",
  ]);
  const character = await vault.readKnowledgeEntry("character", "characters");
  assert.equal(character?.enabled, false, "seeded vault stubs are disabled by default");
  assert.deepEqual(character?.extra, { type: "character", status: "draft" }, "seeded stubs preserve entity/template frontmatter in extra");
  assert.ok(character?.tags.includes("worldbuilding"), "seeded vault stubs include the pack id tag");
  assert.match(character?.body ?? "", /# Character/);
  assert.match(
    await readFile(path.join(process.env.COVEN_KNOWLEDGE_DIR, "characters", "character.md"), "utf8"),
    /status: draft/,
    "template frontmatter keys are preserved in seeded vault stubs",
  );
  assert.equal((await vault.readCollectionMeta("characters"))?.pack?.id, "worldbuilding");

  const secondVault = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "vault" });
  assert.deepEqual(secondVault.created, []);
  assert.deepEqual(secondVault.skipped.sort(), [
    "characters/character",
    "characters/collection.yml",
    "locations/collection.yml",
    "locations/location",
  ]);

  // Same-pack provenance must not license clobbering user customizations:
  // `summary` reaches every harness prompt, so a re-seed reverting it would be
  // silent data loss (docs promise seeding never overwrites existing files).
  await vault.writeCollectionMeta("characters", {
    name: "Characters",
    pack: { id: "worldbuilding", version: "0.1.0" },
    summary: "my customized summary",
  });
  const samePackReseed = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "vault" });
  assert.ok(samePackReseed.skipped.includes("characters/collection.yml"));
  assert.equal(
    (await vault.readCollectionMeta("characters"))?.summary,
    "my customized summary",
    "re-seeding never overwrites an existing collection.yml, even from the same pack",
  );

  await vault.writeCollectionMeta("characters", { name: "Other", pack: { id: "other-pack", version: "1" } });
  const protectedMeta = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "vault" });
  assert.ok(protectedMeta.skipped.includes("characters/collection.yml"));
  await writeFile(path.join(process.env.COVEN_KNOWLEDGE_DIR, "locations", "collection.yml"), ": : bad yaml", "utf8");
  const invalidMeta = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "vault" });
  assert.ok(invalidMeta.skipped.includes("locations/collection.yml"), "invalid existing collection meta is not overwritten");
  assert.equal(await readFile(path.join(process.env.COVEN_KNOWLEDGE_DIR, "locations", "collection.yml"), "utf8"), ": : bad yaml");

  const projectRoot = path.join(scratchRoot, "project");
  await mkdir(projectRoot, { recursive: true });
  await projects.createProject({ name: "Story", root: projectRoot });
  const projectSeed = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "project", projectRoot, subfolder: "world/season-one" });
  const base = path.join(projectRoot, "world", "season-one");
  assert.ok(projectSeed.created.includes(path.join(base, "characters", ".cave", "frontmatter.yml")));
  assert.ok(projectSeed.created.includes(path.join(base, "characters", "_templates", "character.md")));
  assert.ok(projectSeed.created.includes(path.join(base, "characters", "README.md")));
  assert.match(await readFile(path.join(base, "characters", ".cave", "frontmatter.yml"), "utf8"), /entityType: character/);
  assert.match(await readFile(path.join(base, "characters", "README.md"), "utf8"), /Who matters\?/);
  assert.match(await readFile(path.join(base, "characters", "_templates", "character.md"), "utf8"), /# Character/);
  const secondProject = await packs.seedKnowledgePack({ packId: "worldbuilding", target: "project", projectRoot, subfolder: "world/season-one" });
  assert.equal(secondProject.created.length, 0, "project seed is idempotent");
  assert.ok(secondProject.skipped.length >= 6, "existing project files are skipped");

  const cfg = await loadConfig();
  assert.ok(cfg.marketplace.knowledgePacks.some((entry) => entry.id === "worldbuilding" && entry.target === "vault"));
  assert.ok(cfg.marketplace.knowledgePacks.some((entry) => entry.id === "worldbuilding" && entry.target === "project" && entry.root === projectRoot));

  await assert.rejects(() => packs.seedKnowledgePack({ packId: "../x", target: "vault" }), /invalid pack id/);
  await assert.rejects(() => packs.seedKnowledgePack({ packId: "worldbuilding", target: "project", projectRoot, subfolder: ".." }), /invalid subfolder/);
  await assert.rejects(() => packs.seedKnowledgePack({ packId: "worldbuilding", target: "project", projectRoot: path.join(scratchRoot, "unregistered") }), /unregistered project root/);
  await assert.rejects(() => packs.seedKnowledgePack({ packId: "worldbuilding", target: "project", projectRoot, subfolder: "a/b/c/d" }), /invalid subfolder/);
} finally {
  if (prevPlugins === undefined) delete process.env.COVEN_MARKETPLACE_PLUGINS_DIR; else process.env.COVEN_MARKETPLACE_PLUGINS_DIR = prevPlugins;
  if (prevVault === undefined) delete process.env.COVEN_KNOWLEDGE_DIR; else process.env.COVEN_KNOWLEDGE_DIR = prevVault;
  if (prevProjects === undefined) delete process.env.CAVE_PROJECTS_PATH_OVERRIDE; else process.env.CAVE_PROJECTS_PATH_OVERRIDE = prevProjects;
  if (prevCaveHome === undefined) delete process.env.COVEN_CAVE_HOME; else process.env.COVEN_CAVE_HOME = prevCaveHome;
  if (prevCovenHome === undefined) delete process.env.COVEN_HOME; else process.env.COVEN_HOME = prevCovenHome;
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("knowledge-packs.test.ts: ok");
