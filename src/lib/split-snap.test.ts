import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nearestSnap,
  resolveSplitRelease,
  clampSplitRatio,
  dividerOffset,
  SPLIT_CLOSE_RATIO,
  SPLIT_COLLAPSE_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_SNAP_THRESHOLD,
} from "./split-snap.ts";

test("nearestSnap returns the half point when dragged near the middle", () => {
  const snap = nearestSnap(0.5 + SPLIT_SNAP_THRESHOLD / 2);
  assert.ok(snap);
  assert.equal(snap?.label, "½");
});

test("nearestSnap returns the third points within threshold", () => {
  assert.equal(nearestSnap(1 / 3 + 0.01)?.label, "⅓");
  assert.equal(nearestSnap(2 / 3 - 0.01)?.label, "⅔");
});

test("nearestSnap returns null in free space between snap points", () => {
  // Midway between ⅓ (.333) and ½ (.5) is ~.417 — outside every threshold.
  assert.equal(nearestSnap(0.42), null);
});

test("resolveSplitRelease closes when dragged past the near edge", () => {
  const r = resolveSplitRelease(SPLIT_CLOSE_RATIO - 0.02);
  assert.equal(r.action, "close");
});

test("resolveSplitRelease collapses the primary when dragged past the far edge", () => {
  const r = resolveSplitRelease(SPLIT_COLLAPSE_RATIO + 0.02);
  assert.equal(r.action, "collapse");
});

test("the collapse edge mirrors the close edge (symmetric past-the-edge margins)", () => {
  // The pane panels clamp to 10%/90% min/max. Close fires 0.06 above the 10%
  // floor; collapse fires the same 0.06 below the 90% ceiling.
  const PANEL_MIN = 0.1;
  const closeMargin = SPLIT_CLOSE_RATIO - PANEL_MIN;
  const collapseMargin = SPLIT_MAX_RATIO - SPLIT_COLLAPSE_RATIO;
  assert.ok(Math.abs(closeMargin - collapseMargin) < 1e-9, "close and collapse margins match");
  assert.ok(SPLIT_COLLAPSE_RATIO < SPLIT_MAX_RATIO, "the divider can enter the collapse zone before the max");
});

test("resolveSplitRelease snaps to a clean ratio near a snap point", () => {
  const r = resolveSplitRelease(0.505);
  assert.equal(r.action, "snap");
  if (r.action === "snap") assert.equal(r.ratio, 0.5);
});

test("resolveSplitRelease keeps a freely-chosen size in open space", () => {
  const r = resolveSplitRelease(0.42);
  assert.equal(r.action, "keep");
  if (r.action === "keep") assert.equal(r.ratio, 0.42);
});

test("clampSplitRatio bounds to the usable range", () => {
  assert.equal(clampSplitRatio(0.99), SPLIT_MAX_RATIO);
  assert.equal(clampSplitRatio(0.01), SPLIT_CLOSE_RATIO);
  assert.equal(clampSplitRatio(Number.NaN), 0.5);
});

test("dividerOffset mirrors by side", () => {
  // Secondary on the right occupies the right `ratio`; divider is at 1-ratio.
  assert.equal(dividerOffset(0.3, "right"), 0.7);
  // Secondary on the left occupies the left `ratio`; divider is at ratio.
  assert.equal(dividerOffset(0.3, "left"), 0.3);
});
