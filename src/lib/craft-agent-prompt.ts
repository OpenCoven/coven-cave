// Agentic Craft building (cave-4n7j): the prompt a familiar receives when the
// operator describes a Craft instead of hand-picking roles. The prompt carries
// the complete local API contract, so any harness session can build and
// verify the draft end-to-end without further context. Mirrors the agent
// entry point documented in .agents/skills/craft-builder/SKILL.md.

export type CraftAgentPromptInput = {
  /** The operator's natural-language goal for the Craft. */
  description: string;
  /** Optional familiar the operator already has in mind. */
  familiar?: string;
};

export function buildCraftAgentPrompt({ description, familiar }: CraftAgentPromptInput): string {
  const goal = description.trim();
  const preferred = familiar?.trim();
  return [
    "Build a Coven Cave Craft — a versioned, installable bundle of skills, prompts, workflows, and runtime capabilities extracted from a familiar's Roles.",
    "",
    "Operator's goal for this Craft:",
    goal,
    ...(preferred ? ["", `Preferred familiar: ${preferred}`] : []),
    "",
    "Build it through the local Cave API (loopback HTTP on this machine, no auth):",
    "1. Inspect the available roles: `GET /api/roles` → `roles[]` with `{ id, name, description, familiar, skills, tools, mcpServers, plugins, workflows, effective }`.",
    "2. Choose one familiar and the smallest set of its role ids that covers the goal.",
    "3. Create the draft: `POST /api/marketplace/crafts/drafts` with JSON `{ \"familiar\": \"<id>\", \"roleIds\": [\"...\"] }` → `{ ok, draft }`; `draft.plugin.id` names the new Craft.",
    "4. Verify it resolves: `GET /api/marketplace/crafts/plan?id=<draft.plugin.id>` → the install plan; confirm `ok: true` and no diagnostic errors.",
    "5. Report back: the draft id, the familiar and roles you bundled, what the extraction ledger contains, and anything the plan flagged.",
    "",
    "Constraints:",
    "- If no roles plausibly cover the goal, do not force a draft — list the closest roles and what's missing instead.",
    "- Never invent role ids; only use ids returned by `GET /api/roles`.",
  ].join("\n");
}
