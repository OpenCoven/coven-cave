import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSubmenuPosition,
  SUBMENU_ALIGN,
  SUBMENU_GAP,
  SUBMENU_MARGIN,
} from "./submenu-position.ts";

const view = { top: 0, left: 0, width: 1200, height: 800 };
const row = { top: 300, left: 400, right: 640, bottom: 332 };

test("opens right of the row, top-aligned, when space allows", () => {
  const pos = computeSubmenuPosition(row, { width: 220, height: 180 }, view);
  assert.equal(pos.side, "right");
  assert.equal(pos.left, row.right + SUBMENU_GAP);
  assert.equal(pos.top, row.top - SUBMENU_ALIGN);
});

test("flips to the left side when the right edge can't fit the panel", () => {
  const nearRight = { top: 300, left: 800, right: 1150, bottom: 332 };
  const pos = computeSubmenuPosition(nearRight, { width: 260, height: 180 }, view);
  assert.equal(pos.side, "left");
  assert.equal(pos.left, nearRight.left - SUBMENU_GAP - 260);
});

test("stays on the right when neither side fits but right has more room", () => {
  const nearLeft = { top: 300, left: 20, right: 260, bottom: 332 };
  const pos = computeSubmenuPosition(nearLeft, { width: 2000, height: 180 }, view);
  assert.equal(pos.side, "right");
  // Clamped inside the viewport on both edges.
  assert.ok(pos.left >= view.left + SUBMENU_MARGIN);
});

test("clamps the left edge inside the viewport after a left flip", () => {
  const nearRight = { top: 300, left: 100, right: 1150, bottom: 332 };
  const pos = computeSubmenuPosition(nearRight, { width: 400, height: 180 }, view);
  assert.ok(pos.left >= view.left + SUBMENU_MARGIN, `left ${pos.left} inside viewport`);
});

test("shifts up when the panel would overflow the bottom, clamped to the top margin", () => {
  const lowRow = { top: 760, left: 400, right: 640, bottom: 792 };
  const pos = computeSubmenuPosition(lowRow, { width: 220, height: 300 }, view);
  assert.equal(pos.top, view.top + view.height - SUBMENU_MARGIN - 300);

  const tall = computeSubmenuPosition(lowRow, { width: 220, height: 900 }, view);
  assert.equal(tall.top, view.top + SUBMENU_MARGIN);
  assert.equal(tall.maxHeight, view.height - 2 * SUBMENU_MARGIN);
});

test("respects visual-viewport offsets (pinch zoom / keyboard band)", () => {
  const vv = { top: 100, left: 50, width: 600, height: 400 };
  const r = { top: 150, left: 100, right: 300, bottom: 182 };
  const pos = computeSubmenuPosition(r, { width: 220, height: 200 }, vv);
  assert.ok(pos.left >= vv.left + SUBMENU_MARGIN);
  assert.ok(pos.left + 220 <= vv.left + vv.width - SUBMENU_MARGIN + 1);
  assert.ok(pos.top >= vv.top + SUBMENU_MARGIN);
});

test("maxHeight never collapses below the 120px floor", () => {
  const tiny = { top: 0, left: 0, width: 320, height: 100 };
  const pos = computeSubmenuPosition(
    { top: 10, left: 10, right: 60, bottom: 42 },
    { width: 200, height: 400 },
    tiny,
  );
  assert.equal(pos.maxHeight, 120);
});
