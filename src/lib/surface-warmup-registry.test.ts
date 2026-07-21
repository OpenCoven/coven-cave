import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const here = new URL(".", import.meta.url);

async function source(name: string): Promise<string> {
  return readFile(new URL(name, here), "utf8");
}

test("warmup registry covers canonical sidebar landings with bounded serial resources", async () => {
  const registry = await source("surface-warmup-registry.ts");
  for (const surface of ["github", "marketplace", "board", "schedules", "grimoire", "agents"]) {
    assert.match(registry, new RegExp(`${surface}: \\[`, "m"), `${surface} has a registry entry`);
  }
  assert.match(registry, /for \(const resource of surfaceWarmupResources\[surface\]\)/);
  assert.match(registry, /await warm<\{ rateLimit/);
  assert.match(registry, /for \(const resource of surfaceWarmupResources\[surface\]\)[\s\S]{0,900}catch(?: \(error\))? \{[\s\S]{0,360}must not leave the rest of this surface cold/);
  assert.match(registry, /GITHUB_WARMUP_REMAINING_FLOOR/);
  assert.match(registry, /response\.status === 429/);
  assert.match(registry, /response\.headers\.has\("retry-after"\)/);
  assert.match(registry, /error instanceof SurfaceWarmupBackpressureError[\s\S]{0,100}backpressured: true/);
  assert.match(registry, /preloadSidebarSurface\(surface\)/);
  assert.match(registry, /await preloadSidebarSurface\(surface\);[\s\S]{0,180}if \(!canContinue\(\)\) return/);
  assert.match(registry, /if \(!result\.cache\.stale\) return result;[\s\S]{0,600}await read<T>\(key, \{ force: true \}\)/, "surface reads join a stale revalidation before returning landing data");
});

test("sidebar preloads call the dynamic import loaders rather than an unavailable dynamic preload hook", async () => {
  const surfaces = await readFile(new URL("../components/lazy-surfaces.tsx", import.meta.url), "utf8");
  assert.match(surfaces, /const loadGitHubView = \(\) => import\("@\/components\/github-view"\)/);
  assert.match(surfaces, /return loadGitHubView\(\)\.then\(\(\) => undefined\)/);
  assert.doesNotMatch(surfaces, /function preloadSurface/);
});

test("warmup starts after paint and pauses work without mounting inactive surfaces", async () => {
  const hook = await source("use-surface-warmup.ts");
  assert.match(hook, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(begin\)\)/);
  assert.match(hook, /document\.hidden/);
  assert.match(hook, /window\.addEventListener\("offline", pause\)/);
  assert.match(hook, /abortWarm\(\)/);
  assert.match(hook, /invalidateIfDefined\("board:cards", "tasks:queue"\)/, "external board writes invalidate warmed landing data while BoardView is unmounted");
  assert.match(hook, /addEventListener\("cave:board:reload", onBoardReload\)/);
  assert.match(hook, /invalidateIfDefined\("schedules:inbox", "schedules:automations"\)/, "inbox SSE writes invalidate the warmed Schedules landing data");
  assert.match(hook, /addEventListener\("cave:schedules:reload", onSchedulesReload\)/);
  assert.match(hook, /surface-warmup:backpressure/);
  assert.match(hook, /warmSurface\(surface, runnable\)/);
  assert.match(hook, /if \(active \|\| !runnable\(\) \|\| cursor >= ORDER\.length\) return;/, "duplicate resume callbacks do not run surfaces concurrently");
});

test("external board writers invalidate a warmed board landing before navigation", async () => {
  const writers = [
    "../components/chat-view.tsx",
    "../components/task-link-picker.tsx",
    "../components/thread-signals-section.tsx",
    "../components/journal/journal-entries.tsx",
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

test("publishing from the Scribe surface invalidates a warmed Grimoire landing", async () => {
  const scribe = await readFile(new URL("../components/role-surfaces/scribe-surface.tsx", here), "utf8");
  assert.match(
    scribe,
    /if \(!json\?\.ok \|\| !json\.entry\?\.id\) \{[\s\S]{0,500}invalidateIfDefined\("grimoire:knowledge", "grimoire:collections"\);/,
  );
});
