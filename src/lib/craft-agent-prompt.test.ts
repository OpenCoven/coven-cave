// @ts-nocheck
import assert from "node:assert/strict";
import { buildCraftAgentPrompt, buildCraftPublishPrompt, buildCraftRefinePrompt } from "./craft-agent-prompt.ts";

// The prompt must hand a familiar the COMPLETE agentic contract: goal, role
// discovery, draft creation, plan verification, and reporting — so a harness
// session can build a Craft with no additional context.
{
  const prompt = buildCraftAgentPrompt({ description: "  Bundle my research reviewer workflow.  " });
  assert.match(prompt, /Coven Cave Craft/, "names the artifact being built");
  assert.match(prompt, /Bundle my research reviewer workflow\./, "carries the trimmed operator goal");
  assert.match(prompt, /GET \/api\/roles/, "documents role discovery");
  assert.match(prompt, /POST \/api\/marketplace\/crafts\/drafts/, "documents draft creation");
  assert.match(prompt, /"familiar": "<id>", "roleIds": \["\.\.\."\]/, "documents the exact draft body shape");
  assert.match(prompt, /GET \/api\/marketplace\/crafts\/plan\?id=<draft\.plugin\.id>/, "documents plan verification");
  assert.match(prompt, /smallest set of its role ids/, "steers toward a minimal bundle");
  assert.match(prompt, /do not force a draft/, "tells the agent to decline when nothing fits");
  assert.match(prompt, /Never invent role ids/, "forbids fabricated role ids");
  assert.doesNotMatch(prompt, /Preferred familiar/, "no familiar line unless one was provided");
}

// A preferred familiar rides along when the operator names one.
{
  const prompt = buildCraftAgentPrompt({ description: "Ship reviews", familiar: "cody" });
  assert.match(prompt, /Preferred familiar: cody/, "carries the preferred familiar");
}

// ── Refine brief (cave-46wg) ─────────────────────────────────────────────────
// Drafts are recreate-and-replace, so refinement must carry the delete step,
// the exact draft identity, and the same never-invent constraints.
{
  const prompt = buildCraftRefinePrompt({
    draftId: "sage-researcher",
    displayName: "Sage Researcher",
    familiar: "sage",
    roles: ["Researcher"],
    ledgerCounts: { skills: 2, components: 1, workflows: 0 },
  });
  assert.match(prompt, /Refine the local Coven Cave Craft draft "Sage Researcher"/, "names the draft");
  assert.match(prompt, /draft id: sage-researcher/, "carries the draft id");
  assert.match(prompt, /2 skills, 1 components/, "summarizes the ledger shape");
  assert.doesNotMatch(prompt, /0 workflows/, "empty ledger categories stay quiet");
  assert.match(prompt, /GET \/api\/marketplace\/crafts\/drafts/, "documents draft inspection");
  assert.match(prompt, /DELETE \/api\/marketplace\/crafts\/drafts\?id=sage-researcher/, "documents the replace step");
  assert.match(prompt, /GET \/api\/marketplace\/crafts\/plan\?id=/, "documents plan verification");
  assert.match(prompt, /Confirm with the operator before the delete/, "the delete needs consent");
  assert.match(prompt, /Never invent role or draft ids/, "forbids fabricated ids");
  assert.match(prompt, /Ask the operator what should change/, "asks before acting when no instruction is given");
}
{
  const prompt = buildCraftRefinePrompt({
    draftId: "d",
    displayName: "D",
    familiar: "f",
    roles: [],
    ledgerCounts: {},
    instruction: "  Trim to the minimal review set.  ",
  });
  assert.match(prompt, /Trim to the minimal review set\./, "carries the trimmed operator instruction");
  assert.match(prompt, /empty ledger/, "an empty ledger is stated, not invented");
}

// ── Publish brief (cave-46wg) ────────────────────────────────────────────────
// Publication is a human-reviewed PR — the brief must walk the vendored
// path and forbid direct catalog writes.
{
  const prompt = buildCraftPublishPrompt({
    draftId: "sage-researcher",
    displayName: "Sage Researcher",
    familiar: "sage",
    roles: ["Researcher"],
    ledgerCounts: { skills: 2 },
  });
  assert.match(prompt, /catalog publication/, "names the goal");
  assert.match(prompt, /HUMAN-REVIEWED PR/, "publication stays human-reviewed");
  assert.match(prompt, /marketplace\/craft-sources\/<craft>\//, "documents source vendoring");
  assert.match(prompt, /contentHash/, "requires hash pins");
  assert.match(prompt, /sync-marketplace\.py --check/, "requires the sync check");
  assert.match(prompt, /crafts-audited-content\.test\.mjs/, "requires the audited-content test");
  assert.match(prompt, /Open a pull request/, "ends at a PR");
  assert.match(prompt, /Never commit directly to main/, "forbids bypassing review");
  assert.match(prompt, /stop and report it instead of inventing content/, "forbids invented content");
}

console.log("craft-agent-prompt: ok");
