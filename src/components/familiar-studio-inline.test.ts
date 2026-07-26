// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const picker = readFileSync(new URL("./settings-familiar-picker.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/settings-familiars.css", import.meta.url), "utf8");
const identityTab = readFileSync(new URL("./familiar-studio-identity-tab.tsx", import.meta.url), "utf8");
const memoryTab = readFileSync(new URL("./familiar-studio-memory-tab.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudioInlinePanel/, "Exports the inline control sheet");
assert.match(source, /SettingsFamiliarPicker/, "Renders the persistent familiar roster");
assert.match(source, /familiars=\{resolved\}/, "Roster receives resolved familiars in daemon order");
assert.match(source, /value=\{activeFamiliarId\}/, "Roster is controlled by Studio selection");
assert.match(
  source,
  /onChange=\{\(id\) => openFamiliarStudio\(id, activeTab\)\}/,
  "Roster selection preserves the active Studio tab",
);
assert.match(source, /onSummon=\{onSummon\}/, "Summoning stays attached to the roster");
assert.match(source, /onManageLifecycle=\{openLifecycle\}/, "Roster removal routes to safe lifecycle controls");

// The handoff's roster is always visible, bounded, searchable and keyboard
// navigable; it no longer hides the coven behind a popover.
assert.match(picker, /<aside[\s\S]*aria-label="Familiar roster"/, "Picker renders as a roster pane");
assert.doesNotMatch(picker, /Popover/, "The dropdown picker is retired");
assert.match(picker, /<SearchInput/, "Roster has a shared search primitive");
assert.match(picker, /placeholder="Find a familiar…"/, "Roster uses handoff copy");
assert.doesNotMatch(picker, /role="listbox"/, "Roster actions are not nested in an ARIA listbox");
assert.match(picker, /aria-current=\{selected \? "page" : undefined\}/, "Committed selection is announced");
assert.match(picker, /moveFamiliarPickerIndex/, "Arrow navigation uses the tested helper");
assert.match(picker, /optionRefs\.current\[next\]\?\.focus\(\)/, "Arrow navigation moves real focus");
assert.match(picker, /aria-live="polite"/, "Search result count is announced");
assert.match(picker, /Summon familiar/, "Summon remains in the roster header");
assert.match(picker, /archiveFamiliar/, "Archive uses the production store");
assert.match(picker, /unarchiveFamiliar/, "Archived roster rows can be restored in place");
assert.match(
  picker,
  /familiar\.archived\s*\?\s*unarchiveFamiliar\(familiar\.id\)\s*:\s*archiveFamiliar\(familiar\.id\)/,
  "The roster archive action toggles instead of making an archived familiar unreachable",
);
assert.match(picker, /data-archived=\{familiar\.archived \|\| undefined\}/, "Archived rows expose a visual state");
assert.match(picker, /reveal-scope/, "Row actions follow shared progressive disclosure");
assert.match(
  shell,
  /useResolvedFamiliars\(rawFamiliars,\s*\{\s*includeArchived:\s*true\s*\}\)/,
  "Settings keeps archived familiars in the lifecycle control sheet",
);
assert.match(
  styles,
  /\.settings-familiar-roster__list\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/,
  "Large rosters own a bounded scroll region",
);
assert.match(
  styles,
  /\.settings-familiar-roster\[data-collapsed\]/,
  "Roster collapses to the avatar rail",
);

// Non-modal detail pane with the handoff identity hero.
assert.doesNotMatch(source, /familiar-studio__scrim/, "Inline panel has no modal scrim");
assert.doesNotMatch(source, /familiar-studio__drawer/, "Inline panel has no fixed drawer root");
assert.match(source, /familiar-studio-control__hero/, "Renders the identity hero");
assert.match(source, /requestAgentsNewChat/, "Open chat uses the shared handoff");
assert.match(source, /streamFamiliarText/, "Test run uses the sanctioned stream");
assert.match(source, /useFamiliarImageUpload/, "Hero avatar uses the shared upload behavior");

// Five real Studio surfaces; Look and Lifecycle remain merged into Identity.
for (const tab of ["Identity", "Brain", "Memory", "Projects"]) {
  assert.match(source, new RegExp(`FamiliarStudio${tab}Tab`), `Wires the ${tab} tab body`);
}
for (const gone of ["look", "lifecycle", "journal"]) {
  assert.doesNotMatch(source, new RegExp(`id: "${gone}"`), `No standalone ${gone} tab remains`);
}
assert.match(source, /id: "identity", label: "Identity"/, "Identity leads the tab strip");
assert.match(
  source,
  /const displayedTab = activeTab === "contract" \? "identity" : activeTab/,
  "Retired Contract tab handoffs resolve onto the five-tab Identity surface",
);
assert.match(source, /value=\{displayedTab\}/, "The visible tab strip never receives the retired Contract value");
assert.match(
  identityTab,
  /<FamiliarStudioLookTab familiar=\{familiar\} allFamiliars=\{allFamiliars\} \/>/,
  "Identity hosts appearance controls",
);
assert.match(identityTab, /Grimoire files/, "Identity keeps the handoff's Grimoire file section");
assert.match(
  identityTab,
  /fetch\(\s*`\/api\/familiars\/\$\{encodeURIComponent\(familiarId\)\}\/contract`/,
  "Grimoire file state comes from the real familiar contract route",
);
assert.match(source, /allFamiliars=\{resolved\}/, "Identity receives the resolved roster");
assert.match(
  source,
  /<FamiliarStudioMemoryTab[\s\S]*?allFamiliars=\{familiars\}/,
  "Memory receives the raw daemon roster",
);
assert.match(memoryTab, /<FamiliarDailyNotes familiar=\{familiar\} \/>/, "Add note uses the real per-familiar notes editor");
assert.match(memoryTab, />\s*Add note\s*</, "Memory exposes the handoff's Add note action");
assert.match(memoryTab, /breadcrumb=\{\["Familiars", familiar\.display_name, "Add note"\]\}/, "Notes open in the shared modal");
assert.match(source, /<VaultPanel familiarId=\{familiar\.id\}/, "Vault is scoped to the active familiar");
assert.match(source, /id: "vault", label: "Vault"/, "Vault remains a Studio tab");
assert.match(source, /<AccessGroupsSection familiars=\{resolved\}/, "Cross-familiar access groups remain reachable in Projects");

// Entry selection and cross-page handoff behavior remain intact.
assert.match(
  source,
  /resolved\.some\(\(item\) => item\.id === activeFamiliarId\)/,
  "Recovers when the selected familiar vanishes",
);
assert.match(
  source,
  /openFamiliarStudio\(handoff \?\? resolved\[0\]\.id\)/,
  "Uses the Brain Studio handoff, then falls back to the first familiar",
);
assert.match(source, /BRAIN_STUDIO_FAMILIAR_KEY/, "Reads the one-shot handoff key");

assert.match(source, /Changes save automatically/, "Shows the autosave footer");
assert.match(source, /Saved locally, daemon offline/, "Shows daemon-offline state");

console.log("familiar-studio-inline.test.ts: ok");
