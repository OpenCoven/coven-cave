// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const picker = readFileSync(new URL("./color-picker.tsx", import.meta.url), "utf8");

assert.match(picker, /from "react-colorful"/, "imports react-colorful");
assert.match(picker, /HexColorPicker/, "renders the spectrum (HexColorPicker)");
assert.match(picker, /HexColorInput/, "renders a hex field (HexColorInput)");
assert.match(picker, /import "@\/styles\/color-picker\.css"/, "imports its scoped css");
assert.match(picker, /cave-color-picker/, "scopes overrides under .cave-color-picker");
assert.match(picker, /themeSwatches/, "accepts theme swatches");
assert.match(picker, /recents/, "accepts recent colors");
assert.match(picker, /aria-label=/, "swatch buttons are labeled");
assert.match(picker, /export function ColorPicker/, "exports ColorPicker");

// Editor integration (Task 3): the theme editor uses ColorPicker in place of the native input.
const editor = readFileSync(new URL("../theme-color-editor.tsx", import.meta.url), "utf8");
assert.match(editor, /import \{ ColorPicker(?:, type ColorSwatch)? \} from "@\/components\/ui\/color-picker"/, "editor imports ColorPicker");
assert.match(editor, /<ColorPicker/, "editor renders ColorPicker");
assert.match(editor, /<Popover/, "editor opens the picker in a Popover");
assert.match(editor, /resolveToHex/, "editor resolves non-hex colors to hex for the picker");
assert.match(editor, /addRecentColor|getRecentColors/, "editor wires recent colors");
assert.doesNotMatch(editor, /type="color"/, "native color input removed");

console.log("color-picker.test.ts: ok");
