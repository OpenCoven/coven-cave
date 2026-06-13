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

// The component must apply the saved fonts on mount (the boot script that would
// otherwise do it pre-paint is not mounted), so the rendered font matches the
// persisted selection after a reload — not just after a user change.
assert.match(
  src,
  /useEffect\(\(\) => \{[\s\S]*?applyFont\("sans"[\s\S]*?applyFont\("mono"[\s\S]*?\}, \[\]\)/,
  "mount effect applies both saved fonts",
);

console.log("settings-fonts.test.ts OK");
