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
  /computeQuickSwitch\(familiars, \{ pins, lastUsed, activeId: activeFamiliarId, max, scope: stripScope \}\)/,
  "computes the strip from pins, recency, the active familiar, and the scope preference",
);
assert.match(
  source,
  /useFamiliarStripScope\(\)/,
  "subscribes to the pinned-only / all scope preference",
);

// Each strip entry is a one-tap switch button with an avatar + presence dot.
// A plain tap selects only that familiar; ⌘/Ctrl-click toggles multiselect.
assert.match(
  source,
  /onClick=\{\(e\) => onSelectFamiliar\(f\.id, \{ multi: e\.metaKey \|\| e\.ctrlKey \}\)\}/,
  "tapping a strip avatar scopes to it; ⌘/Ctrl-click toggles it in the multiselect set",
);
// The strip highlights every member of the multiselect scope when supplied.
assert.match(
  source,
  /selectedFamiliarIds\s*\?\s*selectedFamiliarIds\.has\(f\.id\)\s*:\s*f\.id === activeFamiliarId/,
  "strip marks all selected familiars active (falls back to the single active id)",
);
assert.match(source, /<FamiliarAvatar familiar=\{f\} size="sm" \/>/, "renders each familiar's avatar");
// Presence dot and pin badge were removed — the avatar alone carries presence
// context (title text still includes pinned state for accessibility).

// The strip honors the user's preference — "dropdown" hides it, leaving only
// the switcher menu.
assert.match(
  source,
  /useFamiliarSwitcherStyle\(\)/,
  "reads the familiar-switcher style preference",
);
assert.match(
  source,
  /const showStrip = switcherStyle === "avatars" && quick\.length > 1/,
  "the avatar strip only renders in the 'avatars' style with 2+ familiars",
);
assert.match(source, /\{showStrip \? \(/, "the strip render is gated on showStrip");

// The full dropdown appears only when the strip is not accessible. In avatar
// mode the row itself is the familiar selector; in dropdown mode the switcher
// remains the selector.
assert.match(
  source,
  /\{!showStrip \? \([\s\S]*?<FamiliarSwitcher/,
  "renders the FamiliarSwitcher dropdown only when the avatar strip is hidden",
);

// CSS: the strip scrolls horizontally so it never overflows the bar.
assert.match(globals, /\.familiar-quickswitch__strip \{/, "strip has styles");
assert.match(
  globals,
  /\.familiar-quickswitch__strip \{[\s\S]*overflow-x: auto;/,
  "strip scrolls horizontally rather than wrapping/clipping",
);
const activeButtonRule = globals.match(/\.familiar-quickswitch__btn\.is-active \{([\s\S]*?)\}/)?.[1] ?? "";
assert.match(activeButtonRule, /border:\s*2px solid var\(--familiar-accent, var\(--accent-presence\)\);/, "active familiar uses one accent border ring");
assert.doesNotMatch(activeButtonRule, /box-shadow:/, "active familiar must not stack additional shadow rings around the avatar");

console.log("familiar-quick-switch component: all assertions passed");
