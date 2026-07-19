// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./context-menu.tsx", import.meta.url), "utf8");

// Built on the shared Popover (inherits Escape / outside-click / focus-return).
assert.match(src, /from "@\/components\/ui\/popover"/, "context menu reuses the Popover primitive");
assert.match(src, /export function ContextMenu/, "exports ContextMenu");
assert.match(src, /export function openContextMenuAt/, "exports the onContextMenu helper");

// State is the cursor position or null when closed; open = state !== null.
assert.match(src, /export type ContextMenuState = \{ x: number; y: number \} \| null/, "state is cursor xy or null");
assert.match(src, /const open = state !== null/, "open derives from a non-null cursor state");

// Anchors to a 0-size element pinned at the cursor so it opens where clicked.
assert.match(src, /position: "fixed", left: state\?\.x[\s\S]{0,60}width: 0, height: 0/, "anchors a 0-size element at the cursor");
// On close, focus returns to the element that had it when the menu opened (the
// right-clicked row) — not the hidden anchor or <body>. The anchor stays
// non-focusable aria-hidden (no focusable + aria-hidden conflict).
assert.doesNotMatch(src, /tabIndex/, "the cursor anchor is not made focusable (avoids the aria-hidden focus conflict)");
assert.match(src, /returnFocusRef\.current = document\.activeElement/, "captures the focused element when the menu opens");
assert.match(src, /document\.contains\(el\)[\s\S]{0,120}?el\.focus\(\)/, "restores focus to that element on close if it's still in the DOM");

// The helper preventDefaults the native menu and records the click position.
assert.match(src, /e\.preventDefault\(\)/, "suppresses the browser's native context menu");
assert.match(src, /set\(\{ x: e\.clientX, y: e\.clientY \}\)/, "reports the cursor position");

// The content is a role=menu container (items are role=menuitem via PopoverItem).
assert.match(src, /PopoverBody/, "context menu uses the shared PopoverBody");
assert.match(src, /<PopoverBody[\s\S]*role="menu"[\s\S]*ariaLabel=\{ariaLabel\}/, "menu content has role=menu through the shared body");
assert.match(src, /closeOnSelect\?: boolean/, "context menu can own menu-item auto-close without forcing every caller");
assert.match(src, /const shouldCloseOnSelect = closeOnSelect && Boolean\(activatedMenuItem\(e\.target\)\)/, "enabled menu items can auto-close from the bubbled click path");
assert.match(src, /if \(!next\) onClose\(\)/, "popover state changes still drive controlled closure");
assert.match(src, /active === document\.body[\s\S]{0,80}el\.focus\(\)/, "controlled closure restores focus once only when it would otherwise be lost");

console.log("context-menu.test.ts OK");
