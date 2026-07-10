import { test } from "node:test";
import assert from "node:assert/strict";
import { isSplittablePage, PAGE_DRAG_MIME } from "./page-drag.ts";

test("registered standard pages are splittable", () => {
  for (const m of ["chat", "board", "github", "marketplace", "grimoire"]) {
    assert.equal(isSplittablePage(m), true, `${m} should be splittable`);
  }
});

test("every registered navigation class is eligible for drag-to-split", () => {
  for (const m of ["terminal", "journal", "settings", "dashboard", "surface:researcher"]) {
    assert.equal(isSplittablePage(m), true, `${m} should be splittable`);
  }
});

test("unregistered and incomplete dynamic page ids are not splittable", () => {
  assert.equal(isSplittablePage("unknown-page"), false);
  assert.equal(isSplittablePage("surface:"), false);
});

test("the drag MIME is namespaced so other drags don't trip the drop zone", () => {
  assert.match(PAGE_DRAG_MIME, /^application\/x-cave-/);
});
