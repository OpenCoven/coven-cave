import assert from "node:assert/strict";
import {
  environmentLabel,
  prRowAction,
  sumFileTotals,
} from "./chat-environment-panel-model.ts";

// The Environment popover's pure model (cave-68vv, #5958). The width gate that
// used to live here went with the floating HUD: the card now opens from the
// composer's branch chip at every width.

// ── environmentLabel ──────────────────────────────────────────────────────────
// Local/unknown runtimes read "Local"; ssh runtimes surface the host.

assert.equal(environmentLabel(null), "Local");
assert.equal(environmentLabel(undefined), "Local");
assert.equal(environmentLabel("local:/Users/x/repo"), "Local");
assert.equal(environmentLabel("ssh:vm-1:/srv/work"), "vm-1");
assert.equal(environmentLabel("ssh:vm-1"), "vm-1");
assert.equal(environmentLabel("garbage"), "Local", "unparseable runtimes fall back to Local");

// ── prRowAction ───────────────────────────────────────────────────────────────
// Only an OPEN PR flips the row to a view link; merged/closed branches offer
// "Create pull request" again (their PR no longer represents outbound work).

assert.deepEqual(prRowAction(null), { kind: "create", label: "Create pull request" });
assert.deepEqual(
  prRowAction({ number: 42, url: "https://github.com/o/r/pull/42", state: "OPEN", isDraft: false }),
  { kind: "view", label: "Pull request #42", url: "https://github.com/o/r/pull/42" },
);
assert.deepEqual(
  prRowAction({ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", isDraft: true }),
  { kind: "view", label: "Pull request #7 · draft", url: "https://github.com/o/r/pull/7" },
);
assert.equal(
  prRowAction({ number: 9, url: "https://github.com/o/r/pull/9", state: "MERGED", isDraft: false }).kind,
  "create",
  "a merged PR is not this branch's outbound work anymore",
);
assert.equal(
  prRowAction({ number: 9, url: "", state: "OPEN", isDraft: false }).kind,
  "create",
  "an OPEN PR without a URL can't be a view link",
);

// ── sumFileTotals ─────────────────────────────────────────────────────────────
// Untracked files carry no numstat counts and simply don't contribute.

assert.deepEqual(sumFileTotals(undefined), { additions: 0, deletions: 0 });
assert.deepEqual(sumFileTotals("nope"), { additions: 0, deletions: 0 });
assert.deepEqual(sumFileTotals([]), { additions: 0, deletions: 0 });
assert.deepEqual(
  sumFileTotals([
    { path: "a.ts", insertions: 10, deletions: 2 },
    { path: "b.ts", insertions: 5 },
    { path: "untracked.ts" },
    null,
    { path: "c.ts", insertions: Number.NaN, deletions: 3 },
  ]),
  { additions: 15, deletions: 5 },
  "missing / NaN counts are skipped, the rest sum",
);

console.log("chat-environment-panel-model.test.ts: ok");
