import assert from "node:assert/strict";
import {
  composeRoleEffective,
  type EquippedCraftComposition,
  type RoleDirectComposition,
} from "./role-craft-composition.ts";

const direct = {
  skills: ["shared-skill", "direct-skill"],
  tools: ["shell"],
  mcpServers: ["filesystem"],
  plugins: ["direct-plugin"],
  workflows: ["shared-workflow"],
} satisfies RoleDirectComposition;

const seekersLens = {
  id: "seekers-lens",
  displayName: "Seeker's Lens",
  components: {
    filesystem: { kind: "mcp" },
    fetch: { kind: "mcp" },
    exa: { kind: "mcp" },
  },
  craft: {
    components: {
      required: ["filesystem", "fetch"],
      optional: ["exa"],
    },
    bundled: {
      skills: ["shared-skill", "brainstorming-research-ideas"],
      prompts: ["open-a-research-space"],
      workflows: ["shared-workflow", "diverge-converge-refine"],
    },
    requiredCapabilities: ["network.http", "filesystem.read"],
  },
} satisfies EquippedCraftComposition;

const effective = composeRoleEffective(direct, [seekersLens]);

assert.deepEqual(effective.skills, [
  { id: "shared-skill", origin: "direct", originLabel: "Direct" },
  { id: "direct-skill", origin: "direct", originLabel: "Direct" },
  {
    id: "brainstorming-research-ideas",
    origin: "craft",
    originLabel: "via Seeker's Lens",
    craftId: "seekers-lens",
  },
]);
assert.deepEqual(effective.tools, [
  { id: "shell", origin: "direct", originLabel: "Direct" },
]);
assert.deepEqual(effective.mcpServers, [
  { id: "filesystem", origin: "direct", originLabel: "Direct" },
  { id: "fetch", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
]);
assert.deepEqual(effective.plugins, [
  { id: "direct-plugin", origin: "direct", originLabel: "Direct" },
  { id: "seekers-lens", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
  { id: "filesystem", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
  { id: "fetch", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
]);
assert.deepEqual(effective.workflows, [
  { id: "shared-workflow", origin: "direct", originLabel: "Direct" },
  { id: "diverge-converge-refine", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
]);
assert.deepEqual(effective.prompts, [
  { id: "open-a-research-space", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
]);
assert.deepEqual(effective.capabilities, [
  { id: "network.http", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
  { id: "filesystem.read", origin: "craft", originLabel: "via Seeker's Lens", craftId: "seekers-lens" },
]);
assert.equal(
  effective.plugins.some((entry) => entry.id === "exa"),
  false,
  "optional enhancements are recommendations, not inherited capabilities",
);

const duplicateCraft = {
  ...seekersLens,
  id: "second-craft",
  displayName: "Second Craft",
  craft: {
    ...seekersLens.craft,
    bundled: {
      skills: ["brainstorming-research-ideas"],
      prompts: ["open-a-research-space"],
      workflows: ["diverge-converge-refine"],
    },
    requiredCapabilities: ["network.http"],
  },
} satisfies EquippedCraftComposition;

const duplicatedEffective = composeRoleEffective(direct, [seekersLens, duplicateCraft]);
for (const [field, id] of [
  ["skills", "brainstorming-research-ideas"],
  ["prompts", "open-a-research-space"],
  ["workflows", "diverge-converge-refine"],
  ["capabilities", "network.http"],
] as const) {
  const matches = duplicatedEffective[field].filter((entry) => entry.id === id);
  assert.equal(matches.length, 1, `${field}:${id} is deduplicated across Crafts`);
  assert.equal(matches[0]?.craftId, "seekers-lens", "first contributing Craft keeps the origin label");
}
assert.equal(
  duplicatedEffective.plugins.some((entry) => entry.id === "second-craft"),
  true,
  "each equipped Craft remains visible as its own plugin",
);
assert.deepEqual(
  composeRoleEffective(direct, []),
  {
    skills: direct.skills.map((id) => ({ id, origin: "direct", originLabel: "Direct" })),
    tools: direct.tools.map((id) => ({ id, origin: "direct", originLabel: "Direct" })),
    mcpServers: direct.mcpServers.map((id) => ({ id, origin: "direct", originLabel: "Direct" })),
    plugins: direct.plugins.map((id) => ({ id, origin: "direct", originLabel: "Direct" })),
    workflows: direct.workflows.map((id) => ({ id, origin: "direct", originLabel: "Direct" })),
    prompts: [],
    capabilities: [],
  },
  "legacy ROLE.md files without crafts retain their direct capability arrays",
);

console.log("role-craft-composition.test.ts: ok");
