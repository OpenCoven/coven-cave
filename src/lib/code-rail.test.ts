import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCodeRail, codeRailChangeSignature, hasNewCodeRailChanges, type CodeRailSignals, type CodeRailState } from "./code-rail.ts";

const base: CodeRailSignals = {
  hasRepo: false, changeCount: 0, terminalActive: false, pinned: false, dismissed: false,
};

test("inline chat opts into nudging without reopening or changing the selected tab", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "files", changeCount: 0 };
  const next = resolveCodeRail({ ...base, hasRepo: true, dismissed: true, changeCount: 2, autoRevealChanges: false }, prev);
  assert.equal(next.open, false);
  assert.equal(next.activeTab, "files");
  assert.equal(resolveCodeRail({ ...base, hasRepo: true, pinned: true, autoRevealChanges: false }, prev).open, true);
});

test("new-change signatures ignore first load and ordering, but detect edits at the same file count", () => {
  const a = { path: "a.ts", status: "modified", insertions: 1 };
  const b = { path: "b.ts", status: "added", insertions: 2 };
  const original = codeRailChangeSignature([a, b]);
  assert.equal(hasNewCodeRailChanges(null, original), false, "loading existing dirt is not new work");
  assert.equal(hasNewCodeRailChanges(original, codeRailChangeSignature([b, a])), false, "unchanged polls/order do not pulse");
  assert.equal(hasNewCodeRailChanges(original, codeRailChangeSignature([{ ...a, insertions: 3 }, b])), true);
  assert.equal(hasNewCodeRailChanges(original, codeRailChangeSignature([{ ...a, path: "c.ts" }, b])), true);
  assert.equal(hasNewCodeRailChanges(original, codeRailChangeSignature([])), false, "committing/clearing does not pulse");
  assert.equal(hasNewCodeRailChanges("[]", original), true);
  assert.equal(hasNewCodeRailChanges(
    codeRailChangeSignature([{ ...a, changeVersion: "1:1:10" }]),
    codeRailChangeSignature([{ ...a, changeVersion: "2:2:10" }]),
  ), true, "same-size edits with identical diffstats are still new changes");
});

test("plain chat → not available, closed", () => {
  const r = resolveCodeRail(base, null);
  assert.equal(r.available, false);
  assert.equal(r.open, false);
});

test("repo session, idle → available, open to Files", () => {
  const r = resolveCodeRail({ ...base, hasRepo: true }, null);
  assert.equal(r.available, true);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "files");
});

test("new AI edits (0→N) → open to Changes with the count", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 3 }, prev);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "changes");
});

// Closed-by-default (cave-xsq.7): only a genuinely OBSERVED 0→N transition is a
// fresh batch. Pre-existing repo dirt arriving with the FIRST count load — the
// previous tick saw null (unknown), not a real zero — must not pop the rail.
test("first count load on a dirty repo does NOT auto-reveal (null → N is not a fresh batch)", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "files", changeCount: null };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 12, dismissed: true }, prev);
  assert.equal(r.available, true);
  assert.equal(r.open, false, "pre-existing dirt stays closed — it isn't new agent edits");
  assert.equal(r.activeTab, "files");
});

test("first render (prev = null) with a nonzero count does not auto-reveal either", () => {
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 5, dismissed: true }, null);
  assert.equal(r.open, false, "no observed transition yet — nothing is 'fresh'");
});

test("unknown count (null) still counts the repo for availability, echoes null", () => {
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: null }, null);
  assert.equal(r.available, true);
  assert.equal(r.changeCount, null, "null echoes so the next tick can tell unknown from a real zero");
});

test("new AI edits re-reveal even after a manual collapse", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 2, dismissed: true }, prev);
  assert.equal(r.open, true, "a fresh edit batch overrides dismissal");
  assert.equal(r.activeTab, "changes");
});

test("dismissed with no new edits → stays closed but available", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 2 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 2, dismissed: true }, prev);
  assert.equal(r.available, true);
  assert.equal(r.open, false);
});

test("pinned → open even when dismissed, keeps last tab", () => {
  const prev: CodeRailState = { available: true, open: false, activeTab: "terminal", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, pinned: true, dismissed: true }, prev);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "terminal");
});

test("reason clears (no repo/changes/terminal) and not pinned → auto-hide", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "changes", changeCount: 1 };
  const r = resolveCodeRail(base, prev);
  assert.equal(r.available, false);
  assert.equal(r.open, false);
});

test("terminal alone makes it available", () => {
  const r = resolveCodeRail({ ...base, terminalActive: true }, null);
  assert.equal(r.available, true);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "terminal");
});

test("activeTab persists when no signals change", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "changes", changeCount: 2 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 2 }, prev);
  assert.equal(r.activeTab, "changes");
});

// cave-z44: browsing another project's files must NOT be hijacked by that
// project's pre-existing working-tree changes (which look like a 0→N batch).
test("browse peek: existing changes do not auto-reveal Changes (stays on Files)", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 5, browseActive: true }, prev);
  assert.equal(r.available, true);
  assert.equal(r.open, true);
  assert.equal(r.activeTab, "files", "the browse keeps the Files tab despite a fresh non-zero count");
});

test("browse peek off: the same 0→N transition still reveals Changes", () => {
  const prev: CodeRailState = { available: true, open: true, activeTab: "files", changeCount: 0 };
  const r = resolveCodeRail({ ...base, hasRepo: true, changeCount: 5 }, prev);
  assert.equal(r.activeTab, "changes", "without a browse the reveal behavior is unchanged");
});
