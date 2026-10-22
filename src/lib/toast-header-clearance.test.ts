// @ts-nocheck
import assert from "node:assert/strict";
import {
  TOAST_CLEARANCE_HEADER_SELECTOR,
  TOAST_HEADER_GAP_PX,
  toastHeaderClearance,
} from "./toast-header-clearance.ts";

// #5531 at 1440×900: the stack column is x 1104..1424 and Tasks' header band
// runs the full width under the 34px shell band.
const column = { left: 1104, right: 1424 };
const tasksHeader = { left: 64, right: 1440, top: 34, bottom: 82 };

assert.equal(
  toastHeaderClearance(column, [tasksHeader], 900),
  82 + TOAST_HEADER_GAP_PX,
  "the stack starts below the header that shares its column",
);

assert.equal(
  toastHeaderClearance(column, [tasksHeader, { ...tasksHeader, top: 82, bottom: 131 }], 900),
  131 + TOAST_HEADER_GAP_PX,
  "a wrapped or second header band pushes it lower, to the lowest bottom edge",
);

assert.equal(
  toastHeaderClearance(column, [{ left: 64, right: 700, top: 34, bottom: 82 }], 900),
  null,
  "a header entirely left of the column does not move the stack",
);

assert.equal(
  toastHeaderClearance(column, [{ ...tasksHeader, top: 400, bottom: 448 }], 900),
  null,
  "a header below the top third (a lower pane or split) is not the chrome band",
);

assert.equal(
  toastHeaderClearance(column, [{ ...tasksHeader, top: 34, bottom: 34 }], 900),
  null,
  "a collapsed (hidden) header has no height and is ignored",
);

assert.equal(toastHeaderClearance(column, [], 900), null, "no header, no override");

assert.equal(
  toastHeaderClearance(column, [{ ...tasksHeader, bottom: 81.2 }], 900),
  Math.ceil(81.2 + TOAST_HEADER_GAP_PX),
  "subpixel edges round up so the gap never shrinks below the token",
);

for (const shared of [".ui-surface-toolbar", ".ui-view-header", ".surface-compact-header", ".gh-compact-header", ".grimoire-graph-toolbar"]) {
  assert.ok(TOAST_CLEARANCE_HEADER_SELECTOR.split(", ").includes(shared), `${shared} is measured`);
}

// #6142: phone header wrapping + the daemon banner put Relations below the
// ordinary top-third cutoff. It remains primary chrome, not a lower split.
const phoneColumn = { left: 12, right: 381 };
const phoneToolbar = { left: 0, right: 393, top: 278, bottom: 349 };
assert.equal(toastHeaderClearance(phoneColumn, [phoneToolbar], 727), null,
  "ordinary bands retain the top-third cutoff");
assert.equal(toastHeaderClearance(phoneColumn, [{ ...phoneToolbar, primaryToolbar: true }], 727), 357,
  "the primary Relations toolbar clears a toast below a tall phone header");
assert.equal(toastHeaderClearance(phoneColumn, [{ ...phoneToolbar, top: 400, bottom: 471, primaryToolbar: true }], 727), null,
  "even a primary toolbar in a lower pane cannot push the toast offscreen");

console.log("toast-header-clearance.test.ts: ok");
