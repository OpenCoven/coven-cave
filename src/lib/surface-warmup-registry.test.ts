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
  assert.match(registry, /GITHUB_WARMUP_REMAINING_FLOOR/);
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
  assert.match(hook, /surface-warmup:backpressure/);
  assert.match(hook, /warmSurface\(surface, runnable\)/);
  assert.match(hook, /if \(active \|\| !runnable\(\) \|\| cursor >= ORDER\.length\) return;/, "duplicate resume callbacks do not run surfaces concurrently");
});
