import type { CraftDraft, CraftDraftLedgerEntry } from "@/lib/craft-draft";
import type { CraftSpecification } from "@/lib/marketplace-catalog";

/** One shared shape for everywhere a draft Craft's contents render: the
 *  create drawer's preview-before-save step and the draft detail dialog
 *  (docs/craft-ux.md, CP2). Groups mirror the extraction ledger categories.
 *  Items optionally carry provenance (docs/craft-ux.md F4, CP3): which roles
 *  contributed the entry and through what origin (Direct vs via a Craft). */
export type CraftDraftPreviewItem = {
  id: string;
  hint?: string;
};

export type CraftDraftPreviewGroup = {
  id: string;
  title: string;
  items: CraftDraftPreviewItem[];
};

function ledgerHint(entry: CraftDraftLedgerEntry): string | undefined {
  const origins = entry.origins.filter(Boolean);
  const roles = entry.roles.filter(Boolean);
  if (origins.length === 0 && roles.length === 0) return undefined;
  if (origins.length === 0) return roles.join(", ");
  if (roles.length === 0) return origins.join(", ");
  return `${origins.join(", ")} · ${roles.join(", ")}`;
}

function ledgerItems(entries: CraftDraftLedgerEntry[]): CraftDraftPreviewItem[] {
  return entries.map((entry) => ({ id: entry.id, hint: ledgerHint(entry) }));
}

/** Groups from a client- or server-built draft's extraction ledger — the
 *  attributed form ("why is this in my bundle?"). */
export function extractionLedgerGroups(
  ledger: CraftDraft["extraction"]["ledger"],
): CraftDraftPreviewGroup[] {
  return [
    { id: "components", title: "Required components", items: ledgerItems(ledger.components) },
    { id: "capabilities", title: "Capabilities", items: ledgerItems(ledger.capabilities) },
    { id: "skills", title: "Skills", items: ledgerItems(ledger.skills) },
    { id: "prompts", title: "Prompts", items: ledgerItems(ledger.prompts) },
    { id: "workflows", title: "Workflows", items: ledgerItems(ledger.workflows) },
  ];
}

/** Groups from a stored draft plugin's craft specification (the marketplace
 *  card model carries the spec, not the extraction ledger) — unattributed
 *  fallback when the full draft isn't loaded. */
export function craftSpecGroups(craft: CraftSpecification | undefined): CraftDraftPreviewGroup[] {
  const bare = (ids: readonly string[]): CraftDraftPreviewItem[] => ids.map((id) => ({ id }));
  return [
    { id: "components", title: "Required components", items: bare(craft?.components.required ?? []) },
    { id: "capabilities", title: "Capabilities", items: bare(craft?.requiredCapabilities ?? []) },
    { id: "skills", title: "Skills", items: bare((craft?.bundled.skills ?? []).map((item) => item.id)) },
    { id: "prompts", title: "Prompts", items: bare((craft?.bundled.prompts ?? []).map((item) => item.id)) },
    { id: "workflows", title: "Workflows", items: bare((craft?.bundled.workflows ?? []).map((item) => item.id)) },
  ];
}

export function CraftDraftPreview({
  groups,
  ariaLabel = "Draft extraction ledger",
}: {
  groups: CraftDraftPreviewGroup[];
  ariaLabel?: string;
}) {
  return (
    <div className="craft-draft-ledger" aria-label={ariaLabel}>
      {groups.map((group) => (
        <section key={group.id}>
          <h3>{group.title}</h3>
          {group.items.length ? (
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span key={item.id} title={item.hint}>
                  {item.id}
                  {item.hint ? <small className="craft-draft-ledger__origin">{item.hint}</small> : null}
                </span>
              ))}
            </div>
          ) : (
            <p>No entries</p>
          )}
        </section>
      ))}
    </div>
  );
}
