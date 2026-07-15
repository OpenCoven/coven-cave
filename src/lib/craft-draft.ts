import type {
  CraftPromptResource,
  CraftSourcedResource,
  CraftSpecification,
  CraftWorkflowResource,
  MarketplacePlugin,
  RoleAffinity,
} from "./marketplace-catalog.ts";
import type {
  RoleEffectiveComposition,
  RoleEffectiveEntry,
} from "./role-craft-composition.ts";

export type CraftDraftRoleInput = {
  id: string;
  name: string;
  description?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  mcpServers: string[];
  plugins: string[];
  workflows: string[];
  effective: RoleEffectiveComposition;
};

export type CraftDraftLedgerEntry = {
  id: string;
  roles: string[];
  origins: string[];
};

export type CraftDraft = {
  schemaVersion: "opencoven.craft-draft.v1";
  id: string;
  plugin: MarketplacePlugin & { draft: true; draftId: string };
  extraction: {
    familiar: string;
    generatedAt: string;
    roles: Array<{ id: string; name: string; description?: string }>;
    ledger: {
      skills: CraftDraftLedgerEntry[];
      components: CraftDraftLedgerEntry[];
      workflows: CraftDraftLedgerEntry[];
      prompts: CraftDraftLedgerEntry[];
      capabilities: CraftDraftLedgerEntry[];
    };
  };
};

type MutableLedger = Map<string, { roles: Set<string>; origins: Set<string> }>;

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareCraftDraftRoles(a: CraftDraftRoleInput, b: CraftDraftRoleInput): number {
  const aName = (a.name.trim() || a.id.trim()).toLowerCase();
  const bName = (b.name.trim() || b.id.trim()).toLowerCase();
  return compareStrings(aName, bName)
    || compareStrings(a.id.trim().toLowerCase(), b.id.trim().toLowerCase());
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "craft";
}

function addLedger(
  ledger: MutableLedger,
  id: string,
  roleName: string,
  origin: string,
): void {
  const cleanId = id.trim();
  if (!cleanId) return;
  const entry = ledger.get(cleanId) ?? { roles: new Set<string>(), origins: new Set<string>() };
  entry.roles.add(roleName);
  entry.origins.add(origin);
  ledger.set(cleanId, entry);
}

function ledgerEntries(ledger: MutableLedger): CraftDraftLedgerEntry[] {
  return [...ledger.entries()].map(([id, entry]) => ({
    id,
    roles: [...entry.roles],
    origins: [...entry.origins],
  }));
}

function addDirect(ledger: MutableLedger, ids: readonly string[], roleName: string): void {
  for (const id of ids) addLedger(ledger, id, roleName, "Direct");
}

function addEffective(ledger: MutableLedger, entries: readonly RoleEffectiveEntry[], roleName: string): void {
  for (const entry of entries) addLedger(ledger, entry.id, roleName, entry.originLabel);
}

function skillResource(id: string, roleIds: readonly string[]): CraftSourcedResource {
  return {
    id,
    sourcePath: `local-role:${roleIds.join("+")}`,
    upstreamPath: "local-familiar-role",
    contentHash: `local-draft:${slugify(id)}`,
    modifications: [
      "Extracted from local familiar Role capability metadata.",
      "Draft resource reference only; review source content before publishing.",
    ],
  };
}

function promptResource(id: string): CraftPromptResource {
  return {
    id,
    name: titleCase(id),
    description: "Referenced by the selected familiar Role set.",
    body: `Review local prompt reference "${id}" before publishing this Craft.`,
  };
}

function workflowResource(id: string): CraftWorkflowResource {
  return {
    id,
    name: titleCase(id),
    description: "Referenced by the selected familiar Role set.",
    steps: [`Review local workflow reference "${id}" before publishing this Craft.`],
  };
}

/** The mechanical name a draft gets from its familiar + role names — also
 *  the reference point for "was this draft renamed?" (docs/craft-ux.md F12). */
export function deriveCraftDisplayName(familiar: string, roleNames: readonly string[]): string {
  return `${titleCase(familiar.trim())} ${roleNames.join(" + ")}`;
}

