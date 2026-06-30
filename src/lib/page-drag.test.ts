import { test } from "node:test";
import assert from "node:assert/strict";
import { isSplittablePage, PAGE_DRAG_MIME } from "./page-drag.ts";

test("most pages are splittable", () => {
  for (const m of ["chat", "board", "library", "journal", "github", "evals", "marketplace"]) {
    assert.equal(isSplittablePage(m), true, `${m} should be splittable`);
  }
});

test("terminal is excluded from drag-to-split (heavy PTY surface)", () => {
  assert.equal(isSplittablePage("terminal"), false);
});

test("the drag MIME is namespaced so other drags don't trip the drop zone", () => {
  assert.match(PAGE_DRAG_MIME, /^application\/x-cave-/);
});
