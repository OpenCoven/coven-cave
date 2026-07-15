// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const pickerUrl = new URL("./settings-familiar-picker.tsx", import.meta.url);
const pickerExists = existsSync(pickerUrl);
const picker = pickerExists ? readFileSync(pickerUrl, "utf8") : "";
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const inlineStyles = globals.slice(
  globals.indexOf("/* Inline Familiar Studio"),
  globals.indexOf(".familiar-studio-identity"),
);

assert.match(source, /export function FamiliarStudioInlinePanel/, "Must export the inline panel");

// Master-detail shell delegates roster scale + interaction to one focused,
// controlled picker instead of growing a wrapping chip wall without bound.
assert.equal(pickerExists, true, "Settings has a dedicated scalable familiar picker");
assert.match(source, /SettingsFamiliarPicker/, "Renders the scalable familiar picker");
assert.match(source, /familiars=\{resolved\}/, "Picker receives the resolved roster in daemon order");
assert.match(source, /value=\{activeFamiliarId\}/, "Picker is controlled by Familiar Studio selection");
assert.match(
  source,
  /onChange=\{\(id\) => openFamiliarStudio\(id, activeTab\)\}/,
  "Picker selection opens the familiar at the current Studio tab",
);
assert.match(source, /onSummon=\{onSummon\}/, "Summoning stays attached to familiar selection");
assert.doesNotMatch(source, /role="radiogroup"/, "The unbounded chip radiogroup is retired");
assert.doesNotMatch(source, /familiar-studio-inline__chip/, "Inline panel no longer owns roster chips");
assert.match(source, /familiar-studio-inline__detail/, "Renders the detail pane");

// Reuses the Studio context for selection + tab persistence, NOT selection
// state inside the picker, so deep links and last-tab memory carry over.
assert.match(source, /useFamiliarStudio\(\)/, "Uses the Familiar Studio context for selection");

// The popup is a searchable, bounded combobox/listbox. Keyboard highlight is
// separate from the committed aria-selected familiar.
assert.match(picker, /aria-haspopup="dialog"/, "Picker trigger identifies its popover");
assert.match(picker, /aria-expanded=\{open\}/, "Picker trigger exposes expanded state");
assert.match(picker, /role="combobox"/, "Search field uses editable combobox semantics");
assert.match(picker, /aria-autocomplete="list"/, "Combobox announces list autocomplete");
assert.match(picker, /aria-controls=\{LISTBOX_ID\}/, "Combobox controls the result listbox");
assert.match(picker, /aria-activedescendant=/, "Combobox exposes the keyboard-highlighted option");
assert.match(picker, /role="listbox"/, "Filtered familiar results are a listbox");
assert.match(picker, /role="option"/, "Each familiar result is an option");
assert.match(picker, /aria-selected=\{selected\}/, "Committed familiar selection is announced");
assert.match(
  picker,
  /role="option"[\s\S]{0,180}tabIndex=\{-1\}/,
  "Listbox options use active-descendant navigation instead of adding one Tab stop per familiar",
);
assert.match(
  picker,
  /scrollStrategy="content"/,
  "The picker keeps search and Summon fixed while its result list owns scrolling",
);
assert.match(
  picker,
  /compactAtHeight=\{184\}/,
  "Picker compaction follows the Popover's visual-viewport-aware available height",
);
assert.match(picker, /moveFamiliarPickerIndex/, "Arrow navigation uses the tested index helper");
assert.match(picker, /event\.key === "Enter"/, "Enter commits the highlighted familiar");
assert.match(picker, /aria-live="polite"/, "Search result changes are announced");

const resultsPosition = picker.indexOf('className="familiar-studio-picker__results"');
const footerPosition = picker.indexOf('className="familiar-studio-picker__footer"');
assert.ok(resultsPosition >= 0, "Picker renders a dedicated scrollable results region");
assert.ok(footerPosition > resultsPosition, "Summon footer stays outside and after the results scroller");
assert.match(picker, /Summon familiar/, "Summon remains reachable from the picker footer");
assert.match(
  inlineStyles,
  /\.familiar-studio-picker__trigger\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-height:\s*48px/,
  "Picker trigger is one constant-height row",
);
assert.match(
  inlineStyles,
  /\.familiar-studio-picker__results\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/,
  "Large rosters scroll inside a bounded result list",
);
assert.match(
  inlineStyles,
  /\.familiar-studio-picker__popover\s*\{[\s\S]*?background:\s*var\(--bg-elevated\)/,
  "Dense familiar rows use an opaque elevated surface instead of unreadable glass",
);
assert.match(
  inlineStyles,
  /@media \(max-width: 640px\)[\s\S]*?\.familiar-studio-picker__summon\s*\{[\s\S]*?min-height:\s*44px/,
  "The summon action keeps a touch-sized target in narrow Settings layouts",
);
assert.doesNotMatch(inlineStyles, /\.familiar-studio-inline__picker\s*\{/, "Wrapping roster CSS is retired");

// Non-modal: it must NOT render the drawer chrome (scrim / fixed drawer root).
assert.doesNotMatch(source, /familiar-studio__scrim/, "Inline panel must not render the modal scrim");
assert.doesNotMatch(source, /familiar-studio__drawer/, "Inline panel must not render the fixed drawer root");

// Familiar-specific studio tabs are wired with the same prop shapes the drawer uses.
for (const tab of ["Identity", "Look", "Brain", "Lifecycle", "Memory"]) {
  assert.match(source, new RegExp("FamiliarStudio" + tab + "Tab"), "Wires the " + tab + " tab body");
}
assert.match(source, /<FamiliarStudioLookTab familiar=\{familiar\} allFamiliars=\{resolved\} \/>/, "Look tab gets all resolved familiars for group colors");
assert.match(source, /<FamiliarStudioMemoryTab familiar=\{familiar\} allFamiliars=\{familiars\} \/>/, "Memory tab gets the raw roster");
assert.match(source, /VaultPanel/, "Wires the Vault settings panel inside familiar settings");
assert.match(source, /id: "vault", label: "Vault"/, "Exposes Vault as a familiar settings tab");

// Detail pane is never empty on entry: auto-selects a familiar (the one-shot
// "Open Brain Studio" handoff id when present, else the first) and recovers when
// the current selection disappears.
assert.match(source, /resolved\.some\(\(f\) => f\.id === activeFamiliarId\)/, "Recovers when the selected familiar vanishes");
assert.match(source, /openFamiliarStudio\(handoff \?\? resolved\[0\]\.id\)/, "Auto-selects the Brain Studio handoff familiar, falling back to the first");
assert.match(source, /BRAIN_STUDIO_FAMILIAR_KEY/, "Reads the one-shot Brain Studio handoff key");

// Autosave footer carries over from the drawer.
assert.match(source, /Changes save automatically/, "Shows the autosave footer");
assert.match(source, /Saved locally, daemon offline/, "Shows the daemon-offline indicator");

console.log("familiar-studio-inline.test.ts: ok");
