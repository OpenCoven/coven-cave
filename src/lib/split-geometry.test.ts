import assert from "node:assert/strict";
import { test } from "node:test";
import { halfSplitGeometry, splitPresentation } from "./split-geometry.ts";

test("half geometry consumes every pixel for odd and even host widths", () => {
  for (const hostWidth of [501, 1024, 1279, 1440]) {
    const geometry = halfSplitGeometry(hostWidth, 1);
    assert.ok(Math.abs(geometry.left - geometry.right) <= 1);
    assert.equal(geometry.left + geometry.separator + geometry.right, hostWidth);
  }
});

test("narrow split hosts use tabs independent of viewport width", () => {
  assert.equal(splitPresentation(719), "tabs");
  assert.equal(splitPresentation(720), "panes");
});
