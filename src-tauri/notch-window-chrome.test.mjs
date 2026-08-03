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

const src = await readFile(new URL("./src/window_geometry.rs", import.meta.url), "utf8");

// Scope every assertion to the notch builder so a matching call on the
// quick-chat window can't satisfy these by accident.
const notchStart = src.indexOf('NOTCH_WINDOW_LABEL,');
assert.ok(notchStart > 0, "notch window builder not found in window_geometry.rs");
const notch = src.slice(notchStart);

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
