import { test } from "node:test";
import assert from "node:assert/strict";
import { isSplittablePage, PAGE_DRAG_MIME } from "./page-drag.ts";

test("most pages are splittable", () => {
  for (const m of ["chat", "board", "github", "marketplace"]) {
    assert.equal(isSplittablePage(m), true, `${m} should be splittable`);
  }
});

test("chat aliases stay draggable page ids, so split consumers must canonicalize them", () => {
  assert.equal(isSplittablePage("groupchat"), true);
});

test("terminal is excluded from drag-to-split (heavy PTY surface)", () => {
  assert.equal(isSplittablePage("terminal"), false);
});

test("journal is excluded from drag-to-split (redirects to Settings)", () => {
  assert.equal(isSplittablePage("journal"), false);
});

test("the drag MIME is namespaced so other drags don't trip the drop zone", () => {
  assert.match(PAGE_DRAG_MIME, /^application\/x-cave-/);
});
