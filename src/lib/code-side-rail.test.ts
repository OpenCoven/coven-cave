// @ts-nocheck
import assert from "node:assert/strict";

const {
  CODE_RAIL_DEFAULT_WIDTH_PX,
  CODE_RAIL_MIN_WIDTH_PX,
  clampCodeRailWidth,
  toggleCodeRailWidth,
  isCodeRailWide,
  codeRailFileSignature,
  isCodeRailFileViewed,
  toggleCodeRailViewed,
  countCodeRailViewed,
  codeRailDiffBar,
  isCodeRailTab,
} = await import("./code-side-rail.ts");

// ── Tab vocabulary ───────────────────────────────────────────────────────────

assert.equal(isCodeRailTab("changes"), true);
assert.equal(isCodeRailTab("pr"), true);
// The AFS delta (cave-je2q9) — distinct from the checkout's working tree.
assert.equal(isCodeRailTab("filesystem"), true);
assert.equal(isCodeRailTab("terminal"), false);
assert.equal(isCodeRailTab(null), false);

// ── Width ────────────────────────────────────────────────────────────────────

// A drag is clamped between the minimum readable width and a fraction of the
// room, so the rail can never take the source's place.
assert.equal(clampCodeRailWidth(120, 1400), CODE_RAIL_MIN_WIDTH_PX);
assert.equal(clampCodeRailWidth(1300, 1400), Math.round(1400 * 0.62));
assert.equal(clampCodeRailWidth(400, 1400), 400);

// When the room itself cannot honour the minimum, the minimum still wins:
// returning a sub-minimum width would render a diff nobody can read, which is
// the exact failure the minimum exists to prevent.
assert.equal(clampCodeRailWidth(200, 300), CODE_RAIL_MIN_WIDTH_PX);

// A non-finite width (an interrupted drag) falls back to the resting width
// rather than propagating NaN into a style attribute.
assert.equal(clampCodeRailWidth(Number.NaN, 1400), CODE_RAIL_DEFAULT_WIDTH_PX);

// Double-click swaps between the reading width and half the room, both ways.
{
  const half = clampCodeRailWidth(700, 1400);
  assert.equal(toggleCodeRailWidth(CODE_RAIL_DEFAULT_WIDTH_PX, 1400), half);
  assert.equal(toggleCodeRailWidth(half, 1400), CODE_RAIL_DEFAULT_WIDTH_PX);
  assert.equal(isCodeRailWide(half, 1400), true);
  assert.equal(isCodeRailWide(CODE_RAIL_DEFAULT_WIDTH_PX, 1400), false);
}

// ── Viewed bookkeeping ───────────────────────────────────────────────────────

const fileA = { path: "src/lib/a.ts", status: "M", additions: 4, deletions: 1 };
const fileB = { path: "src/lib/b.ts", status: "A", additions: 9, deletions: 0 };

{
  let viewed = {};
  assert.equal(isCodeRailFileViewed(viewed, fileA), false);
  viewed = toggleCodeRailViewed(viewed, fileA);
  assert.equal(isCodeRailFileViewed(viewed, fileA), true);
  assert.equal(countCodeRailViewed(viewed, [fileA, fileB]), 1);

  // Ticking is per-VERSION, not per-path. A file that changed again after you
  // read it comes back unviewed — "viewed" has to mean "I read this version" or
  // the counter quietly certifies unreviewed code.
  const fileAChanged = { ...fileA, additions: 12 };
  assert.equal(isCodeRailFileViewed(viewed, fileAChanged), false);
  assert.notEqual(codeRailFileSignature(fileA), codeRailFileSignature(fileAChanged));

  // Toggling off clears the entry rather than storing a falsy marker.
  viewed = toggleCodeRailViewed(viewed, fileA);
  assert.deepEqual(viewed, {});
}

// Toggling never mutates the input — the panel holds this in React state.
{
  const before = {};
  const after = toggleCodeRailViewed(before, fileA);
  assert.deepEqual(before, {});
  assert.notEqual(before, after);
}

// ── Diffstat bar ─────────────────────────────────────────────────────────────

assert.deepEqual(codeRailDiffBar(56, 12), { addedPct: 82, removedPct: 18 });
// Segments always sum to 100 so the bar never leaves a sliver of track showing.
{
  const bar = codeRailDiffBar(1, 2);
  assert.equal(bar.addedPct + bar.removedPct, 100);
}
// An empty diff paints nothing rather than a full-width lie.
assert.deepEqual(codeRailDiffBar(0, 0), { addedPct: 0, removedPct: 0 });
assert.deepEqual(codeRailDiffBar(-3, 0), { addedPct: 0, removedPct: 0 });

console.log("code-side-rail: ok");
