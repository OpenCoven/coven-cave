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

test("deep-linkable modes hosted by another surface light the host row (cave-s9p6)", () => {
  assert.equal(sidebarRowState("inbox", "calendar"), "active", "calendar renders on Schedules");
  assert.equal(sidebarRowState("board", "familiar-work-queue"), "active", "the Queue is a Tasks-hub tab");
  assert.equal(sidebarRowState("inbox", "flow"), "active", "retired flow remaps to Schedules");
  assert.equal(
    sidebarRowState("surface:code", "code"),
    "active",
    "a code deep link lights the Coding familiar's room row (cave-cc5r)",
  );
  assert.equal(sidebarRowState("github", "github"), "active", "GitHub is standalone again (cave-cc5r)");
});

test("Journal is a Memories tab — the Memories (grimoire) row hosts it", () => {
  // The Journal sidebar row is retired (navHidden): the surface lives as a
  // tab inside Memories, so the Memories row stays lit on either tab, and a
  // "journal" deep-link mode lights the Memories row too.
  assert.equal(
    sidebarRowState("grimoire", "grimoire"),
    "active",
    "Memories row lights for the grimoire mode regardless of tab",
  );
  assert.equal(
    sidebarRowState("grimoire", "journal"),
    "active",
    "a journal deep-link mode lights the Memories row",
  );
});
