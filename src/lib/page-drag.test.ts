import { test } from "node:test";
import assert from "node:assert/strict";
import { isSplittablePage, PAGE_DRAG_MIME } from "./page-drag.ts";

test("registered pages are splittable", () => {
  for (const m of ["chat", "board", "github", "marketplace", "terminal", "journal", "surface:research-desk"]) {
    assert.equal(isSplittablePage(m), true, `${m} should be splittable`);
  }
});

test("chat aliases stay draggable page ids, so split consumers must canonicalize them", () => {
  assert.equal(isSplittablePage("groupchat"), true);
});

test("unknown ids do not expose a split affordance", () => {
  assert.equal(isSplittablePage("not-a-page"), false);
});

test("the drag MIME is namespaced so other drags don't trip the drop zone", () => {
  assert.match(PAGE_DRAG_MIME, /^application\/x-cave-/);
});
