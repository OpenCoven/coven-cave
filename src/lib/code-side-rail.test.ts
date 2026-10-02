// @ts-nocheck
import assert from "node:assert/strict";

const {
  CODE_RAIL_DEFAULT_WIDTH_PX,
  CODE_RAIL_MIN_WIDTH_PX,
  CODE_RAIL_RESERVED_PX,
  clampCodeRailWidth,
  toggleCodeRailWidth,
  isCodeRailWide,
  codeRailFileSignature,
  isCodeRailFileViewed,
  toggleCodeRailViewed,
  countCodeRailViewed,
  codeRailDiffBar,
  isCodeRailTab,
  nextUnviewedCodeFile,
  codeRailShapeOf,
  codeChangeSnapshotKey,
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
assert.equal(clampCodeRailWidth(2000, 2400), Math.round(2400 * 0.62));
assert.equal(clampCodeRailWidth(400, 1400), 400);

// The ceiling also leaves the tree and a minimum-width viewer standing
// (#5729): 62% of a 1400px room left the source 260px; the reserve holds it at
// 380px. At the narrowest split the rail cannot grow past its minimum.
assert.equal(CODE_RAIL_RESERVED_PX, 272 + 380);
assert.equal(clampCodeRailWidth(1300, 1400), 1400 - CODE_RAIL_RESERVED_PX);
assert.equal(clampCodeRailWidth(900, 932), CODE_RAIL_MIN_WIDTH_PX);

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

// Where the reserve holds "half" below half the room, the widened rail still
// reads as widened, and the toggle still comes back.
{
  const half = clampCodeRailWidth(600, 1200);
  assert.equal(half, 1200 - CODE_RAIL_RESERVED_PX);
  assert.equal(toggleCodeRailWidth(CODE_RAIL_DEFAULT_WIDTH_PX, 1200), half);
  assert.equal(isCodeRailWide(half, 1200), true);
  assert.equal(toggleCodeRailWidth(half, 1200), CODE_RAIL_DEFAULT_WIDTH_PX);
}

// A room too narrow to widen at all never reports a widened rail.
assert.equal(isCodeRailWide(CODE_RAIL_MIN_WIDTH_PX, 932), false);

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

// ── Next unviewed (#5705) ────────────────────────────────────────────────────
// Starts after the current file, wraps, and is null once everything is viewed.
{
  const files = [
    { path: "a.ts", status: "modified", additions: 1, deletions: 0 },
    { path: "b.ts", status: "modified", additions: 2, deletions: 0 },
    { path: "c.ts", status: "added", additions: 3, deletions: 0 },
  ];
  assert.equal(nextUnviewedCodeFile(files, {}, null)?.path, "a.ts");
  assert.equal(nextUnviewedCodeFile(files, {}, "a.ts")?.path, "b.ts");
  assert.equal(nextUnviewedCodeFile(files, {}, "c.ts")?.path, "a.ts", "wraps past the end");
  let viewed = toggleCodeRailViewed({}, files[1]);
  assert.equal(nextUnviewedCodeFile(files, viewed, "a.ts")?.path, "c.ts", "skips a viewed file");
  viewed = toggleCodeRailViewed(toggleCodeRailViewed(viewed, files[0]), files[2]);
  assert.equal(nextUnviewedCodeFile(files, viewed, "a.ts"), null);
  assert.equal(nextUnviewedCodeFile([], {}, null), null);
  assert.equal(nextUnviewedCodeFile(files, {}, "zzz.ts")?.path, "a.ts", "an unknown current path starts from the top");
}

// ── Honest ticks and one snapshot (#5720 review) ─────────────────────────────
{
  const before = codeRailShapeOf({ path: "a.ts", status: "modified", insertions: 1, deletions: 1, changeVersion: "100:100:20" });
  const rewritten = codeRailShapeOf({ path: "a.ts", status: "modified", insertions: 1, deletions: 1, changeVersion: "200:200:20" });
  const ticked = toggleCodeRailViewed({}, before);
  assert.equal(isCodeRailFileViewed(ticked, before), true);
  assert.equal(isCodeRailFileViewed(ticked, rewritten), false, "a rewrite with the same line counts is a new version");
  const unstamped = { path: "b.ts", status: "added", additions: 2, deletions: 0 };
  assert.equal(codeRailFileSignature(unstamped), "added:2:0", "without a stamp the signature is unchanged");

  const a = [before, codeRailShapeOf({ path: "b.ts", status: "added", insertions: 2 })];
  assert.equal(codeChangeSnapshotKey(a), codeChangeSnapshotKey([...a].reverse()), "order does not matter");
  assert.notEqual(codeChangeSnapshotKey(a), codeChangeSnapshotKey([rewritten, a[1]]), "a new version is a new snapshot");
  assert.notEqual(codeChangeSnapshotKey(a), codeChangeSnapshotKey([before]));
}
