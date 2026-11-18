// Contract for scripts/release-train.mjs: where a release stands is derived
// from observable facts, every phase maps to a runbook step and a real
// package script, and the runner can read Git but never tag or push.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PHASES, assertReadOnlyGit, deriveStatus, handoffRecord, tagCommands } from "./release-train.mjs";

const packageScripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const runbook = readFileSync(new URL("../docs/workflows/release-train.md", import.meta.url), "utf8");

const released = {
  localVersion: "0.5.20",
  mainVersion: "0.5.20",
  published: "0.5.20",
  stampPull: null,
  candidateTags: [],
  candidateRun: null,
  finalTag: null,
  acceptanceRecords: 0,
};

test("a published release with no acceptance record points at acceptance", () => {
  const status = deriveStatus(released);
  assert.equal(status.phase, "acceptance");
  assert.match(status.summary, /v0\.5\.20 is published/);
});

test("a published and accepted release points at the next release's preflight", () => {
  assert.equal(deriveStatus({ ...released, acceptanceRecords: 3 }).phase, "preflight");
});

test("a locally stamped version that main does not have yet points at verify", () => {
  const status = deriveStatus({ ...released, localVersion: "0.5.21", stampPull: 6500 });
  assert.equal(status.phase, "verify");
  assert.match(status.summary, /#6500/);
});

test("a stamp merged to main with no candidate tag points at rc", () => {
  const status = deriveStatus({ ...released, localVersion: "0.5.21", mainVersion: "0.5.21" });
  assert.equal(status.phase, "rc");
  assert.match(status.summary, /no release-candidate tag/);
});

test("a failed or running candidate stays at rc; a validated one moves to final", () => {
  const stamped = { ...released, localVersion: "0.5.21", mainVersion: "0.5.21", candidateTags: ["v0.5.21-rc.1"] };
  assert.equal(deriveStatus({ ...stamped, candidateRun: { status: "in_progress", conclusion: null } }).phase, "rc");
  const failed = deriveStatus({ ...stamped, candidateRun: { status: "completed", conclusion: "failure" } });
  assert.equal(failed.phase, "rc");
  assert.match(failed.summary, /rc\.2/);
  assert.equal(deriveStatus({ ...stamped, candidateRun: { status: "completed", conclusion: "success" } }).phase, "final");
});

test("a pushed final tag that is not published yet points at publish-check", () => {
  const status = deriveStatus({
    ...released,
    localVersion: "0.5.21",
    mainVersion: "0.5.21",
    candidateTags: ["v0.5.21-rc.1"],
    candidateRun: { status: "completed", conclusion: "success" },
    finalTag: "abc1234",
  });
  assert.equal(status.phase, "publish-check");
});

test("phases cover runbook steps 1 to 13 in order, with no gap", () => {
  const steps = PHASES.flatMap((phase) => phase.steps);
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13]);
  assert.equal(new Set(PHASES.map((phase) => phase.id)).size, PHASES.length);
});

test("every package script a phase wraps exists", () => {
  for (const phase of PHASES) {
    for (const script of phase.wraps) {
      assert.ok(packageScripts[script], `${phase.id} wraps a missing package script: ${script}`);
    }
  }
  assert.ok(packageScripts["release:train"]);
});

test("the runbook names every phase command and all thirteen steps", () => {
  for (const phase of PHASES) {
    assert.ok(runbook.includes(`pnpm release:train ${phase.id}`), `runbook does not mention phase ${phase.id}`);
  }
  for (let step = 1; step <= 13; step += 1) {
    assert.match(runbook, new RegExp(`^${step}\\. `, "m"), `runbook has no step ${step}`);
  }
});

test("the runner may read Git but refuses to tag, push or commit", () => {
  for (const allowed of ["fetch", "rev-parse", "show", "ls-remote", "status"]) {
    assert.doesNotThrow(() => assertReadOnlyGit([allowed]));
  }
  for (const refused of ["tag", "push", "commit", "merge", "reset"]) {
    assert.throws(() => assertReadOnlyGit([refused, "x"]), /never runs `git/);
  }
});

test("tagCommands prints signed, annotated tags pinned to one commit", () => {
  const candidate = tagCommands({ version: "0.5.21", commit: "abc1234", candidate: 2 });
  assert.deepEqual(candidate, [
    'git tag -s "v0.5.21-rc.2" abc1234 -m "Coven Cave v0.5.21-rc.2"',
    'git push origin "v0.5.21-rc.2"',
  ]);
  assert.match(tagCommands({ version: "0.5.21", commit: "abc1234" })[0], /git tag -s "v0\.5\.21" abc1234/);
});

test("handoffRecord states what is known and marks the rest as not recorded", () => {
  // main has moved on since the release; the record names the tagged commit.
  const record = handoffRecord({ ...released, releaseUrl: "https://example.test/v0.5.20", commit: "ffff000", releaseCommit: "abc1234" });
  assert.match(record, /Version \| 0\.5\.20/);
  assert.match(record, /Promoted commit \| abc1234/);
  assert.match(record, /Acceptance records \| not recorded/);
});
