import assert from "node:assert/strict";
import { buildCraftDraftFromRoles } from "./craft-draft.ts";

const roleInputs = [
  {
    id: "implementer",
    name: "Implementation",
    description: "Ships focused patches.",
    familiar: "cody",
    skills: ["test-driven-development", "using-git-worktrees"],
    tools: ["read_files", "write_files", "shell"],
    mcpServers: ["github"],
    plugins: ["filesystem"],
    workflows: ["review-fix-verify"],
    effective: {
      skills: [
        { id: "test-driven-development", origin: "direct", originLabel: "Direct" },
        { id: "receiving-code-review", origin: "craft", originLabel: "via Reviewer's Lens", craftId: "reviewers-lens" },
      ],
      tools: [
        { id: "read_files", origin: "direct", originLabel: "Direct" },
        { id: "write_files", origin: "direct", originLabel: "Direct" },
        { id: "shell", origin: "direct", originLabel: "Direct" },
      ],
      mcpServers: [{ id: "github", origin: "direct", originLabel: "Direct" }],
      plugins: [{ id: "filesystem", origin: "direct", originLabel: "Direct" }],
      workflows: [{ id: "review-fix-verify", origin: "direct", originLabel: "Direct" }],
      prompts: [{ id: "review-install-plan", origin: "craft", originLabel: "via Reviewer's Lens", craftId: "reviewers-lens" }],
      capabilities: [
        { id: "code_review", origin: "craft", originLabel: "via Reviewer's Lens", craftId: "reviewers-lens" },
        { id: "write_files", origin: "direct", originLabel: "Direct" },
      ],
    },
  },
  {
    id: "reviewer",
    name: "Review",
    familiar: "cody",
    skills: ["receiving-code-review"],
    tools: ["read_files"],
    mcpServers: [],
    plugins: ["github"],
    workflows: [],
    effective: {
      skills: [{ id: "receiving-code-review", origin: "direct", originLabel: "Direct" }],
      tools: [{ id: "read_files", origin: "direct", originLabel: "Direct" }],
      mcpServers: [],
      plugins: [{ id: "github", origin: "direct", originLabel: "Direct" }],
      workflows: [],
      prompts: [],
      capabilities: [{ id: "code_review", origin: "direct", originLabel: "Direct" }],
    },
  },
] satisfies Parameters<typeof buildCraftDraftFromRoles>[0]["roles"];

const draft = buildCraftDraftFromRoles({
  familiar: "cody",
  roles: roleInputs,
  now: "2026-07-12T09:00:00.000Z",
});

const reversedDraft = buildCraftDraftFromRoles({
  familiar: "cody",
  roles: [...roleInputs].reverse(),
  now: "2026-07-12T09:00:00.000Z",
});

// Rename (docs/craft-ux.md F12): an operator-chosen displayName replaces the
// derived name but never moves the draft's identity (id stays derived).
const renamedDraft = buildCraftDraftFromRoles({
  familiar: "cody",
  roles: roleInputs,
  now: "2026-07-12T09:00:00.000Z",
  displayName: "  Review Loadout  ",
});
assert.equal(renamedDraft.plugin.displayName, "Review Loadout");
assert.equal(renamedDraft.id, "cody-implementation-review");
assert.equal(renamedDraft.plugin.draftId, "cody-implementation-review");
const blankNameDraft = buildCraftDraftFromRoles({
  familiar: "cody",
  roles: roleInputs,
  now: "2026-07-12T09:00:00.000Z",
  displayName: "   ",
});
assert.equal(blankNameDraft.plugin.displayName, "Cody Implementation + Review");

assert.equal(draft.id, "cody-implementation-review");
assert.equal(draft.plugin.kind, "craft");
assert.equal(draft.plugin.draft, true);
assert.equal(draft.plugin.displayName, "Cody Implementation + Review");
assert.deepEqual(draft.plugin.roleAffinity, [{ familiar: "cody", roles: ["Implementation", "Review"] }]);
assert.deepEqual(draft.plugin.craft?.components.required, ["github", "filesystem"]);
assert.deepEqual(draft.plugin.craft?.requiredCapabilities, ["read_files", "write_files", "shell", "code_review"]);
assert.deepEqual(
  draft.plugin.craft?.bundled.skills.map((skill) => skill.id),
  ["test-driven-development", "receiving-code-review", "using-git-worktrees"],
);
assert.deepEqual(
  draft.plugin.craft?.bundled.prompts.map((prompt) => prompt.id),
  ["review-install-plan"],
);
assert.deepEqual(
  draft.plugin.craft?.bundled.workflows.map((workflow) => workflow.id),
  ["review-fix-verify"],
);
assert.equal(draft.plugin.craft?.provenance.source, "local-familiar:cody");
assert.equal(draft.plugin.craft?.provenance.commit, "local-draft");
assert.equal(draft.extraction.generatedAt, "2026-07-12T09:00:00.000Z");
assert.deepEqual(draft.extraction.roles.map((role) => role.id), ["implementer", "reviewer"]);
assert.equal(reversedDraft.id, draft.id);
assert.equal(reversedDraft.plugin.displayName, draft.plugin.displayName);
assert.deepEqual(reversedDraft.extraction.roles.map((role) => role.id), ["implementer", "reviewer"]);
assert.equal(draft.extraction.ledger.skills.length, 3);
assert.equal(draft.extraction.ledger.capabilities.length, 4);

assert.throws(
  () => buildCraftDraftFromRoles({ familiar: "cody", roles: [], now: "2026-07-12T09:00:00.000Z" }),
  /select at least one role/,
);

console.log("craft-draft.test.ts: ok");
