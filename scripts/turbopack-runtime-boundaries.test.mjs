import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedBoundaries = new Map([
  ["../src/lib/mobile-handoff.ts", [
    ["spawn(/* turbopackIgnore: true */ bin, args", 1],
  ]],
  ["../src/lib/server/backup-archive.ts", [
    ["path.join(/* turbopackIgnore: true */ researchRoot, relativeDirectory)", 1],
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
    ["readdirSync(/* turbopackIgnore: true */ directory)", 1],
    ["path.resolve(/* turbopackIgnore: true */ options.file ?? semanticIndexPath())", 2],
    ["existsSync(/* turbopackIgnore: true */ candidate.file)", 1],
    ["existsSync(/* turbopackIgnore: true */ file)", 5],
    ["existsSync(/* turbopackIgnore: true */ `${file}${suffix}`)", 1],
  ]],
  ["../src/lib/server/research-topic-discovery-store.ts", [
    ["readdir(/* turbopackIgnore: true */ layout.jobsDir)", 2],
    ["readdir(/* turbopackIgnore: true */ layout.proposalsDir)", 1],
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
