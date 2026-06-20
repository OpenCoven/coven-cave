// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudioInlinePanel/, "Must export the inline panel");

// Master-detail shell: a compact familiar dropdown + detail pane.
assert.doesNotMatch(source, /familiar-studio-inline__list/, "Settings should not render a familiar roster rail");
assert.match(source, /familiar-studio-inline__selector/, "Renders the familiar dropdown selector");
assert.match(source, /aria-label="Choose familiar to edit"/, "Settings familiar dropdown is labelled");
assert.match(source, /familiar-studio-inline__detail/, "Renders the detail pane");

// Reuses the Studio context for selection + tab persistence, NOT local state,
// so deep-link openFamiliarStudio(id, tab) and last-tab memory carry over.
assert.match(source, /useFamiliarStudio\(\)/, "Uses the Familiar Studio context for selection");
assert.match(
  source,
  /openFamiliarStudio\(e\.currentTarget\.value, activeTab\)/,
  "Selecting from the dropdown opens that familiar at the current tab",
);

// Non-modal: it must NOT render the drawer chrome (scrim / fixed drawer root).
assert.doesNotMatch(source, /familiar-studio__scrim/, "Inline panel must not render the modal scrim");
assert.doesNotMatch(source, /familiar-studio__drawer/, "Inline panel must not render the fixed drawer root");

// All five studio tabs are wired with the same prop shapes the drawer uses.
for (const tab of ["Identity", "Look", "Brain", "Lifecycle", "Memory"]) {
  assert.match(source, new RegExp(`FamiliarStudio${tab}Tab`), `Wires the ${tab} tab body`);
}
assert.match(source, /<FamiliarStudioLookTab familiar=\{familiar\} allFamiliars=\{resolved\} \/>/, "Look tab gets all resolved familiars for group colors");
assert.match(source, /<FamiliarStudioMemoryTab familiar=\{familiar\} allFamiliars=\{familiars\} \/>/, "Memory tab gets the raw roster");

// Detail pane is never empty on entry: auto-selects the first familiar and
// recovers when the current selection disappears.
assert.match(source, /resolved\.some\(\(f\) => f\.id === activeFamiliarId\)/, "Recovers when the selected familiar vanishes");
assert.match(source, /openFamiliarStudio\(resolved\[0\]\.id\)/, "Auto-selects the first familiar");

// Autosave footer carries over from the drawer.
assert.match(source, /Changes save automatically/, "Shows the autosave footer");
assert.match(source, /Saved locally, daemon offline/, "Shows the daemon-offline indicator");

console.log("familiar-studio-inline.test.ts: ok");
