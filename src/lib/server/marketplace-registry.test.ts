import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMarketplaceRegistry, marketplaceRegistryOverrides } from "./marketplace-registry.ts";

test("creates a pinned command-local registry, copies selected payload only, and detects modifications", async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), "cave-registry-"));
  const previousHome = process.env.COVEN_CAVE_HOME;
  const previousPlugins = process.env.COVEN_MARKETPLACE_PLUGINS_DIR;
  process.env.COVEN_CAVE_HOME = path.join(scratch, "cave");
  process.env.COVEN_MARKETPLACE_PLUGINS_DIR = path.join(scratch, "payloads");
  t.after(async () => {
    if (previousHome === undefined) delete process.env.COVEN_CAVE_HOME;
    else process.env.COVEN_CAVE_HOME = previousHome;
    if (previousPlugins === undefined) delete process.env.COVEN_MARKETPLACE_PLUGINS_DIR;
    else process.env.COVEN_MARKETPLACE_PLUGINS_DIR = previousPlugins;
    await rm(scratch, { recursive: true, force: true });
  });
  const source = path.join(process.env.COVEN_MARKETPLACE_PLUGINS_DIR, "seekers-lens");
  await mkdir(path.join(source, "skills"), { recursive: true });
  await writeFile(path.join(source, "plugin.json"), '{"name":"seekers-lens"}');
  await writeFile(path.join(source, "skills", "SKILL.md"), "verified instructions");
  const root = await prepareMarketplaceRegistry();
  const manifest = JSON.parse(await readFile(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(manifest.name, "opencoven-first-party");
  assert.ok(manifest.plugins.some((plugin: { name: string }) => plugin.name === "seekers-lens"));
  assert.equal(await prepareMarketplaceRegistry("seekers-lens"), root);
  const installedSkill = path.join(root, "plugins", "seekers-lens", "skills", "SKILL.md");
  assert.equal(await readFile(installedSkill, "utf8"), "verified instructions");
  assert.equal(await prepareMarketplaceRegistry("seekers-lens"), root);
  await writeFile(installedSkill, "modified");
  await assert.rejects(prepareMarketplaceRegistry("seekers-lens"), /modified/);
  const args = marketplaceRegistryOverrides('/path with spaces/"quoted"');
  assert.equal(args[0], "-c");
  assert.equal(args[2], "-c");
  assert.equal(args[3], 'marketplaces.opencoven-first-party.source="/path with spaces/\\"quoted\\""');
});
