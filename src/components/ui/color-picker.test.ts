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

// Editor integration: the Theme tokens editor (settings-shell) uses ColorPicker
// in a Popover in place of the native input, with recent-color wiring.
const settings = readFileSync(new URL("../settings-shell.tsx", import.meta.url), "utf8");
assert.match(settings, /import \{ ColorPicker, type ColorSwatch \} from "@\/components\/ui\/color-picker"/, "tokens editor imports ColorPicker");
assert.match(settings, /<ColorPicker/, "tokens editor renders ColorPicker");
assert.match(settings, /<Popover/, "tokens editor opens the picker in a Popover");
assert.match(settings, /addRecentColor|getRecentColors/, "tokens editor wires recent colors");
assert.doesNotMatch(settings, /type="color"/, "native color input removed");

console.log("color-picker.test.ts: ok");
