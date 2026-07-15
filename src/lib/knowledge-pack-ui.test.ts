import assert from "node:assert/strict";
import { buildSeedRequest, summarizeSeedResult, validateSubfolderInput } from "./knowledge-pack-ui.ts";

assert.deepEqual(validateSubfolderInput(""), { ok: true, segments: [] });
assert.deepEqual(validateSubfolderInput("  world/regions  "), { ok: true, segments: ["world", "regions"] });
assert.deepEqual(validateSubfolderInput("world//regions"), { ok: false, error: "Use single slashes between folder segments." });
assert.deepEqual(validateSubfolderInput("World"), { ok: false, error: "Use lowercase slug segments only: letters, numbers, and hyphens." });
assert.deepEqual(validateSubfolderInput("world/regions/cities/districts"), { ok: false, error: "Use at most 3 folder segments." });
assert.deepEqual(validateSubfolderInput("world/.hidden"), { ok: false, error: "Use lowercase slug segments only: letters, numbers, and hyphens." });

assert.equal(
  summarizeSeedResult({ ok: true, target: "vault", created: ["characters", "settings"], skipped: ["plots"], collections: ["characters", "settings", "plots"] }),
  "2 created, 1 skipped · collections: characters, settings, plots",
);
assert.equal(
  summarizeSeedResult({ ok: true, target: "project", created: [], skipped: ["/project/world/characters"], collections: [] }),
  "0 created, 1 skipped",
);

assert.deepEqual(buildSeedRequest("worldbuilding", "vault"), { packId: "worldbuilding", target: "vault" });
assert.deepEqual(buildSeedRequest("worldbuilding", "project", "/Users/buns/story", "world/regions"), {
  packId: "worldbuilding",
  target: "project",
  projectRoot: "/Users/buns/story",
  subfolder: "world/regions",
});
assert.deepEqual(buildSeedRequest("worldbuilding", "project", "/Users/buns/story", ""), {
  packId: "worldbuilding",
  target: "project",
  projectRoot: "/Users/buns/story",
});
assert.throws(() => buildSeedRequest("Worldbuilding", "vault"), /Pack id must be a lowercase slug/);
assert.throws(() => buildSeedRequest("worldbuilding", "project"), /Project root is required/);
assert.throws(() => buildSeedRequest("worldbuilding", "project", "/Users/buns/story", "World"), /Use lowercase slug segments/);

console.log("knowledge-pack-ui.test.ts: ok");
