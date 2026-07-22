import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// PopoverSubmenu wiring pins — the cascading flyout primitive behind the
// composer "+" menus. Positioning math is behavioral-tested in
// src/lib/submenu-position.test.ts; these pins hold the React/DOM contract.
const src = readFileSync(new URL("./popover.tsx", import.meta.url), "utf8");

test("flyout portals to document.body and reuses the ui-popover shell", () => {
  assert.match(
    src,
    /className="ui-popover ui-popover-submenu"[\s\S]*?document\.body,/,
    "submenu panel is a body portal with the shared panel classes",
  );
  assert.match(src, /computeSubmenuPosition\(/, "positioning delegates to the pure helper");
});

test("trigger row exposes menu semantics and expansion state", () => {
  assert.match(
    src,
    /ui-popover-item ui-popover-subtrigger[\s\S]*?role="menuitem"\s*aria-haspopup="menu"\s*aria-expanded=\{open\}/,
    "subtrigger is a menuitem with aria-haspopup/aria-expanded",
  );
  assert.match(src, /name="ph:caret-right"[\s\S]*?ui-popover-subtrigger__caret/, "trailing caret glyph");
});

test("flyouts register as inside layers so root dismissal ignores them", () => {
  assert.match(src, /const onDocClick = \(e: MouseEvent\) => \{\s*const t = e\.target as Node;\s*if \(layers\.contains\(t\)\) return;/, "outside-click consults the layer registry");
  assert.match(src, /if \(layers\.contains\(next\)\) return;/, "root focus-out consults the layer registry");
  assert.match(src, /return layers\.register\(el\);/, "open flyouts register with the root popover");
});

test("keyboard: ArrowRight/Enter opens focusing first item; ArrowLeft returns to the row", () => {
  assert.match(
    src,
    /e\.key === "ArrowRight" \|\| \(!open && e\.key === "Enter"\)[\s\S]*?setOpen\(true\);\s*focusFirstItem\(\);/,
    "ArrowRight/Enter open + focus first item",
  );
  // focus() on a visibility:hidden subtree is silently ignored, so the focus
  // must be an intent flag consumed AFTER position() flips the panel visible —
  // never a rAF racing the hidden pre-measure pass.
  assert.match(
    src,
    /const focusFirstItem = \(\) => \{\s*wantsFirstItemFocus\.current = true;\s*\};/,
    "focusFirstItem records intent instead of focusing the hidden panel",
  );
  assert.match(
    src,
    /if \(!open \|\| style\.visibility !== "visible" \|\| !wantsFirstItemFocus\.current\) return;/,
    "deferred focus runs only once the panel is positioned and visible",
  );
  assert.match(
    src,
    /if \(e\.key === "ArrowLeft" \|\| e\.key === "Escape"\) \{[\s\S]*?closeToRow\(\);/,
    "ArrowLeft inside the flyout steps back to the trigger row",
  );
});

test("pre-measure pass carries minWidth so flip/clamp math sees the rendered width", () => {
  // Without minWidth the hidden measuring pass falls back to the CSS
  // min-width floor (narrower than the call sites' props), understating
  // panel.offsetWidth and letting first-open placement overflow the viewport.
  assert.match(
    src,
    /setStyle\(\{ visibility: "hidden", minWidth \}\);/,
    "the reset-to-hidden pass keeps the minWidth applied",
  );
  assert.match(
    src,
    /useState<CSSProperties>\(\{ visibility: "hidden", minWidth \}\)/,
    "the initial hidden style carries minWidth too",
  );
});

test("Escape closes one submenu level per press before the root menu", () => {
  assert.match(
    src,
    /const closeDeepest = submenuEscapeStack\[submenuEscapeStack\.length - 1\];\s*if \(closeDeepest\) \{\s*closeDeepest\(\);\s*return;\s*\}\s*onOpenChange\(false\);/,
    "root Escape handler pops the submenu stack first",
  );
  assert.match(src, /submenuEscapeStack\.push\(closeSelf\);/, "open flyouts join the Escape stack");
});

test("hover-intent opens for mouse pointers only, after a delay", () => {
  assert.match(
    src,
    /onPointerEnter=\{\(e\) => \{\s*if \(disabled \|\| e\.pointerType !== "mouse"\) return;[\s\S]*?SUBMENU_HOVER_DELAY\)/,
    "hover open is fine-pointer gated with an intent delay",
  );
});

test("one open flyout per level via the submenu group context", () => {
  assert.match(
    src,
    /const open = group \? group\.openId === id : selfOpen;/,
    "sibling coordination goes through the group's openId",
  );
  assert.match(
    src,
    /<SubmenuGroup>\{children\}<\/SubmenuGroup>/,
    "each flyout provides a fresh group for its children",
  );
});
