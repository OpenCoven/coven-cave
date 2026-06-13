// @ts-nocheck
import assert from "node:assert/strict";

const { statusOf, parsePorcelainZ, parseNumstatZ, planRevert } = await import("./git-changes.ts");

// ── statusOf ────────────────────────────────────────────────────────────────
{
  assert.equal(statusOf("?", "?"), "untracked");
  assert.equal(statusOf(" ", "M"), "modified");
  assert.equal(statusOf("M", " "), "modified");
  assert.equal(statusOf("A", " "), "added");
  assert.equal(statusOf(" ", "A"), "added");
  assert.equal(statusOf("D", " "), "deleted");
  assert.equal(statusOf(" ", "D"), "deleted");
  assert.equal(statusOf("R", " "), "renamed");
  assert.equal(statusOf("C", " "), "renamed");
  // Rename takes precedence over a paired add/delete in the index pair.
  assert.equal(statusOf("R", "D"), "renamed");
}

// ── parsePorcelainZ ──────────────────────────────────────────────────────────
{
  // Mixed statuses, NUL-separated. No trailing renames here.
  const out = " M src/a.ts\0?? new.txt\0 D gone.ts\0A  staged-new.ts\0";
  const files = parsePorcelainZ(out);
  assert.deepEqual(files, [
    { path: "src/a.ts", status: "modified" },
    { path: "new.txt", status: "untracked" },
    { path: "gone.ts", status: "deleted" },
    { path: "staged-new.ts", status: "added" },
  ]);
}
{
  // Rename: the entry is `R...path`, and the ORIGINAL path is the next token.
  // The parser must consume that extra token (not treat it as its own entry).
  const out = "R  new/name.ts\0old/name.ts\0 M after.ts\0";
  const files = parsePorcelainZ(out);
  assert.equal(files.length, 2, "rename must consume the old-path token");
  assert.deepEqual(files[0], { path: "new/name.ts", status: "renamed", renamedFrom: "old/name.ts" });
  assert.deepEqual(files[1], { path: "after.ts", status: "modified" });
}
{
  // Garbage / short tokens are skipped, not crashed on.
  assert.deepEqual(parsePorcelainZ(""), []);
  assert.deepEqual(parsePorcelainZ("\0"), []);
  assert.deepEqual(parsePorcelainZ("xy"), []);
}

// ── parseNumstatZ ────────────────────────────────────────────────────────────
{
  const map = parseNumstatZ("3\t1\tsrc/a.ts\0" + "10\t2\tnew.txt\0");
  assert.deepEqual(map.get("src/a.ts"), { insertions: 3, deletions: 1 });
  assert.deepEqual(map.get("new.txt"), { insertions: 10, deletions: 2 });
}
{
  // Binary files report "-" for both counts and must be skipped.
  const map = parseNumstatZ("-\t-\tasset.png\0");
  assert.equal(map.has("asset.png"), false, "binary files have no numeric counts");
}
{
  // Rename in numstat -z: the path slot is empty, then old + new follow as
  // two more tokens. The new path is what we key on (it matches porcelain).
  const map = parseNumstatZ("5\t2\t\0old/x.ts\0new/x.ts\0" + "1\t0\tafter.ts\0");
  assert.deepEqual(map.get("new/x.ts"), { insertions: 5, deletions: 2 });
  assert.equal(map.has("old/x.ts"), false);
  assert.deepEqual(map.get("after.ts"), { insertions: 1, deletions: 0 }, "tokens after a rename stay aligned");
}

// ── planRevert (the #1/#2 fix) ───────────────────────────────────────────────
{
  // In HEAD → checkout HEAD, regardless of staged/tracked state. This is what
  // fixes the staged-modification bug (revert must match the HEAD-relative diff).
  assert.deepEqual(planRevert({ inHead: true, tracked: true, confirmDelete: false }), { action: "checkout" });
  assert.deepEqual(planRevert({ inHead: true, tracked: true, confirmDelete: true }), { action: "checkout" });
  assert.deepEqual(planRevert({ inHead: true, tracked: false, confirmDelete: false }), { action: "checkout" });

  // Staged-new "added" file (tracked, not in HEAD): reverting deletes it →
  // gated, then `rm`. This is the silent-no-op bug being fixed.
  assert.deepEqual(planRevert({ inHead: false, tracked: true, confirmDelete: false }), { action: "confirm-required" });
  assert.deepEqual(planRevert({ inHead: false, tracked: true, confirmDelete: true }), { action: "rm" });

  // Untracked file: gated, then `clean` (unchanged behavior).
  assert.deepEqual(planRevert({ inHead: false, tracked: false, confirmDelete: false }), { action: "confirm-required" });
  assert.deepEqual(planRevert({ inHead: false, tracked: false, confirmDelete: true }), { action: "clean" });
}

console.log("git-changes.test.ts: all assertions passed");
