// The GitHub card composer's slash palette (cave-076kh). The load-bearing
// property is CAPABILITY GATING: the palette must never offer a command the
// card cannot fire, because every row is one keystroke from a real mutation.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommandTree,
  parseCommand,
  resolveSlash,
  type GhCommandContext,
} from "./gh-card-commands.ts";

const openPr: GhCommandContext = {
  repo: "OpenCoven/coven-cave",
  number: 4034,
  isPull: true,
  state: "open",
  merged: false,
  draft: false,
  checks: { passed: 12, failed: 0, pending: 1, total: 13 },
  unresolvedThreads: 1,
  threadPath: "skills/curator.ts",
  assignable: [{ login: "BunsDev", role: "author" }],
  labelPalette: [
    { name: "skills", applied: true },
    { name: "ready-to-merge", applied: false },
  ],
  familiars: [{ id: "f1", name: "sable" }],
  commitCount: 6,
};

const names = (ctx: GhCommandContext) => buildCommandTree(ctx).map((g) => g.name);

test("an open PR offers the full verb set", () => {
  assert.deepEqual(names(openPr), ["review", "merge", "checks", "thread", "assign", "label", "draft"]);
});

test("a merged PR offers no review, merge or thread commands", () => {
  const merged = names({ ...openPr, merged: true, state: "closed" });
  for (const gone of ["review", "merge"]) assert.ok(!merged.includes(gone), `${gone} must not be offered`);
  // Commenting, assigning and labelling all still work on a merged PR.
  assert.ok(merged.includes("assign") && merged.includes("label"));
});

test("an issue swaps the PR verbs for its own lifecycle command", () => {
  const issue = names({ ...openPr, isPull: false, checks: null, unresolvedThreads: 0 });
  assert.ok(!issue.includes("review") && !issue.includes("merge") && !issue.includes("checks"));
  assert.ok(issue.includes("close"), "an open issue can be closed");
  const closed = names({ ...openPr, isPull: false, state: "closed", checks: null, unresolvedThreads: 0 });
  assert.ok(closed.includes("reopen"), "a closed issue can be reopened");
});

test("no checks means no /checks, no open threads means no /thread", () => {
  const bare = names({ ...openPr, checks: null, unresolvedThreads: 0 });
  assert.ok(!bare.includes("checks"));
  assert.ok(!bare.includes("thread"));
  assert.ok(!names({ ...openPr, checks: { passed: 0, failed: 0, pending: 0, total: 0 } }).includes("checks"));
});

test("no familiar means no /draft — the section it would open does not exist", () => {
  assert.ok(!names({ ...openPr, familiars: [] }).includes("draft"));
});

// ── palette resolution ─────────────────────────────────────────────────────

const tree = buildCommandTree(openPr);

test("prose is never a command", () => {
  for (const prose of ["", "looks good", "see http://x/y", "a / b"]) {
    assert.equal(resolveSlash(prose, tree).active, false, `"${prose}" must stay prose`);
  }
});

test("a bare slash lists every group", () => {
  const s = resolveSlash("/", tree);
  assert.equal(s.active, true);
  assert.equal(s.level, "groups");
  assert.equal(s.rows.length, tree.length);
  assert.equal(s.rows[0].label, "/review");
  assert.equal(s.ghost, "/review ", "Tab completes to the first group plus its space");
  assert.equal(s.rows[0].isGroup, true);
});

test("a prefix filters groups, and an unmatched one says so", () => {
  assert.deepEqual(
    resolveSlash("/me", tree).rows.map((r) => r.label),
    ["/merge"],
  );
  const none = resolveSlash("/zzz", tree);
  assert.equal(none.noMatch, true);
  assert.equal(none.rows.length, 0);
  assert.equal(none.ghost, "", "nothing to autofill when nothing matches");
});

test("a trailing space commits to the group and shows its subcommands", () => {
  const s = resolveSlash("/merge ", tree);
  assert.equal(s.level, "subs");
  assert.equal(s.crumb, "/merge");
  assert.deepEqual(
    s.rows.map((r) => r.label),
    ["--squash", "--merge", "--rebase"],
  );
  assert.equal(s.ghost, "/merge --squash");
  assert.equal(s.rows[0].isGroup, false, "subcommand rows fire; they do not just fill");
  assert.equal(s.rows[0].hint, "default", "an explicit sub hint wins over the ↵ run affordance");
  assert.equal(s.rows[1].hint, "", "only the first row advertises ↵ run");
});

test("subcommands filter on their own prefix, dashes included", () => {
  assert.deepEqual(
    resolveSlash("/merge --r", tree).rows.map((r) => r.label),
    ["--rebase"],
  );
  assert.equal(resolveSlash("/merge --nope", tree).noMatch, true);
});

test("a group name with no trailing space is still the group level", () => {
  // "/merge" alone means the user may still be typing "/mergeX" — do not jump.
  assert.equal(resolveSlash("/merge", tree).level, "groups");
});

// ── decoding ───────────────────────────────────────────────────────────────

test("every merge method decodes to its GitHub merge_method", () => {
  assert.deepEqual(parseCommand("/merge --squash", tree), { kind: "merge", method: "squash" });
  assert.deepEqual(parseCommand("/merge --merge", tree), { kind: "merge", method: "merge" });
  assert.deepEqual(parseCommand("/merge --rebase", tree), { kind: "merge", method: "rebase" });
});

test("review subcommands decode to GitHub review events", () => {
  assert.deepEqual(parseCommand("/review approve", tree), { kind: "review", event: "APPROVE" });
  assert.deepEqual(parseCommand("/review request-changes", tree), { kind: "review", event: "REQUEST_CHANGES" });
  assert.deepEqual(parseCommand("/review comment", tree), { kind: "review", event: "COMMENT" });
});

test("the rest of the tree decodes to its typed action", () => {
  assert.deepEqual(parseCommand("/checks rerun-failed", tree), { kind: "checks", op: "rerun-failed" });
  assert.deepEqual(parseCommand("/thread resolve", tree), { kind: "thread", op: "resolve" });
  assert.deepEqual(parseCommand("/assign BunsDev", tree), { kind: "assign", login: "BunsDev" });
  assert.deepEqual(parseCommand("/label skills", tree), { kind: "label", name: "skills" });
  assert.deepEqual(parseCommand("/draft sable", tree), { kind: "draft", familiar: "sable" });
});

test("a command outside the tree decodes to null rather than firing", () => {
  // This is the guard that keeps the gating meaningful: even if a row were
  // synthesised by hand, an ungated command cannot become an action.
  assert.equal(parseCommand("/merge --squash", buildCommandTree({ ...openPr, merged: true })), null);
  assert.equal(parseCommand("/nope thing", tree), null);
  assert.equal(parseCommand("/merge", tree), null, "a group with no subcommand is not an action");
  assert.equal(parseCommand("/label not-a-label", tree), null);
});

test("issue lifecycle decodes to the state PATCH", () => {
  const issueTree = buildCommandTree({ ...openPr, isPull: false, checks: null, unresolvedThreads: 0 });
  assert.deepEqual(parseCommand("/close confirm", issueTree), { kind: "state", state: "closed" });
});
