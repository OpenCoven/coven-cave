import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("../marketplace-view.tsx", import.meta.url), "utf8");
const card = await readFile(new URL("./marketplace-card.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("./marketplace-detail.tsx", import.meta.url), "utf8");
const createDrawer = await readFile(new URL("./craft-create-drawer.tsx", import.meta.url), "utf8");
const craftDetailUrl = new URL("./craft-detail.tsx", import.meta.url);
const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
const marketplaceRoute = await readFile(new URL("../../app/api/marketplace/route.ts", import.meta.url), "utf8");

assert.match(view, /\{ id: "crafts", label: "Crafts"/, "Crafts is a first-class Marketplace section");
assert.match(view, /\{ id: "craft", label: "Crafts" \}/, "Browse can filter catalog entries by Craft kind");
assert.match(view, /\{ id: "knowledge-pack", label: "Knowledge packs" \}/, "Browse can filter catalog entries by Knowledge pack kind");
assert.match(view, /id="marketplace-panel-crafts"/, "Crafts section has a labelled tabpanel");
assert.match(view, /selectSection\("crafts"\)/, "Browse setup rail links to Crafts");
assert.match(view, /Familiar[\s\S]*Role[\s\S]*Craft[\s\S]*Capabilities/, "Crafts section explains the loadout hierarchy");
assert.match(view, /Create Craft/, "Crafts section exposes local Craft creation");
assert.match(view, /setCreatingCraft\(true\)/, "Create Craft opens the authoring drawer");
assert.match(view, /<CraftCreateDrawer/, "Crafts page wires the familiar-to-Craft authoring flow");
assert.match(view, /onCreated=\{\(id\) =>/, "new local drafts refresh and open for review");
assert.match(view, /plugin\.kind === "craft"[\s\S]*\/api\/marketplace\/crafts\/install/, "Craft installs use the verified endpoint");
assert.match(view, /plugin\.kind === "craft"[\s\S]*\/api\/marketplace\/crafts\/uninstall/, "Craft removal uses the verified endpoint");
assert.match(view, /Craft installed and verified/, "successful verification has an accessible announcement");
assert.match(view, /Craft removed/, "successful Craft removal has an accessible announcement");
assert.match(marketplaceRoute, /readCraftDrafts/, "marketplace route includes local Craft drafts");
assert.match(marketplaceRoute, /\.\.\.drafts\.map\(\(draft\) => draft\.plugin\)/, "draft Crafts bypass the public-catalog familiar-name sanitizer");

assert.match(card, /plugin\.kind === "craft"[\s\S]*onOpen\(plugin\.id\)/, "Craft card actions open preview before installation");
assert.match(card, /state === "added" \? "Manage" : "Preview"/, "Craft cards use explicit Preview and Manage states");
assert.match(card, /plugin\.draft[\s\S]*"Draft"/, "local draft Crafts have a distinct card state");
assert.match(card, /kind === "craft"[\s\S]*"Craft"/, "Craft cards have a distinct kind label");
assert.match(card, /kind === "knowledge-pack"[\s\S]*"Knowledge pack"/, "Knowledge pack cards have a distinct kind label");
assert.match(createDrawer, /className="craft-create-drawer__backdrop"/, "Craft create drawer keeps a stable fixed-overlay hook");
assert.match(createDrawer, /className="craft-create-drawer__header"/, "Craft create drawer header layout stays on semantic hooks");
assert.match(createDrawer, /className="craft-create-drawer__actions"/, "Craft create drawer footer actions stay on semantic hooks");

// ── Agentic build path (cave-4n7j) ───────────────────────────────────────────
// The drawer offers two ways in: hand-pick roles, or describe the Craft and
// hand a familiar the complete drafts-API build brief (the same chat-dispatch
// contract the skills "Use" action rides). The brief itself is a pure,
// unit-tested builder, and .agents/skills/craft-builder documents the same
// loop for any harness session working in this repo.
assert.match(createDrawer, /type CreateMode = "extract" \| "describe"/, "drawer models the two creation modes");
assert.match(createDrawer, /\{ id: "describe", label: "Describe it", icon: "ph:sparkle" \}/, "the agentic mode is a first-class tab");
assert.match(createDrawer, /import \{ buildCraftAgentPrompt \} from "@\/lib\/craft-agent-prompt"/, "the brief comes from the shared prompt builder");
assert.match(createDrawer, /new CustomEvent\("cave:agents-new-chat"/, "describe mode dispatches a familiar chat");
assert.match(createDrawer, /initialPrompt: buildCraftAgentPrompt\(\{ description, familiar: familiar \|\| undefined \}\)/, "the chat opens with the complete build brief");
assert.match(createDrawer, /Draft with familiar/, "describe mode has an explicit agentic CTA");
assert.match(createDrawer, /What happens next/, "describe mode explains the agentic loop");

// ── One-flow authoring (docs/craft-ux.md CP2) ────────────────────────────────
// Describe-first with last-used memory; pick-roles previews the REAL
// extraction ledger (client-side pure synthesis) before anything is written;
// one shared preview component renders draft contents in the drawer and the
// detail; the Crafts grid separates local drafts from the published catalog.
assert.match(createDrawer, /\{ id: "describe"[\s\S]*?\{ id: "extract"/, "describe leads the creation-mode tabs");
assert.match(createDrawer, /MODE_MEMORY_KEY = "cave:craft-create:mode"/, "the last-used creation mode is remembered");
assert.match(createDrawer, /buildCraftDraftFromRoles\(\{\s*familiar,\s*roles: selectedRoles,/, "pick-roles synthesizes the real draft client-side for preview");
assert.match(createDrawer, /Preview draft/, "role selection advances to a preview step before saving");
assert.match(createDrawer, /Adjust roles/, "the preview step returns to selection without losing state");
assert.match(createDrawer, /extractionLedgerGroups\(previewDraft\.extraction\.ledger\)/, "the preview renders the extraction ledger, not just counts");
{
  const draftPreview = await readFile(new URL("./craft-draft-preview.tsx", import.meta.url), "utf8");
  assert.match(draftPreview, /export function CraftDraftPreview/, "draft contents render through one shared component");
  assert.match(draftPreview, /craft-draft-ledger/, "the shared preview keeps the stable ledger styling hook");
}
assert.match(detail, /<CraftDraftPreview\s+groups=\{fullDraft \? extractionLedgerGroups\(fullDraft\.extraction\.ledger\) : craftSpecGroups\(craft\)\}/, "draft detail renders the same shared preview, attributed when the full draft loads");
assert.match(view, /Your drafts/, "the Crafts grid groups local drafts above the published catalog");
assert.match(css, /\.craft-grid-group \{/, "Craft lifecycle groups have a stable visual hook");

// ── Power layer in-flow (docs/craft-ux.md CP3) ───────────────────────────────
// The extraction ledger's provenance reaches the screen (F4); a saved draft
// reopens the drawer pre-seeded for in-place editing (F5); switching familiars
// retains each familiar's picks (F9); drafts can be renamed without moving
// their identity (F12).
{
  const draftPreview = await readFile(new URL("./craft-draft-preview.tsx", import.meta.url), "utf8");
  assert.match(draftPreview, /ledgerHint/, "ledger items carry origin + role attribution");
  assert.match(draftPreview, /craft-draft-ledger__origin/, "attribution renders on a stable styling hook");
}
assert.match(createDrawer, /export type CraftDrawerSeed/, "draft editing seeds the drawer through a shared shape");
assert.match(createDrawer, /appliedSeedId/, "a seed applies once per open, not on every render");
assert.match(createDrawer, /setStep\("preview"\)/, "seeded edits land on the preview step");
assert.match(createDrawer, /selectionsByFamiliar/, "switching familiars stashes the current role picks");
assert.match(createDrawer, /displayName: customName\.trim\(\) \|\| undefined/, "the preview renders the operator's rename live");
assert.match(createDrawer, /Save changes/, "seeded edits label the save as an edit");
assert.match(createDrawer, /method: "DELETE"/, "seeded saves are recreate-and-replace");
assert.match(detail, /onAdjustRoles/, "draft detail can hand off to the seeded drawer");
assert.match(detail, /Adjust roles/, "adjusting roles is an explicit action");
assert.match(detail, /deriveCraftDisplayName/, "only operator-chosen names survive the adjust round trip");
assert.match(view, /setCraftSeed\(seed\)/, "the hub routes the seed from detail to drawer");
{
  const craftDraftLib = await readFile(new URL("../../lib/craft-draft.ts", import.meta.url), "utf8");
  assert.match(craftDraftLib, /displayName\?: string/, "the draft builder accepts an optional operator name");
  assert.match(craftDraftLib, /const id = slugify\(`\$\{cleanFamiliar\}-\$\{roleNames\.join\("-"\)\}`\)/, "renames never move the draft's derived identity");
}

// ── Describe-it closes its loop (cave-46wg) ──────────────────────────────────
// The dispatched brief is no longer fire-and-forget: the drawer snapshots the
// drafts store, polls while waiting, and hands an ARRIVED draft to the same
// onCreated the manual path uses — plus the draft detail can refine, publish,
// and delete through the new briefs and DELETE route.
assert.match(createDrawer, /baselineDraftIds/, "arrival = a draft id NOT in the dispatch-time snapshot");
assert.match(createDrawer, /usePausablePoll\(\(\) => void checkForArrivedDraft\(\), 5000, \{ enabled: open && awaiting \}\)/, "the drawer polls the drafts store while waiting, visibility-paused via the shared hook");
assert.match(createDrawer, /onCreated\(arrived\.id\)/, "an arrived draft opens through the shared onCreated path");
assert.match(createDrawer, /Stop waiting/, "waiting is cancelable");
assert.match(createDrawer, /Waiting for the familiar(?:'|&apos;)s draft/, "the waiting state explains itself");
assert.match(createDrawer, /awaiting \? "Drafting…" : "Draft with familiar"/, "the CTA reflects the in-flight build");
{
  const draftsRoute = await readFile(new URL("../../app/api/marketplace/crafts/drafts/route.ts", import.meta.url), "utf8");
  assert.match(draftsRoute, /export async function DELETE/, "drafts support recreate-and-replace refinement");
}
assert.match(detail, /buildCraftRefinePrompt/, "draft detail can refine in chat");
assert.match(detail, /buildCraftPublishPrompt/, "draft detail can prepare the catalog PR");
assert.match(detail, /Refine in chat/, "refine is an explicit action");
assert.match(detail, /Prepare for catalog/, "publication prep is an explicit action");
assert.match(detail, /\/api\/marketplace\/crafts\/drafts\?id=/, "draft deletion uses the DELETE route");
assert.match(detail, /Really delete\?/, "draft deletion is two-step");
assert.match(detail, /onDraftDeleted/, "a deleted draft refreshes the hub");
assert.match(view, /onDraftDeleted=\{\(\) =>/, "the hub clears selection and reloads after a draft delete");
{
  const promptLib = await readFile(new URL("../../lib/craft-agent-prompt.ts", import.meta.url), "utf8");
  assert.match(promptLib, /GET \/api\/roles/, "the brief documents role discovery");
  assert.match(promptLib, /POST \/api\/marketplace\/crafts\/drafts/, "the brief documents draft creation");
  assert.match(promptLib, /crafts\/plan\?id=/, "the brief documents plan verification");
  assert.equal(
    existsSync(new URL("../../../.agents/skills/craft-builder/SKILL.md", import.meta.url)),
    true,
    "the craft-builder agent skill documents the same build loop for harness sessions",
  );
}

assert.equal(existsSync(craftDetailUrl), true, "Craft detail component exists");
const craftDetail = await readFile(craftDetailUrl, "utf8");
assert.match(detail, /plugin\.kind === "craft"[\s\S]*<CraftDetail/, "generic drawer delegates Craft state to the loadout detail");
assert.match(detail, /plugin\.kind === "knowledge-pack"[\s\S]*<KnowledgePackDetail/, "generic drawer delegates Knowledge packs to the seeding detail");
assert.match(detail, /plugin\.draft[\s\S]*<DraftCraftDetail/, "local draft Crafts open a draft review drawer instead of install planning");
assert.match(craftDetail, /\/api\/marketplace\/crafts\/plan\?id=/, "drawer previews the exact install plan");
assert.match(craftDetail, /fetch\("\/api\/roles"/, "drawer loads Roles for equipping and effective capability display");
assert.match(craftDetail, /fetch\("\/api\/roles\/crafts"/, "Role picker uses the guarded attachment endpoint");
for (const heading of [
  "Install plan",
  "Required components",
  "Bundled skills",
  "Prompts & workflows",
  "Capability footprint",
  "Optional enhancements",
  "Provenance",
  "Equip Roles",
  "Effective capabilities",
]) {
  assert.match(craftDetail, new RegExp(heading), `${heading} is visible in the Craft dossier`);
}
assert.match(craftDetail, /plan\.commands\.install\.join\(" "\)/, "exact Codex install argv is shown before confirmation");
assert.match(craftDetail, /plan\?\.runtime\.disclosure/, "user-scope routing-boundary disclosure is visible");
assert.match(craftDetail, /Removing the Craft does not remove shared optional enhancements/, "shared enhancements are never silently removed");
assert.match(craftDetail, /originLabel/, "effective Role capability chips retain Direct/via-Craft origins");
assert.match(craftDetail, /affectedRoles/, "detach-first failure shows affected Roles");
assert.match(craftDetail, /affectedRolesTruncated/, "bounded detach-first diagnostics disclose omitted Role counts");
assert.match(craftDetail, /aria-live="polite"/, "plan and action state changes are announced");
assert.match(craftDetail, /ref=\{dialogRef\}[\s\S]*tabIndex=\{-1\}/, "focus-trap container remains programmatically focusable for its fallback path");
assert.doesNotMatch(craftDetail, /<label[^>]+className="craft-role-row"/, "Role rows do not nest a button inside a label");
assert.match(craftDetail, /Install Craft/, "new Crafts expose an explicit install state");
assert.match(craftDetail, /Update Craft/, "stale Crafts expose an explicit update state");
assert.match(craftDetail, /Installed and verified/, "current Crafts expose a verified state");
assert.match(craftDetail, /component\.id\}@\$\{component\.version/, "required components expose exact ids and versions");
assert.match(craftDetail, /licensePath/, "provenance includes the bundled license notice path");
assert.match(craftDetail, /upstreamPath[\s\S]*sourcePath[\s\S]*contentHash[\s\S]*modifications/, "bundled skill provenance exposes source paths, hashes, and Coven modifications");
assert.match(
  craftDetail,
  /plugin\.installation\?\.verifiedAt[\s\S]*plugin\.installation\?\.craftVersion[\s\S]*plugin\.updateAvailable/,
  "Role resolution refreshes when install verification or the current Craft version changes",
);

const knowledgePackDetail = await readFile(new URL("./knowledge-pack-detail.tsx", import.meta.url), "utf8");
const knowledgePackSeedModal = await readFile(new URL("./knowledge-pack-seed-modal.tsx", import.meta.url), "utf8");
assert.match(knowledgePackDetail, /\/api\/knowledge\/packs/, "Knowledge pack detail loads the compiled pack manifest");
assert.match(knowledgePackDetail, /Install & seed…/, "new Knowledge packs expose an install-and-seed action");
assert.match(knowledgePackDetail, /Seed again…/, "installed Knowledge packs make idempotent reseeding explicit");
assert.match(knowledgePackDetail, /Folders/, "Knowledge pack detail shows seeded folders");
assert.match(knowledgePackDetail, /Bundled skills/, "Knowledge pack detail explains bundled skills");
assert.match(knowledgePackSeedModal, /<Modal/, "Knowledge pack seed flow uses the shared focus-trapped Modal");
assert.match(knowledgePackSeedModal, /<ProjectPicker/, "Project target reuses the shared ProjectPicker");
assert.match(knowledgePackSeedModal, /\/api\/marketplace\/install[\s\S]*\/api\/knowledge\/packs\/seed[\s\S]*\/api\/skills\/packages\/install/, "seed confirmation tracks install, seeds, then installs checked skills");
assert.match(knowledgePackSeedModal, /useAnnouncer/, "seed results and errors are announced through the live region");

assert.match(css, /\.craft-loadout-path \{/, "Craft hierarchy has a stable visual hook");
assert.match(css, /\.craft-create-drawer__backdrop \{/, "Craft create drawer overlay has a stable visual hook");
assert.match(css, /\.craft-create-drawer \{/, "Craft creation drawer has stable styling hooks");
assert.match(css, /\.craft-draft-ledger \{/, "Craft draft extraction ledger has stable styling hooks");
assert.match(css, /\.craft-dossier__ledger \{/, "Craft grouped contents use a stable dossier ledger");
assert.match(css, /\.craft-role-row:focus-within \{/, "Role picker has a visible keyboard focus treatment");

console.log("crafts-marketplace.test.ts: ok");
