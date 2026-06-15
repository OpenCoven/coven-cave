// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /top-bar__brand/,
  "Brand mark is removed from the top bar (sidebar carries identity)",
);

assert.doesNotMatch(
  source,
  /top-bar__home-btn/,
  "Home button is removed from the top bar (sidebar has Home)",
);

assert.doesNotMatch(
  source,
  /top-bar__crumb/,
  "Breadcrumb is removed (surfaceLabel/subContext no longer rendered)",
);

assert.doesNotMatch(
  source,
  /surfaceLabel|subContext/,
  "TopBar no longer references surfaceLabel/subContext",
);

assert.doesNotMatch(
  source,
  /ph:gear-six/,
  "Standalone gear button is replaced by the account avatar",
);

assert.match(
  source,
  /top-bar__search/,
  "Search button is retained (now centered)",
);

assert.match(
  source,
  /<NotificationBell\b/,
  "NotificationBell is retained in the right cluster",
);

assert.match(
  source,
  /top-bar__account/,
  "Account avatar replaces the standalone settings/gear button",
);

assert.match(
  source,
  /top-bar__mobile-toggle[\s\S]*onToggleNav/,
  "Mobile nav drawer toggle is preserved",
);

assert.match(
  source,
  /top-bar__mobile-handoff/,
  "Mobile handoff (open on phone) button is preserved",
);

// Active-familiar switcher box: a button showing the current familiar that opens
// a Popover picker (desktop + mobile). Gated on a display familiar (active, or first option as fallback).
assert.match(
  source,
  /className="top-bar__familiar"[\s\S]*aria-haspopup="listbox"/,
  "Top bar renders a familiar switcher box that opens a listbox picker",
);
assert.match(
  source,
  /<FamiliarAvatar familiar=\{displayFamiliar\}/,
  "Switcher box shows the active familiar's avatar",
);
assert.match(
  source,
  /<Popover[\s\S]*anchorRef=\{familiarBoxRef\}/,
  "Picker uses the shared Popover anchored to the switcher box",
);
assert.match(
  source,
  /role="option"[\s\S]*onSelectFamiliar\?\.\(option\.id\)/,
  "Picking a familiar option calls onSelectFamiliar with its id",
);
assert.match(
  source,
  /const showFamiliarSwitcher = Boolean\(onSelectFamiliar && displayFamiliar\)/,
  "Switcher only renders when wired with a selection handler + active familiar",
);

console.log("top-bar.test.ts: ok");
