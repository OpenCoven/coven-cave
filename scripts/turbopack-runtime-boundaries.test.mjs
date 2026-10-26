import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedBoundaries = new Map([
  ["../src/lib/server/journal-command-intent.ts", [
    ['path.join(/* turbopackIgnore: true */ await realpath(/* turbopackIgnore: true */ directory), ".cave-command-intents")', 1],
    ['path.join(/* turbopackIgnore: true */ root, `${digest(adoptionKey)}.json`)', 1],
    ['path.join(/* turbopackIgnore: true */ root, `.prepare-${randomUUID()}`)', 1],
    ['open(/* turbopackIgnore: true */ file,', 1],
    ['open(/* turbopackIgnore: true */ temporary,', 1],
  ]],
  ["../src/lib/server/research-automation-import.ts", [
    ['path.join(/* turbopackIgnore: true */ caveHome(), "research-automation-import-plans")', 1],
    ['path.join(/* turbopackIgnore: true */ base, ".codex", "automations", id, "automation.toml")', 1],
    ['path.join(/* turbopackIgnore: true */ planRoot, `${plan.planId}.json`)', 1],
    ['path.join(/* turbopackIgnore: true */ planRoot, `${planId}.json`)', 1],
    ['open(/* turbopackIgnore: true */ file,', 1],
    ['realpath(/* turbopackIgnore: true */ home)', 1],
    ['realpath(/* turbopackIgnore: true */ file)', 1],
  ]],
  // A `caveHome()` join matches by partial name: `"state.json"` traced Xcode's
  // `workspace-state.json` and failed the #6082 leak guard; `"config.json"`
  // traced `tsconfig.json` into every entry (#6093).
  ["../src/lib/cave-config.ts", [
    ['path.join(/* turbopackIgnore: true */ caveHome(), "config.json")', 1],
    ['path.join(/* turbopackIgnore: true */ caveHome(), "state.json")', 1],
  ]],
  // Next 16.4 carried these three whole-project globs into the instrumentation
  // trace, failing the #6082 leak guard with 6,226 checkout files (#6264).
  ["../src/lib/server/adapter-manifest-scaffold.ts", [
    ["path.join(/* turbopackIgnore: true */ adaptersDir, scaffold.filename)", 1],
    ["readFile(/* turbopackIgnore: true */ manifestPath, \"utf8\")", 1],
  ]],
  ["../src/lib/chat-runtime-scope.ts", [
    ["path.resolve(/* turbopackIgnore: true */ normalizePath(options.homeDir ?? homedir()))", 1],
    ["realpath(/* turbopackIgnore: true */ homePath)", 1],
  ]],
  ["../src/lib/server/research-resource-store.ts", [
    ["/* turbopackIgnore: true */ options.root ?? path.join(/* turbopackIgnore: true */ caveHome(), \"research-resources\")", 1],
  ]],
  ["../src/lib/mobile-handoff.ts", [
    ["spawn(/* turbopackIgnore: true */ bin, args", 1],
  ]],
  ["../src/lib/server/backup-archive.ts", [
    ["path.join(/* turbopackIgnore: true */ researchRoot, relativeDirectory)", 1],
  ]],
  // Unmarked, the `.worktrees` join made the build scan 56,826 files (#6099).
  ["../src/lib/server/issue-worktree-provision.ts", [
    ['path.join(/* turbopackIgnore: true */ repoRoot, ".worktrees")', 1],
  ]],
  ["../src/lib/server/research-context-pack-store.ts", [
    ["readdir(/* turbopackIgnore: true */ layout.manifestsDir)", 2],
  ]],
  ["../src/lib/server/research-resource-lexical-index.ts", [
    ["existsSync(/* turbopackIgnore: true */ candidate)", 1],
    ["path.resolve(/* turbopackIgnore: true */ options.file ?? lexicalIndexPath())", 2],
    ["existsSync(/* turbopackIgnore: true */ file)", 2],
    ["existsSync(/* turbopackIgnore: true */ `${file}${suffix}`)", 1],
  ]],
  ["../src/lib/server/research-resource-semantic-index.ts", [
    ["existsSync(/* turbopackIgnore: true */ candidate)", 2],
    ["readdirSync(/* turbopackIgnore: true */ directory)", 2],
    ["path.resolve(/* turbopackIgnore: true */ options.file ?? semanticIndexPath())", 2],
    ["existsSync(/* turbopackIgnore: true */ candidate.file)", 1],
    ["existsSync(/* turbopackIgnore: true */ file)", 5],
    ["existsSync(/* turbopackIgnore: true */ sidecar)", 2],
  ]],
  ["../src/lib/server/skill-scan.ts", [
    ["realpath(/* turbopackIgnore: true */ candidate)", 2],
  ]],
]);

test("runtime-owned paths stay outside Turbopack's packaged filesystem trace", async () => {
  for (const [relativePath, boundaries] of expectedBoundaries) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    for (const [boundary, expected] of boundaries) {
      const actual = source.split(boundary).length - 1;
      assert.equal(
        actual,
        expected,
        `${relativePath} must retain the reviewed boundary ${boundary}`,
      );
    }
  }
});
