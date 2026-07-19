// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./context-menu.tsx", import.meta.url), "utf8");

function sliceBetween(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `missing end token after ${startToken}`);
  return source.slice(start, end + endToken.length);
}

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
const anchorMarkup = sliceBetween(src, "<span", "/>");
assert.doesNotMatch(anchorMarkup, /tabIndex/, "the cursor anchor is not made focusable (avoids the aria-hidden focus conflict)");
const captureHook = sliceBetween(src, "useLayoutEffect(() => {", "}, [open]);");
assert.match(captureHook, /if \(!open\) return;/, "captures only when the context menu is opening");
assert.match(captureHook, /returnFocusRef\.current = document\.activeElement/, "captures the pre-open active element in layout phase");
assert.match(captureHook, /restoreFocusPendingRef\.current = true;/, "marks exactly one pending restore per open cycle");
assert.equal(
  src.includes("useEffect(() => {\n    if (open) returnFocusRef.current = document.activeElement"),
  false,
  "does not capture focus from a passive effect after menu autofocus has already run",
);
const restoreHook = sliceBetween(src, "useEffect(() => {", "}, [open]);");
assert.match(restoreHook, /if \(open\) return;/, "restores only after the context menu closes");
assert.match(restoreHook, /if \(!restoreFocusPendingRef\.current\) return;/, "skips duplicate restores when already closed");
assert.match(restoreHook, /restoreFocusPendingRef\.current = false;/, "consumes the pending restore exactly once");
assert.match(restoreHook, /returnFocusRef\.current = null;/, "clears the stored target after the close pass");
assert.match(restoreHook, /active === document\.body[\s\S]{0,80}el\.focus\(\)/, "restores focus only when close would otherwise strand it on body");
assert.match(src, /function canRestoreFocus\(el: HTMLElement \| null\): el is HTMLElement/, "restoration checks focusability through a dedicated guard");
assert.match(src, /el\.isConnected/, "restoration skips disconnected targets");
assert.match(src, /\[tabindex\]/, "restoration allows invoking rows/projects that are focusable via tabindex");
assert.match(src, /\[disabled\], \[aria-disabled='true'\], \[hidden\], \[inert\]/, "restoration skips disabled or hidden targets");

// The helper preventDefaults the native menu and records the click position.
assert.match(src, /e\.preventDefault\(\)/, "suppresses the browser's native context menu");
assert.match(src, /set\(\{ x: e\.clientX, y: e\.clientY \}\)/, "reports the cursor position");

// The content is a role=menu container (items are role=menuitem via PopoverItem).
assert.match(src, /PopoverBody/, "context menu uses the shared PopoverBody");
assert.match(src, /<PopoverBody[\s\S]*role="menu"[\s\S]*ariaLabel=\{ariaLabel\}/, "menu content has role=menu through the shared body");
assert.match(src, /closeOnSelect\?: boolean/, "context menu can own menu-item auto-close without forcing every caller");
assert.match(src, /const shouldCloseOnSelect = closeOnSelect && Boolean\(activatedMenuItem\(e\.target\)\)/, "enabled menu items can auto-close from the bubbled click path");
assert.match(src, /if \(!next\) onClose\(\)/, "popover state changes still drive controlled closure");

console.log("context-menu.test.ts OK");
