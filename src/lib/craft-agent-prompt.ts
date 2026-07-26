// Agentic Craft briefs (cave-4n7j, cave-46wg): the prompts a familiar receives
// when the operator describes a Craft ("Describe it"), refines an existing
// local draft, or prepares one for catalog publication. Every brief carries
// the complete local API contract, so any harness session can do the work
// end-to-end without further context. Mirrors the agent entry point
// documented in .agents/skills/craft-builder/SKILL.md.

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
    "4. Verify it resolves: `GET /api/marketplace/crafts/plan?id=<draft.plugin.id>` → the draft plan; confirm `ok: true`. Draft plans include a `draftDiagnostics` array naming components that only exist as local role references — expected until publication; report them, don't fix them.",
    "5. Report back: the draft id, the familiar and roles you bundled, what the extraction ledger contains, and anything the plan flagged.",
    "",
    "Constraints:",
    "- If no roles plausibly cover the goal, do not force a draft — list the closest roles and what's missing instead.",
    "- Never invent role ids; only use ids returned by `GET /api/roles`.",
  ].join("\n");
}

/** The ledger summary a refine/publish brief carries: counts per category so
 *  the familiar knows the bundle's shape without re-deriving it. */
export type CraftDraftBriefInput = {
  /** `draft.plugin.id` — names the draft in the drafts store. */
  draftId: string;
  displayName: string;
  familiar: string;
  /** Role names bundled by the draft. */
  roles: readonly string[];
  /** Ledger sizes: skills/components/workflows/prompts/capabilities. */
  ledgerCounts: Readonly<Record<string, number>>;
  /** Optional operator instruction ("trim to minimal", "add the docs role"…). */
  instruction?: string;
};

function ledgerLine(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`);
  return parts.length > 0 ? parts.join(", ") : "empty ledger";
}

/**
 * Refine an existing local draft agentically (cave-46wg): the drafts store is
 * recreate-and-replace, so refinement = inspect → delete → re-draft → verify.
 * Carries the complete local API contract like `buildCraftAgentPrompt`.
 */
export function buildCraftRefinePrompt(input: CraftDraftBriefInput): string {
  const instruction = input.instruction?.trim();
  return [
    `Refine the local Coven Cave Craft draft "${input.displayName}" (draft id: ${input.draftId}).`,
    `It currently bundles roles [${input.roles.join(", ")}] from familiar "${input.familiar}" — ${ledgerLine(input.ledgerCounts)}.`,
    ...(instruction ? ["", "Operator's refinement goal:", instruction] : ["", "Ask the operator what should change before touching anything."]),
    "",
    "Drafts are recreate-and-replace. Work through the local Cave API (loopback HTTP on this machine, no auth):",
    "1. Inspect the draft: `GET /api/marketplace/crafts/drafts` → find the draft by id and read its extraction ledger.",
    "2. Inspect the roles: `GET /api/roles` → choose the adjusted minimal role set (same familiar unless the operator says otherwise).",
    "3. Replace it: `DELETE /api/marketplace/crafts/drafts?id=" + input.draftId + "`, then `POST /api/marketplace/crafts/drafts` with JSON `{ \"familiar\": \"<id>\", \"roleIds\": [\"...\"] }` → `{ ok, draft }`.",
    "4. Verify: `GET /api/marketplace/crafts/plan?id=<draft.plugin.id>` → confirm `ok: true`; report anything in `draftDiagnostics` (unpublished local references are expected).",
    "5. Report back: old vs new role set, what changed in the ledger, and anything the plan flagged.",
    "",
    "Constraints:",
    "- Confirm with the operator before the delete — it is not undoable.",
    "- Never invent role or draft ids; only use ids the API returned.",
  ].join("\n");
}

/**
 * Prepare a reviewed catalog publication for a local draft (cave-46wg): the
 * brief walks the human-reviewed path from docs/marketplace.md — vendored
 * sources, hashes, provenance, sync — and explicitly ends at a PR. No assist
 * writes `marketplace/catalog.json` directly; humans merge.
 */
export function buildCraftPublishPrompt(input: CraftDraftBriefInput): string {
  return [
    `Prepare the local Coven Cave Craft draft "${input.displayName}" (draft id: ${input.draftId}) for catalog publication.`,
    `It bundles roles [${input.roles.join(", ")}] from familiar "${input.familiar}" — ${ledgerLine(input.ledgerCounts)}.`,
    "",
    "Craft publication is a HUMAN-REVIEWED PR (docs/marketplace.md § Human-Reviewed Upstream Updates) — your job is to produce the PR, never to write the catalog directly:",
    "1. Read the draft: `GET /api/marketplace/crafts/drafts` → its bundled resources and provenance stubs.",
    "2. Vendor real source content under `marketplace/craft-sources/<craft>/` — draft resources are references, not publishable content; resolve each to its actual file and record `sourcePath` + `contentHash` (`sha256:`) pins.",
    "3. Add a `kind: \"craft\"` entry to `marketplace/catalog.json` with the craft specification (`schemaVersion: \"opencoven.craft.v1\"`), components, bundled resources, `requiredCapabilities`, `recommendedRoles`, and a complete `provenance` block (source, commit, license, licensePath, modifications).",
    "4. Regenerate + check: `python3 scripts/sync-marketplace.py` then `python3 scripts/sync-marketplace.py --check`, and run `node --test scripts/crafts-audited-content.test.mjs`.",
    "5. Open a pull request with the change for human review, and summarize: catalog entry, vendored files, hashes, and check results.",
    "",
    "Constraints:",
    "- Never commit directly to main or bypass the PR path.",
    "- If a bundled resource has no resolvable source content, stop and report it instead of inventing content.",
  ].join("\n");
}
