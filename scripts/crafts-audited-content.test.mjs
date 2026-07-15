import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync("marketplace/catalog.json", "utf8"));
const crafts = catalog.plugins.filter((plugin) => plugin.kind === "craft");
const expected = new Map([
  ["seekers-lens", 2],
  ["archivists-index", 4],
  ["alchemists-crucible", 4],
  ["oracles-measure", 3],
  ["scribes-quill", 4],
  ["grand-research-ritual", 1],
  ["artificers-codex", 7],
]);

assert.deepEqual(new Set(crafts.map((craft) => craft.name)), new Set(expected.keys()));
for (const craft of crafts) {
  assert.equal(craft.craft.bundled.skills.length, expected.get(craft.name));
  assert.equal(craft.craft.provenance.commit, "773a52944ba4747a18bd4ae9ade53fff041adcbc");
  assert.equal(craft.craft.provenance.license, "MIT");
  for (const skill of craft.craft.bundled.skills) {
    assert.match(skill.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(`marketplace/${skill.sourcePath}`), skill.sourcePath);
  }
  assert.ok(fs.existsSync(`marketplace/plugins/${craft.name}/.codex-plugin/plugin.json`));
}
assert.ok(fs.existsSync("marketplace/plugins/grand-research-ritual/skills/0-autoresearch-skill/references/agent-continuity.md"));
assert.ok(fs.existsSync("marketplace/plugins/scribes-quill/skills/ml-paper-writing/templates/README.md"));
assert.ok(fs.existsSync("marketplace/plugins/oracles-measure/skills/lm-evaluation-harness/references/custom-tasks.md"));

const ritual = fs.readFileSync(
  "marketplace/craft-sources/grand-research-ritual/0-autoresearch-skill/SKILL.md",
  "utf8",
);
assert.match(ritual, /time, compute, data, and spend limits/i);
assert.match(ritual, /does not create commits, alter remotes, push branches/i);
assert.match(ritual, /checkpoint/i);
assert.match(ritual, /unrelated repositories/i);
console.log("crafts-audited-content.test.mjs: ok");
