// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./overflow-menu.tsx", import.meta.url), "utf8");

// The trigger must be a real menu button: aria-haspopup="menu" + aria-expanded
// reflecting open state, with an accessible name required at the type level.
assert.match(src, /ariaLabel: string/, "OverflowMenu requires an accessible name");
assert.match(src, /aria-haspopup="menu"/, "trigger declares the menu popup");
assert.match(src, /aria-expanded=\{open\}/, "trigger reflects open state");

// A menu trigger is not a toggle: IconButton's aria-pressed must be suppressed
// so screen readers don't hear both "pressed" and "expanded" states.
assert.match(
  src,
  /aria-pressed=\{undefined\}/,
  "suppresses IconButton's aria-pressed on the menu trigger",
);

// The body is a real menu (menu > menuitem/menuitemradio hierarchy), reusing the
// shared Popover scaffold so Escape / outside-click / focus-return come for free.
assert.match(src, /role="menu"/, "popover body announces as a menu");
assert.match(src, /from "\.\/popover"/, "reuses the shared Popover scaffold");
assert.match(src, /from "\.\/icon-button"/, "reuses the shared IconButton trigger");

// Selecting any enabled menuitem closes the menu without each consumer wiring
// a close() through onSelect. Disabled items must NOT close it.
assert.match(
  src,
  /closest\?\.\(\s*'\[role="menuitem"\], \[role="menuitemradio"\]',?\s*\)/,
  "auto-closes on menuitem activation",
);
assert.match(src, /!\(item as HTMLButtonElement\)\.disabled/, "disabled items don't close the menu");

// Default glyph is the chrome-action dots (bold weight per icon conventions),
// default placement hugs the trailing edge where overflow triggers live.
assert.match(src, /icon = "ph:dots-three-bold"/, "defaults to the horizontal-dots chrome glyph");
assert.match(src, /placement = "bottom-end"/, "defaults to trailing-edge placement");

console.log("overflow-menu.test.ts: ok");
