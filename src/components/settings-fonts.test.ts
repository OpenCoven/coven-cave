// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./settings-fonts.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

assert.match(src, /FONT_OPTIONS/, "FontSettings reads FONT_OPTIONS");
assert.match(src, /slot === "sans"/, "filters the sans slot");
assert.match(src, /slot === "mono"/, "filters the mono slot");
assert.match(src, /<select/, "renders selects");
assert.match(src, /writeFontPref/, "persists the choice");
assert.match(src, /applyFont/, "applies the choice live");
assert.match(src, /fontStack\(/, "preview rendered with fontStack");
assert.match(src, /DEFAULT_FONT_ID/, "reset targets the defaults");
assert.match(src, /Reset/, "exposes a reset control");

assert.match(shell, /import \{ FontSettings \} from "\.\/settings-fonts"/, "shell imports FontSettings");
assert.match(shell, /<FontSettings\s*\/>/, "AppearanceSection renders <FontSettings />");

console.log("settings-fonts.test.ts OK");
