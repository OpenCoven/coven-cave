import assert from "node:assert/strict";
import { MIN_BRANCH_VISIBLE, truncateBranch } from "./truncate-middle.ts";

// ── Branch ────────────────────────────────────────────────────────────────────
// The handoff's own worked example (spec §3), which is also the branch its
// opening diagnosis shows end-truncated into uselessness.
assert.equal(
  truncateBranch("fix/cave-9jt60-revert-windows-acl"),
  "fix/cave-9…windows-acl",
  "keeps the class prefix and the subject; drops the middle",
);
assert.equal(
  truncateBranch("fix/cave-9jt60-revert-windows-acl").length,
  MIN_BRANCH_VISIBLE,
  "the spec's 22-visible-character floor is exactly met",
);
assert.ok(
  !truncateBranch("fix/cave-9jt60-revert-windows-acl").includes("…-"),
  "a separator is never left stranded against the ellipsis",
);

// Short branches are returned whole — truncation must never lengthen.
for (const branch of ["main", "fix/a", "feat/short-one", ""]) {
  assert.equal(truncateBranch(branch), branch, `short branch untouched: ${branch || "(empty)"}`);
}
assert.equal(truncateBranch("  main  "), "main", "trims surrounding whitespace");

// No slash: same head/tail budget, no phantom prefix.
assert.equal(truncateBranch("cave-9jt60-revert-windows-acl"), "cave-9…windows-acl");

// Two branches sharing a long prefix stay distinguishable — the failure mode
// that end truncation produces and this function exists to prevent.
const a = truncateBranch("fix/cave-9jt60-revert-windows-acl");
const b = truncateBranch("fix/cave-9jt60-revert-darwin-boot");
assert.notEqual(a, b, "same-prefix branches do not collapse to one string");

console.log("truncate-middle.test.ts: ok");