export function buildCraftDraftFromRoles({
  familiar,
  roles,
  now = new Date().toISOString(),
  displayName,
}: {
  familiar: string;
  roles: CraftDraftRoleInput[];
  now?: string;
  /** Optional operator-chosen name (docs/craft-ux.md F12). The derived name
   *  stays the id/slug source so renames never move the draft's identity. */
  displayName?: string;
}): CraftDraft {
  const cleanFamiliar = familiar.trim();
  if (!cleanFamiliar) throw new Error("familiar is required");
  if (roles.length === 0) throw new Error("select at least one role");
  const orderedRoles = [...roles].sort(compareCraftDraftRoles);

  const roleNames = orderedRoles.map((role) => role.name.trim() || role.id);
  const roleIds = orderedRoles.map((role) => role.id.trim()).filter(Boolean);
  const derivedName = deriveCraftDisplayName(cleanFamiliar, roleNames);
  const customName = displayName?.trim();
  const finalName = customName || derivedName;
  const id = slugify(`${cleanFamiliar}-${roleNames.join("-")}`);

  const ledgers = {
    skills: new Map<string, { roles: Set<string>; origins: Set<string> }>(),
    components: new Map<string, { roles: Set<string>; origins: Set<string> }>(),
    workflows: new Map<string, { roles: Set<string>; origins: Set<string> }>(),
    prompts: new Map<string, { roles: Set<string>; origins: Set<string> }>(),
    capabilities: new Map<string, { roles: Set<string>; origins: Set<string> }>(),
  };

  for (const role of orderedRoles) {
    const roleName = role.name.trim() || role.id;
    addEffective(ledgers.skills, role.effective.skills, roleName);
    addDirect(ledgers.skills, role.skills, roleName);
    addEffective(ledgers.components, role.effective.mcpServers, roleName);
    addEffective(ledgers.components, role.effective.plugins, roleName);
    addDirect(ledgers.components, role.mcpServers, roleName);
    addDirect(ledgers.components, role.plugins, roleName);
    addEffective(ledgers.workflows, role.effective.workflows, roleName);
    addDirect(ledgers.workflows, role.workflows, roleName);
    addEffective(ledgers.prompts, role.effective.prompts, roleName);
    addEffective(ledgers.capabilities, role.effective.tools, roleName);
    addEffective(ledgers.capabilities, role.effective.capabilities, roleName);
    addDirect(ledgers.capabilities, role.tools, roleName);
  }

  const ledger = {
    skills: ledgerEntries(ledgers.skills),
    components: ledgerEntries(ledgers.components),
    workflows: ledgerEntries(ledgers.workflows),
    prompts: ledgerEntries(ledgers.prompts),
    capabilities: ledgerEntries(ledgers.capabilities),
  };

  const craft: CraftSpecification = {
    schemaVersion: "opencoven.craft.v1",
    components: {
      required: ledger.components.map((entry) => entry.id),
      optional: [],
    },
    bundled: {
      skills: ledger.skills.map((entry) => skillResource(entry.id, roleIds)),
      prompts: ledger.prompts.map((entry) => promptResource(entry.id)),
      workflows: ledger.workflows.map((entry) => workflowResource(entry.id)),
    },
    requiredCapabilities: ledger.capabilities.map((entry) => entry.id),
    recommendedRoles: roleNames,
    provenance: {
      source: `local-familiar:${cleanFamiliar}`,
      commit: "local-draft",
      license: "local-review-required",
      licensePath: "~/.coven/craft-drafts",
    },
  };

  const roleAffinity: RoleAffinity[] = [{ familiar: cleanFamiliar, roles: roleNames }];
  const capabilities = ledger.capabilities.map((entry) => entry.id);
  return {
    schemaVersion: "opencoven.craft-draft.v1",
    id,
    plugin: {
      id,
      draftId: id,
      draft: true,
      displayName: finalName,
      description: `Draft Craft extracted from ${roleNames.length === 1 ? `${roleNames[0]} role` : `${roleNames.length} roles`} for ${titleCase(cleanFamiliar)}.`,
      category: "Draft Crafts",
      author: "Local Cave",
      trust: "local-draft",
      policy: { installation: "DRAFT", authentication: "NONE" },
      capabilities,
      keywords: ["craft", "draft", cleanFamiliar, ...roleNames.map(slugify)],
      roleAffinity,
      kind: "craft",
      version: "0.1.0",
      installed: false,
      updateAvailable: false,
      requiresSetup: false,
      available: false,
      requiredConfig: [],
      configured: true,
      craft,
    },
    extraction: {
      familiar: cleanFamiliar,
      generatedAt: now,
      roles: orderedRoles.map((role) => ({
        id: role.id,
        name: role.name,
        ...(role.description ? { description: role.description } : {}),
      })),
      ledger,
    },
  };
}
