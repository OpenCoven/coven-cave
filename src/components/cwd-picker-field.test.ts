// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./cwd-picker-field.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./automation-create-dialog.tsx", import.meta.url), "utf8");

// Reusable working-directories field: free-text list + a Browse-projects modal
// that walks ProjectTree and toggles directories into the list.
assert.match(src, /export function CwdPickerField/, "exports a reusable field component");
assert.match(src, /<textarea[\s\S]*?value=\{value\}[\s\S]*?onChange=\{\(event\) => onChange\(event\.target\.value\)\}/, "the textarea edits the raw newline value (free typing, no eaten blank lines)");
assert.match(src, /Browse projects/, "offers a Browse-projects affordance");
assert.match(src, /fetch\("\/api\/projects"\)/, "lazy-loads the project list from /api/projects when the picker opens");
assert.match(src, /<ProjectTree[\s\S]*?onDirSelect=\{addCwd\}[\s\S]*?selectedDirs=\{selectedDirs\}/, "browses with the shared ProjectTree, toggling dirs in/out");
assert.match(src, /role="dialog"[\s\S]*?aria-modal="true"/, "the picker is a labelled modal dialog");
// Escape + Tab cycling + focus management come from the shared focus-trap hook,
// not a bespoke inline onKeyDown.
assert.match(src, /useFocusTrap\(pickerOpen, dialogRef, \{ onEscape: \(\) => setPickerOpen\(false\) \}\)/, "the picker dismisses via the shared useFocusTrap hook");
assert.doesNotMatch(src, /onKeyDown=/, "no hand-rolled key handler — the focus trap owns Escape");
assert.match(src, /list\.includes\(clean\)/, "addCwd dedupes already-listed paths");

// The cron create dialog uses it (parity with the detail editor — no more
// raw-path-only textarea).
assert.match(dialog, /import \{ CwdPickerField \} from "@\/components\/cwd-picker-field"/, "the create dialog imports the field");
assert.match(dialog, /<CwdPickerField[\s\S]*?value=\{cwds\}[\s\S]*?onChange=\{setCwds\}/, "the create dialog wires its cwds state through the field");

console.log("cwd-picker-field.test.ts: ok");
