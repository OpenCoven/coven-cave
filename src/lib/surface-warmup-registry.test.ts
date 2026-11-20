import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const here = new URL(".", import.meta.url);

async function source(name: string): Promise<string> {
  return readFile(new URL(name, here), "utf8");
}

test("surface caches remain demand-loaded and join stale revalidation", async () => {
  const registry = await source("surface-warmup-registry.ts");
  assert.doesNotMatch(registry, /preloadSidebarSurface|warmSurface|surfaceWarmupResources/);
  assert.match(registry, /if \(!result\.cache\.stale\) return result;/);
  assert.match(registry, /return read<T>\(key, \{ force: true \}\);/);
  assert.match(registry, /response\.status === 429/);
  assert.match(registry, /defineResource\("github:familiars"/);
});

test("roster membership changes publish the workspace familiar-refresh event", async () => {
  for (const sourcePath of [
    "../components/familiar-summoning-circle.tsx",
    "../components/familiar-lifecycle-section.tsx",
  ]) {
    const code = await readFile(new URL(sourcePath, here), "utf8");
    assert.match(code, /window\.dispatchEvent\(new Event\("cave:familiars-refresh"\)\)/, `${sourcePath} invalidates warmed familiar consumers`);
  }
});

test("external board writers invalidate a warmed board landing before navigation", async () => {
  const writers = [
    "../components/chat-view.tsx",
    "../components/task-link-picker.tsx",
    "../components/thread-signals-section.tsx",
    "../lib/chat-task-handoff.ts",
    "../lib/chat-task-autofill.ts",
    "../lib/github-tasks.ts",
    "../lib/asana-tasks.ts",
  ];
  for (const writer of writers) {
    const code = await readFile(new URL(writer, here), "utf8");
    assert.match(code, /publishBoardChanged\(\)/, `${writer} publishes its successful board write`);
  }
});

test("Journal strips chat controls without becoming a board writer", async () => {
  const journal = await readFile(new URL("../components/journal/journal-entries.tsx", here), "utf8");
  assert.match(journal, /const \{ visible \} = useMemo\(\(\) => extractNextPaths\(text\), \[text\]\);/);
  assert.doesNotMatch(journal, /publishBoardChanged\(\)/, "journal reflection rendering never invalidates board data");
});

test("publishing from the Scribe surface invalidates a warmed Grimoire landing", async () => {
  const scribe = await readFile(new URL("../components/role-surfaces/scribe-surface.tsx", here), "utf8");
  assert.match(
    scribe,
    /if \(!json\?\.ok \|\| !json\.entry\?\.id\) \{[\s\S]{0,500}invalidateIfDefined\("grimoire:knowledge", "grimoire:collections"\);/,
  );
});

test("vault knowledge-pack seeds invalidate a warmed Grimoire landing", async () => {
  const modal = await readFile(new URL("../components/marketplace/knowledge-pack-seed-modal.tsx", here), "utf8");
  assert.match(
    modal,
    /seed = await postJson<KnowledgePackSeedResult>\("\/api\/knowledge\/packs\/seed", request\);[\s\S]{0,700}if \(target === "vault"\) invalidateIfDefined\("grimoire:knowledge", "grimoire:collections"\);/,
  );
});

test("external journal and memory writers invalidate warmed Grimoire resources", async () => {
  const journal = await readFile(new URL("../components/journal/journal-entries.tsx", here), "utf8");
  assert.equal(
    [...journal.matchAll(/invalidateIfDefined\("grimoire:journal"\)/g)].length,
    3,
    "generate, save, and delete all invalidate the warmed journal list",
  );

  const memoryEditor = await readFile(new URL("../components/md-editor/memory-md-editor.tsx", here), "utf8");
  assert.match(
    memoryEditor,
    /setDiskChanged\(false\);[\s\S]{0,260}invalidateIfDefined\("memory:list"\)/,
    "memory saves invalidate Grimoire's file list",
  );

  const memoryList = await readFile(new URL("../components/familiars-memory-view.tsx", here), "utf8");
  assert.match(
    memoryList,
    /const response = await fetch\("\/api\/memory\/delete"[\s\S]{0,400}if \(response\.ok\) invalidateIfDefined\([^)]*"memory:list"\)/,
    "memory deletes still invalidate the existing warmed file-memory landing",
  );
});
