// Draft-aware install planning (docs/craft-ux.md F1, CP4). Local drafts never
// resolve through the catalog planner — definitionFor reads catalog.json only
// — yet every agent brief instructs plan verification for freshly built
// drafts. This module gives drafts an honest plan: components resolve against
// the published catalog where possible, and everything extracted from local
// role metadata reports as a named diagnostic instead of `unknown_craft`.

import type { CraftDraft } from "../craft-draft.ts";
import { resolveCatalogComponents } from "./craft-catalog.ts";
import type { CraftComponentDefinition } from "./craft-install.ts";
import { readCraftDrafts, type CraftDraftStoreOptions } from "./craft-drafts.ts";

export type CraftDraftPlan = {
  id: string;
  displayName: string;
  draft: true;
  components: {
    resolved: CraftComponentDefinition[];
    unresolved: string[];
  };
  bundled: { skills: string[]; prompts: string[]; workflows: string[] };
  requiredCapabilities: string[];
  recommendedRoles: string[];
};

export type CraftDraftPlanResult = {
  plan: CraftDraftPlan;
  /** Human-readable, per-item notes: what can't verify until publication. */
  draftDiagnostics: string[];
};

export function buildDraftDiagnostics(unresolved: readonly string[]): string[] {
  return unresolved.map((id) => (
    `Component "${id}" is not in the published catalog — it was extracted from local role metadata and can't be verified until the Craft is published.`
  ));
}

export function planFromDraft(
  draft: CraftDraft,
  components: { resolved: CraftComponentDefinition[]; unresolved: string[] },
): CraftDraftPlanResult {
  const craft = draft.plugin.craft;
  return {
    plan: {
      id: draft.id,
      displayName: draft.plugin.displayName,
      draft: true,
      components,
      bundled: {
        skills: (craft?.bundled.skills ?? []).map((item) => item.id),
        prompts: (craft?.bundled.prompts ?? []).map((item) => item.id),
        workflows: (craft?.bundled.workflows ?? []).map((item) => item.id),
      },
      requiredCapabilities: craft?.requiredCapabilities ?? [],
      recommendedRoles: craft?.recommendedRoles ?? [],
    },
    draftDiagnostics: buildDraftDiagnostics(components.unresolved),
  };
}

/** Plan a local draft by id, or null when no such draft exists. */
export async function planCraftDraft(
  id: string,
  opts: CraftDraftStoreOptions & { marketplaceDir?: string } = {},
): Promise<CraftDraftPlanResult | null> {
  const draft = (await readCraftDrafts(opts)).find((entry) => entry.id === id);
  if (!draft) return null;
  const required = draft.plugin.craft?.components.required ?? [];
  const components = await resolveCatalogComponents(required, opts.marketplaceDir);
  return planFromDraft(draft, components);
}
