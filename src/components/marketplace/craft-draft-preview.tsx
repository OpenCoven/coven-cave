import type { CraftDraft } from "@/lib/craft-draft";
import type { CraftSpecification } from "@/lib/marketplace-catalog";

/** One shared shape for everywhere a draft Craft's contents render: the
 *  create drawer's preview-before-save step and the draft detail dialog
 *  (docs/craft-ux.md, CP2). Groups mirror the extraction ledger categories. */
export type CraftDraftPreviewGroup = {
  id: string;
  title: string;
  items: string[];
};

/** Groups from a client- or server-built draft's extraction ledger. */
export function extractionLedgerGroups(
  ledger: CraftDraft["extraction"]["ledger"],
): CraftDraftPreviewGroup[] {
  return [
    { id: "components", title: "Required components", items: ledger.components.map((entry) => entry.id) },
    { id: "capabilities", title: "Capabilities", items: ledger.capabilities.map((entry) => entry.id) },
    { id: "skills", title: "Skills", items: ledger.skills.map((entry) => entry.id) },
    { id: "prompts", title: "Prompts", items: ledger.prompts.map((entry) => entry.id) },
    { id: "workflows", title: "Workflows", items: ledger.workflows.map((entry) => entry.id) },
  ];
}

/** Groups from a stored draft plugin's craft specification (the marketplace
 *  card model carries the spec, not the extraction ledger). */
export function craftSpecGroups(craft: CraftSpecification | undefined): CraftDraftPreviewGroup[] {
  return [
    { id: "components", title: "Required components", items: craft?.components.required ?? [] },
    { id: "capabilities", title: "Capabilities", items: craft?.requiredCapabilities ?? [] },
    { id: "skills", title: "Skills", items: (craft?.bundled.skills ?? []).map((item) => item.id) },
    { id: "prompts", title: "Prompts", items: (craft?.bundled.prompts ?? []).map((item) => item.id) },
    { id: "workflows", title: "Workflows", items: (craft?.bundled.workflows ?? []).map((item) => item.id) },
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
                <span key={item}>{item}</span>
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
