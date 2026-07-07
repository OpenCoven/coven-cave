import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebarRowState } from "./sidebar-nav-state.ts";

test("the row matching the primary mode is active", () => {
  assert.equal(sidebarRowState("board", "board"), "active");
  assert.equal(sidebarRowState("home", "board"), "idle");
});

test("switching mode moves the active highlight", () => {
  assert.equal(sidebarRowState("marketplace", "marketplace"), "active");
  assert.equal(sidebarRowState("marketplace", "home"), "idle");
  assert.equal(sidebarRowState("home", "home"), "active");
});

test("Roles/Capabilities keep the Marketplace hub row lit", () => {
  assert.equal(sidebarRowState("marketplace", "roles"), "active");
  assert.equal(sidebarRowState("marketplace", "capabilities"), "active");
});

test("a page open as a split tile gets the split marker, not active", () => {
  // Drag-to-split opens a page beside the primary WITHOUT changing mode —
  // the old row must stay active and the split page must be marked "split".
  assert.equal(sidebarRowState("marketplace", "home", ["marketplace"]), "split");
  assert.equal(sidebarRowState("home", "home", ["marketplace"]), "active");
  assert.equal(sidebarRowState("board", "home", ["marketplace"]), "idle");
});

test("active wins over split when a mode is somehow both", () => {
  // The workspace clears redundant splits, but the derivation stays defensive.
  assert.equal(sidebarRowState("board", "board", ["board"]), "active");
});

test("no split modes provided behaves like an empty list", () => {
  assert.equal(sidebarRowState("board", "home"), "idle");
  assert.equal(sidebarRowState("board", "home", []), "idle");
});
