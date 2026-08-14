import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source pin for the notch's native macOS window chrome. The notch is a
// persistent always-present pill parked in the menu-bar strip, so two separate
// AppKit traits have to hold — and neither is expressible through Tauri's
// builder, so both live in the objc2 block and are only checkable here until
// someone runs the desktop shell by hand.
//
//   1. Window LEVEL orders it against other windows on the space it is on.
//      NSStatusWindowLevel (25) is what keeps the menu bar from painting over
//      a pill flush with the top edge.
//   2. COLLECTION BEHAVIOR decides whether it exists on other spaces at all.
//      Level says nothing about this: a default-behavior window is pinned to
//      the space it opened on and is hidden outright while another app is
//      fullscreen. That is the "notch went behind the active window" report.
//
// Fixing 2 without 1 (or vice versa) leaves a real user-visible hole, which is
// why they are pinned together rather than in separate assertions elsewhere.

// Trait 2 is not notch-specific. Quick chat is the other always_on_top window
// built here, and it had the identical gap: the pill was fixed while the panel
// it expands from was still pinned to one space and still vanished under a
// fullscreen app. Both are pinned below so neither regresses alone.

const src = await readFile(new URL("./src/window_geometry.rs", import.meta.url), "utf8");

// Scope assertions to the relevant function bodies so a matching call elsewhere
// in window_geometry.rs can't satisfy these by accident.
const FN_MARKER = "pub(super) fn ";
function sliceFn(start) {
  const next = src.indexOf(FN_MARKER, start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const notchStart = src.indexOf("pub(super) fn show_notch_window");
assert.ok(notchStart >= 0, "show_notch_window not found in window_geometry.rs");
const notch = sliceFn(notchStart);

const quickChatStart = src.indexOf("pub(super) fn show_quick_chat_window");
assert.ok(quickChatStart >= 0, "show_quick_chat_window not found in window_geometry.rs");
const quickChat = sliceFn(quickChatStart);

test("the notch sits at NSStatusWindowLevel so the menu bar cannot cover it", () => {
  assert.match(
    notch,
    /setLevel:\s*25isize/,
    "notch must be raised to NSStatusWindowLevel (25); floating level renders under the menu bar",
  );
});

test("the notch joins all spaces and survives another app going fullscreen", () => {
  assert.match(
    notch,
    /CAN_JOIN_ALL_SPACES:\s*usize\s*=\s*1\s*<<\s*0/,
    "canJoinAllSpaces is bit 0 of NSWindowCollectionBehavior",
  );
  assert.match(
    notch,
    /FULL_SCREEN_AUXILIARY:\s*usize\s*=\s*1\s*<<\s*8/,
    "fullScreenAuxiliary is bit 8 of NSWindowCollectionBehavior",
  );
  assert.match(
    notch,
    /setCollectionBehavior:/,
    "the notch must set a collection behavior; the default pins it to one space",
  );
});

test("collection behavior is OR-ed into the existing mask, never assigned", () => {
  // Assigning would silently drop whatever tao configured on the window.
  assert.match(
    notch,
    /let\s+current:\s*usize\s*=\s*msg_send!\[[^\]]*collectionBehavior\]/,
    "read the current mask before modifying it",
  );
  assert.match(
    notch,
    /current\s*\|\s*CAN_JOIN_ALL_SPACES\s*\|\s*FULL_SCREEN_AUXILIARY/,
    "OR the two traits into the current mask rather than overwriting it",
  );
});

test("quick chat joins all spaces and survives another app going fullscreen", () => {
  // Same defect as the notch's trait 2, on the sibling always_on_top window:
  // always_on_top orders the panel only against windows on the space it is
  // already on, so a default collection behavior pins it there and hides it
  // under a fullscreen app.
  assert.match(
    quickChat,
    /CAN_JOIN_ALL_SPACES:\s*usize\s*=\s*1\s*<<\s*0/,
    "canJoinAllSpaces is bit 0 of NSWindowCollectionBehavior",
  );
  assert.match(
    quickChat,
    /FULL_SCREEN_AUXILIARY:\s*usize\s*=\s*1\s*<<\s*8/,
    "fullScreenAuxiliary is bit 8 of NSWindowCollectionBehavior",
  );
  assert.match(
    quickChat,
    /current\s*\|\s*CAN_JOIN_ALL_SPACES\s*\|\s*FULL_SCREEN_AUXILIARY/,
    "OR the traits into the current mask rather than overwriting what tao set",
  );
});

test("quick chat is NOT raised to status level — it is a panel, not a menu-bar resident", () => {
  // The notch needs setLevel 25 because it parks flush with the top edge and
  // the menu bar would otherwise paint over it. Quick chat has no such
  // constraint, and lifting it to status level would put a full chat panel
  // above the menu bar. always_on_top(true) already gives it
  // NSFloatingWindowLevel, which is the correct level; this pins the decision
  // so a later copy-paste of the notch block does not quietly import it.
  assert.doesNotMatch(
    quickChat,
    /setLevel:/,
    "quick chat must keep the floating level always_on_top gives it, not the notch's status level",
  );
});
