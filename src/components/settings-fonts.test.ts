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

// Text size control (reframed Screen magnification) lives in Typography.
assert.match(src, /Text size/, "renders a Text size control");
assert.match(src, /SCREEN_SCALE_OPTIONS/, "uses the shared scale ladder");
assert.match(src, /applyScreenScale/, "applies the scale via the shared helper");
assert.match(src, /aria-pressed=\{scale === option\}/, "scale buttons expose selected state");
// Reset restores text size to the default too, not just the fonts.
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_SCREEN_SCALE[\s\S]*?\}/,
  "reset restores the default text size",
);

// Line spacing control (reading line-height for .cave-md surfaces).
assert.match(src, /Line spacing/, "renders a Line spacing control");
assert.match(src, /READING_LEADING_OPTIONS/, "uses the reading-leading ladder");
assert.match(src, /applyReadingLeading/, "applies line spacing via the shared helper");
assert.match(src, /aria-pressed=\{leading === option\}/, "line-spacing buttons expose selected state");
assert.match(
  src,
  /const reset = \(\) => \{[\s\S]*?DEFAULT_READING_LEADING[\s\S]*?\}/,
  "reset restores the default line spacing",
);

console.log("settings-fonts.test.ts OK");
