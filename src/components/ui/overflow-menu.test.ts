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

// Keyboard-open intent must move focus into the portaled menu after mount.
// Pointer-opened menus retain the existing light-dismiss convention and leave
// focus on the trigger.
assert.match(
  src,
  /e\.key === "Enter"[\s\S]*e\.key === " "[\s\S]*e\.key === "ArrowDown"/,
  "Enter, Space, and ArrowDown mark keyboard-open intent",
);
assert.match(
  src,
  /onPointerDown=[\s\S]{0,120}keyboardOpenRequested\.current = false/,
  "pointer opening does not request menu focus",
);
assert.match(
  src,
  /requestAnimationFrame\(focusFirstEnabledItem\)/,
  "keyboard opening focuses the first enabled menuitem after the portal mounts",
);
assert.match(
  src,
  /ENABLED_MENU_ITEM_SELECTOR[\s\S]*menuitem[\s\S]*:disabled[\s\S]*menuitemradio[\s\S]*:disabled/,
  "focus and navigation target only enabled menuitems",
);

// Once focus is in the menu, arrow keys wrap over enabled items and Home/End
// jump to the boundaries. Escape remains absent here because Popover owns it.
assert.match(src, /"ArrowDown"[\s\S]*"ArrowUp"[\s\S]*"Home"[\s\S]*"End"/, "menu handles standard navigation keys");
assert.match(src, /querySelectorAll<HTMLElement>\(ENABLED_MENU_ITEM_SELECTOR\)/, "navigation skips disabled menuitems");
assert.match(src, /% items\.length/, "arrow-key navigation wraps");
assert.match(src, /items\[nextIndex\]\?\.focus\(\)/, "menu navigation moves DOM focus");

// Selecting any enabled menuitem closes the menu without each consumer wiring
// a close() through onSelect. Disabled items must NOT close it.
assert.match(
  src,
  /closest\?\.\(\s*'\[role="menuitem"\], \[role="menuitemradio"\]',?\s*\)/,
  "auto-closes on menuitem activation",
);
assert.match(src, /!\(item as HTMLButtonElement\)\.disabled/, "disabled items don't close the menu");
assert.ok(
  /item\.getAttribute\("aria-disabled"\) !== "true"/.test(src) &&
    /setOpen\(false\)[\s\S]*?requestAnimationFrame\([\s\S]*?document\.activeElement === document\.body[\s\S]*?triggerRef\.current\?\.focus\(\)/.test(
      src,
    ),
  "enabled item activation restores body focus to the overflow trigger after unmount",
);

// Default glyph is the chrome-action dots (bold weight per icon conventions),
// default placement hugs the trailing edge where overflow triggers live.
assert.match(src, /icon = "ph:dots-three-bold"/, "defaults to the horizontal-dots chrome glyph");
assert.match(src, /placement = "bottom-end"/, "defaults to trailing-edge placement");

console.log("overflow-menu.test.ts: ok");
