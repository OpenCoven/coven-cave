// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_FAMILIAR_SWITCHER_STYLE,
  FAMILIAR_SWITCHER_STYLE_LABELS,
  FAMILIAR_SWITCHER_STYLE_OPTIONS,
  normalizeFamiliarSwitcherStyle,
} from "./familiar-switcher-style.ts";

// The two styles the top-bar control toggles between.
assert.deepEqual([...FAMILIAR_SWITCHER_STYLE_OPTIONS], ["avatars", "dropdown"], "exactly two styles");
assert.equal(DEFAULT_FAMILIAR_SWITCHER_STYLE, "avatars", "default is the avatar quick-switch strip");

// Every option has a human label.
for (const option of FAMILIAR_SWITCHER_STYLE_OPTIONS) {
  assert.equal(typeof FAMILIAR_SWITCHER_STYLE_LABELS[option], "string", `label for ${option}`);
}

// normalize accepts known values and falls back to the default for anything else.
assert.equal(normalizeFamiliarSwitcherStyle("avatars"), "avatars");
assert.equal(normalizeFamiliarSwitcherStyle("dropdown"), "dropdown");
assert.equal(normalizeFamiliarSwitcherStyle("bogus"), DEFAULT_FAMILIAR_SWITCHER_STYLE, "unknown → default");
assert.equal(normalizeFamiliarSwitcherStyle(null), DEFAULT_FAMILIAR_SWITCHER_STYLE, "null → default");
assert.equal(normalizeFamiliarSwitcherStyle(undefined), DEFAULT_FAMILIAR_SWITCHER_STYLE, "undefined → default");

console.log("familiar-switcher-style: all assertions passed");
