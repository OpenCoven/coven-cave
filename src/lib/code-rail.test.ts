import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCodeRail, type CodeRailSignals, type CodeRailState } from "./code-rail.ts";

const base: CodeRailSignals = {
  hasRepo: false, changeCount: 0, terminalActive: false, pinned: false, dismissed: false,
};

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
