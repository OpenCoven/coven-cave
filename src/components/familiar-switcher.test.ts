// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-switcher.tsx", import.meta.url), "utf8");

// The IA redesign simplified the switcher to text-only (no glyph).
// When the familiar-studio plan lands FamiliarAvatar, the glyph-resolver
// assertions can be re-added here to verify the menu rows render avatars.
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
  /className="relative min-w-0 flex-1"/,
  "FamiliarSwitcher should fill the available top header row",
);

assert.match(
  source,
  /className=\{triggerClassName\}/,
  "FamiliarSwitcher trigger should use the full-width trigger class",
);

assert.match(
  source,
  /"focus-ring group flex w-full min-w-0 items-center justify-between/,
  "FamiliarSwitcher trigger should stretch full width while preserving text truncation",
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
