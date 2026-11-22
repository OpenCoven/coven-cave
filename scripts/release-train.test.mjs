// Contract for scripts/release-train.mjs: where a release stands is derived
// from observable facts, every phase maps to a runbook step and a real
// package script, and the runner can read Git but never tag or push.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { blankAcceptanceRecord } from "./release-acceptance.mjs";
import { PHASES, assertReadOnlyGit, deriveStatus, handoffRecord, readAcceptance, tagCommands } from "./release-train.mjs";

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
  acceptance: "not recorded",
};

test("a published release with no acceptance record points at acceptance", () => {
  const status = deriveStatus(released);
  assert.equal(status.phase, "acceptance");
  assert.match(status.summary, /v0\.5\.20 is published/);
});

test("a published and accepted release points at the next release's preflight", () => {
  assert.equal(deriveStatus({ ...released, acceptance: "complete" }).phase, "preflight");
});

test("a published baseline with a failed or unverified record stays at acceptance", () => {
  for (const acceptance of ["failed", "invalid", "incomplete", "unverified"]) {
    assert.equal(deriveStatus({ ...released, acceptance }).phase, "acceptance");
  }
});

test("read the verdict only from the published tag's record and commit", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "train-acceptance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const version = "0.5.22";
  const commit = "a".repeat(40);
  const record = blankAcceptanceRecord(version);
  record.candidate.commit = commit;
  record.artifacts = [{ name: "test.dmg", sha256: "b".repeat(64) }];
  for (const run of record.runs) {
    run.osVersion = "test";
    run.caveVersion = version;
    for (const step of Object.values(run.steps)) step.result = "pass";
  }
  writeFileSync(join(directory, "v0.5.22-rc.1.json"), JSON.stringify(record));
  const verdict = () => readAcceptance(directory, version, commit);
  assert.equal(verdict(), "not recorded");
  const file = join(directory, "v0.5.22.json");
  writeFileSync(file, "{");
  assert.equal(verdict(), "invalid");
  writeFileSync(file, JSON.stringify(record));
  assert.equal(verdict(), "complete");
  assert.equal(readAcceptance(directory, version, "c".repeat(40)), "unverified");
  record.runs[0].steps.attachment = { result: "fail", diagnosticId: "test-1", notes: "Click did not open the attachment." };
  writeFileSync(file, JSON.stringify(record));
  assert.equal(verdict(), "failed");
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
  assert.match(record, /Acceptance \| not recorded/);
});
