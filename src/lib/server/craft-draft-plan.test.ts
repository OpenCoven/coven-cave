import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCraftDraftFromRoles } from "../craft-draft.ts";
import { resolveCatalogComponents } from "./craft-catalog.ts";
import { buildDraftDiagnostics, planCraftDraft, planFromDraft } from "./craft-draft-plan.ts";
import { saveCraftDraft } from "./craft-drafts.ts";

// ── Component resolution against the real catalog ────────────────────────────
// "fetch" ships in marketplace/catalog.json; extracted local-role references
// don't. The resolver reports both honestly instead of throwing.
{
  const { resolved, unresolved } = await resolveCatalogComponents([
    "fetch",
    "definitely-not-a-catalog-plugin",
  ]);
  assert.deepEqual(resolved.map((component) => component.id), ["fetch"]);
  assert.deepEqual(unresolved, ["definitely-not-a-catalog-plugin"]);
}

// Crafts never resolve as components of other crafts.
{
  const { resolved, unresolved } = await resolveCatalogComponents(["seekers-lens"]);
  assert.deepEqual(resolved, []);
  assert.deepEqual(unresolved, ["seekers-lens"]);
}

// ── Draft plan synthesis ─────────────────────────────────────────────────────
const draft = buildCraftDraftFromRoles({
  familiar: "cody",
  now: "2026-07-15T09:00:00.000Z",
  roles: [{
    id: "reviewer",
    name: "Reviewer",
    familiar: "cody",
    skills: ["receiving-code-review"],
    tools: ["code_review"],
    mcpServers: ["fetch"],
    plugins: ["local-only-plugin"],
    workflows: [],
    effective: {
      skills: [], tools: [], mcpServers: [], plugins: [], workflows: [], prompts: [], capabilities: [],
    },
  }],
});

{
  const components = await resolveCatalogComponents(draft.plugin.craft?.components.required ?? []);
  const result = planFromDraft(draft, components);
  assert.equal(result.plan.draft, true);
  assert.equal(result.plan.id, "cody-reviewer");
  assert.deepEqual(result.plan.components.resolved.map((component) => component.id), ["fetch"]);
  assert.deepEqual(result.plan.components.unresolved, ["local-only-plugin"]);
  assert.deepEqual(result.plan.bundled.skills, ["receiving-code-review"]);
  assert.deepEqual(result.plan.requiredCapabilities, ["code_review"]);
  assert.deepEqual(result.plan.recommendedRoles, ["Reviewer"]);
  assert.equal(result.draftDiagnostics.length, 1);
  assert.match(result.draftDiagnostics[0], /"local-only-plugin"/);
  assert.match(result.draftDiagnostics[0], /can't be verified until the Craft is published/);
}

assert.deepEqual(buildDraftDiagnostics([]), []);

// ── Store-backed lookup ──────────────────────────────────────────────────────
const covenHome = await mkdtemp(path.join(tmpdir(), "craft-draft-plan-"));
try {
  await saveCraftDraft(draft, { covenHome });
  const found = await planCraftDraft("cody-reviewer", { covenHome });
  assert.ok(found, "a stored draft plans");
  assert.equal(found.plan.displayName, "Cody Reviewer");
  assert.deepEqual(found.plan.components.unresolved, ["local-only-plugin"]);
  assert.equal(await planCraftDraft("no-such-draft", { covenHome }), null);
} finally {
  await rm(covenHome, { recursive: true, force: true });
}

console.log("craft-draft-plan.test.ts: ok");
