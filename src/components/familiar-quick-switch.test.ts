// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// The strip is driven by the pure quick-switch selector + the pin/recency store.
assert.match(
  source,
  /import \{ computeQuickSwitch, QUICK_SWITCH_MAX \} from "@\/lib\/familiar-quick-switch"/,
  "uses the pure computeQuickSwitch selector",
);
assert.match(
  source,
  /useFamiliarPins\(\)[\s\S]*useFamiliarLastUsed\(\)/,
  "subscribes to pins + last-used recency",
);
assert.match(
  source,
  /computeQuickSwitch\(familiars, \{ pins, lastUsed, activeId: activeFamiliarId, max \}\)/,
  "computes the strip from pins, recency, and the active familiar",
);

// Each strip entry is a one-tap switch button with an avatar + presence dot.
assert.match(
  source,
  /onClick=\{\(\) => onSelectFamiliar\(f\.id\)\}/,
  "tapping a strip avatar switches to that familiar",
);
assert.match(source, /<FamiliarAvatar familiar=\{f\} size="sm" \/>/, "renders each familiar's avatar");
assert.match(
  source,
  /className=\{`familiar-quickswitch__presence \$\{presence\.dot\}`\}/,
  "strip avatars carry a presence dot",
);
assert.match(
  source,
  /isPinned \? <span className="familiar-quickswitch__pin"/,
  "pinned familiars show a pin badge in the strip",
);

// The full switcher (full list, pinning, create/manage/reorder) sits beside the
// strip — the strip is a shortcut, not a replacement.
assert.match(source, /<FamiliarSwitcher/, "embeds the full FamiliarSwitcher menu beside the strip");

// CSS: the strip scrolls horizontally so it never overflows the bar.
assert.match(globals, /\.familiar-quickswitch__strip \{/, "strip has styles");
assert.match(
  globals,
  /\.familiar-quickswitch__strip \{[\s\S]*overflow-x: auto;/,
  "strip scrolls horizontally rather than wrapping/clipping",
);
assert.match(globals, /\.familiar-quickswitch__btn\.is-active \{/, "active familiar is ringed in the strip");

console.log("familiar-quick-switch component: all assertions passed");
