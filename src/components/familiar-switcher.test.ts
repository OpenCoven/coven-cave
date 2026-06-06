// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-switcher.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveFamiliarGlyph \} from "@\/lib\/familiar-glyph"/,
  "FamiliarSwitcher should use the shared glyph resolver",
);

assert.match(
  source,
  /import \{ useGlyphOverrides \} from "@\/lib\/cave-glyph-overrides"/,
  "FamiliarSwitcher should subscribe to cave-local glyph overrides",
);

assert.match(
  source,
  /const glyphOverrides = useGlyphOverrides\(\)/,
  "FamiliarSwitcher should read the override map",
);

assert.match(
  source,
  /const glyph = resolveFamiliarGlyph\(familiar, glyphOverrides\)/,
  "Active familiar glyph should honor local overrides",
);

assert.match(
  source,
  /const fGlyph = resolveFamiliarGlyph\(f, glyphOverrides\)/,
  "Menu row glyphs should honor local overrides",
);

assert.doesNotMatch(
  source,
  /parseGlyphString|DEFAULT_FAMILIAR_GLYPH/,
  "FamiliarSwitcher should not bypass the shared glyph resolver",
);

assert.match(
  source,
  /aria-haspopup="menu"/,
  "Switcher trigger should advertise menu semantics",
);

assert.match(
  source,
  /role="menu"/,
  "Switcher popup should use menu semantics",
);

assert.match(
  source,
  /role="menuitem"/,
  "Switcher rows should use menu item semantics",
);

assert.doesNotMatch(
  source,
  /aria-selected=/,
  "Menu items should not use listbox-only aria-selected",
);
