// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const { projectFolderBlockerRef, projectFolderBlockerLabel, projectFolderConfirmedEvidence } = await import(
  new URL("./task-launch-blockers.ts", import.meta.url).href
);

test("the folder blocker is keyed by project so one confirmation clears every task", () => {
  assert.equal(projectFolderBlockerRef("N94C2pFgDH"), "project-folder:N94C2pFgDH");
  assert.notEqual(projectFolderBlockerRef("a"), projectFolderBlockerRef("b"));
});

test("the blocker and its evidence name the project in plain words", () => {
  assert.equal(projectFolderBlockerLabel("Nova"), "Confirm Nova’s project folder so this task can start");
  assert.equal(projectFolderBlockerLabel("  "), "Confirm this project’s project folder so this task can start");
  assert.equal(projectFolderConfirmedEvidence("Nova", "2026-11-22T16:00:00.000Z"), "Nova’s folder was confirmed at 2026-11-22T16:00:00.000Z");
});
