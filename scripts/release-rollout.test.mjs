// @ts-nocheck
// cave-udcn7 — staged rollout gate and rollback drill.
//
// Two properties carry the acceptance criteria and are worth stating plainly,
// because everything else here is detail around them:
//
//   1. A rollout may not begin without acceptance and a proven way back.
//   2. Crash, auth, duplicate-send, and data-integrity regressions stop it,
//      while merely-missing data holds it. Absent evidence must never read as
//      evidence of absence in either direction.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CANARIES,
  DEFAULT_THRESHOLDS,
  FORBIDDEN_RESTORE_OPERATIONS,
  HARD_STOP_CLASSES,
  ROLLOUT_STAGES,
  assertBoundedRestore,
  evaluateRolloutGate,
  formatGateReport,
  nextStageId,
  planRollbackRestore,
  runCli,
  stageById,
} from "./release-rollout.mjs";

function greenState(overrides = {}) {
  return {
    candidate: { version: "1.0.0", tag: "v1.0.0" },
    stage: "stable-5",
    observedHours: 25,
    acceptance: { status: "complete" },
    rollbackReadiness: {
      ready: true,
      baselineVersion: "0.9.4",
      baseline: { version: "0.9.4", tag: "v0.9.4" },
      blockers: [],
    },
    metrics: {
      crashFreeLaunchRate: 0.999,
      pairingSuccessRate: 0.995,
      duplicateSendCount: 0,
      dataIntegrityFailures: 0,
      canaries: Object.fromEntries(CANARIES.map((canary) => [canary, "pass"])),
    },
    regressions: [],
    ...overrides,
  };
}

const detailsOf = (result) => result.reasons.map((reason) => reason.detail).join("\n");

// ── stage table ───────────────────────────────────────────────────────────────

test("stages widen monotonically and the manual ones distribute nothing", () => {
  const percentages = ROLLOUT_STAGES.map((stage) => stage.percentage);
  assert.deepEqual(
    [...percentages].sort((a, b) => a - b),
    percentages,
    "a stage that narrows the audience would make 'advance' meaningless",
  );
  assert.equal(
    new Set(ROLLOUT_STAGES.map((stage) => stage.id)).size,
    ROLLOUT_STAGES.length,
    "stage ids address a stage, so they have to be unique",
  );
  for (const stage of ROLLOUT_STAGES.filter((entry) => entry.distribution === "manual")) {
    assert.equal(stage.percentage, 0, `${stage.id} is manual-check only: no broad automatic update exists yet`);
  }
  assert.equal(nextStageId("stable-100"), null, "the last stage has nowhere further to go");
  assert.equal(nextStageId("stable-5"), "stable-25", "advancing moves exactly one stage");
  assert.equal(stageById("nope"), null, "an unknown id resolves to nothing rather than the first stage");
});

// ── the restore plan (the drill) ──────────────────────────────────────────────

test("the restore plan mutates exactly one thing, and never release history", () => {
  const plan = planRollbackRestore({ version: "0.9.4", tag: "v0.9.4" });
  assert.deepEqual(
    plan.filter((step) => step.mutates).map((step) => step.id),
    ["republish-baseline-manifest"],
    "restoring metadata rewrites latest.json and nothing else",
  );
  assert.equal(plan[0].mutates, false, "artifacts are verified before anything is republished");
  assert.match(plan[0].detail, /v0\.9\.4/, "the plan names the baseline it would restore, not a placeholder");
  assert.deepEqual(assertBoundedRestore(plan), plan, "the sanctioned plan passes its own guard");
});

test("every forbidden restore operation is refused", () => {
  for (const type of FORBIDDEN_RESTORE_OPERATIONS) {
    assert.throws(
      () => assertBoundedRestore([{ id: "x", type }]),
      /forbidden/,
      `${type} mutates published history; a rollback that needs it is not bounded`,
    );
  }
  assert.throws(() => assertBoundedRestore("not-a-plan"), /must be an array/, "a malformed plan is not silently allowed");
});

// ── the gate ──────────────────────────────────────────────────────────────────

test("a green stage past its observation window advances", () => {
  const result = evaluateRolloutGate(greenState());
  assert.deepEqual(result.reasons, [], "nothing should be holding this rollout");
  assert.equal(result.decision, "advance", "green canaries, met thresholds, and an elapsed window mean widen");
  assert.equal(result.nextStage, "stable-25", "advancing names where it goes");
});

test("each hard-stop class rolls the release back", () => {
  for (const regressionClass of HARD_STOP_CLASSES) {
    const result = evaluateRolloutGate(
      greenState({ regressions: [{ class: regressionClass, id: `diag-${regressionClass}` }] }),
    );
    assert.equal(
      result.decision,
      "rollback",
      `${regressionClass} is named in the acceptance criteria as stopping rollout`,
    );
    assert.equal(result.rollbackTarget, "0.9.4", "the decision carries the version to restore");
  }
});

test("threshold breaches map onto the class they belong to", () => {
  const cases = [
    [{ crashFreeLaunchRate: 0.9 }, "crash"],
    [{ pairingSuccessRate: 0.5 }, "auth"],
    [{ duplicateSendCount: 1 }, "duplicate-send"],
    [{ dataIntegrityFailures: 1 }, "data-integrity"],
  ];
  for (const [metrics, expectedClass] of cases) {
    const state = greenState();
    Object.assign(state.metrics, metrics);
    const result = evaluateRolloutGate(state);
    assert.equal(result.decision, "rollback", `a breach of ${expectedClass} is a regression, not a pause`);
    assert.ok(
      result.reasons.some((reason) => reason.class === expectedClass),
      `the reason is classified as ${expectedClass} so the drill knows why it is rolling back`,
    );
  }
});

test("an unmeasured metric holds rather than advancing or rolling back", () => {
  const state = greenState();
  delete state.metrics.crashFreeLaunchRate;
  const result = evaluateRolloutGate(state);
  assert.equal(result.decision, "hold", "absent data is not evidence of health, and not evidence of harm either");
  assert.match(detailsOf(result), /not measured/, "the gap is named");
  assert.equal(result.nextStage, "stable-5", "a hold stays where it is");
});

test("a failing canary or a short window holds the current stage", () => {
  const canaryState = greenState();
  canaryState.metrics.canaries.resume = "fail";
  assert.equal(
    evaluateRolloutGate(canaryState).decision,
    "hold",
    "a functional canary pauses expansion without reversing what shipped",
  );

  const early = evaluateRolloutGate(greenState({ observedHours: 1 }));
  assert.equal(early.decision, "hold", "the observation window is the point of a staged rollout");
  assert.match(detailsOf(early), /24h/, "the report states the window it wants");

  assert.equal(
    evaluateRolloutGate(greenState({ observedHours: undefined })).decision,
    "hold",
    "an unrecorded window is not an elapsed one",
  );
});

test("rollout may not start before acceptance and rollback readiness are proven", () => {
  assert.equal(
    evaluateRolloutGate(greenState({ acceptance: { status: "incomplete" } })).decision,
    "hold",
    "three-OS acceptance is a precondition of the first stage",
  );
  assert.equal(
    evaluateRolloutGate(greenState({ acceptance: undefined })).decision,
    "hold",
    "acceptance nobody recorded is not acceptance that passed",
  );
  assert.equal(
    evaluateRolloutGate(greenState({ acceptance: { status: "failed" } })).decision,
    "rollback",
    "a failed acceptance means the candidate must not become the served update",
  );

  const noWayBack = evaluateRolloutGate(greenState({ rollbackReadiness: { ready: false, blockers: ["no baseline"] } }));
  assert.equal(noWayBack.decision, "hold", "prior artifacts and rollback metadata are verified BEFORE rollout");
  assert.equal(noWayBack.rollbackReady, false, "the gate reports the readiness it was handed");
  assert.match(detailsOf(noWayBack), /no baseline/, "the upstream gate's blockers are quoted rather than swallowed");
});

test("rollback readiness must be asserted, not merely unmentioned", () => {
  const result = evaluateRolloutGate(greenState({ rollbackReadiness: undefined }));
  assert.equal(result.decision, "hold", "a missing verdict fails closed; silence is not proof of a way back");
});

test("an unclassified regression holds instead of being ignored", () => {
  const result = evaluateRolloutGate(greenState({ regressions: [{ class: "ui-polish", id: "diag-9" }] }));
  assert.equal(result.decision, "hold", "an unrecognized class is a classification gap, not a clean bill of health");
  assert.match(detailsOf(result), /classify it/, "the operator is told what to do");
});

test("rollback outranks hold when both apply", () => {
  const result = evaluateRolloutGate(greenState({ observedHours: 0, regressions: [{ class: "auth", id: "diag-1" }] }));
  assert.equal(result.decision, "rollback", "a regression decides the outcome even when other reasons also apply");
  assert.ok(
    result.reasons.some((reason) => reason.severity === "hold"),
    "the lesser reasons still print, so the operator sees the whole picture",
  );
});

test("an unknown stage is a usage error rather than a silent pass", () => {
  assert.throws(
    () => evaluateRolloutGate(greenState({ stage: "everyone" })),
    /unknown rollout stage/,
    "an unrecognized stage must not be treated as the final one",
  );
  assert.throws(() => evaluateRolloutGate("nope"), /must be a JSON object/, "a malformed state is not a green light");
});

test("thresholds are overridable but default to the documented values", () => {
  assert.equal(DEFAULT_THRESHOLDS.maxDuplicateSends, 0, "one duplicate send is one too many");
  assert.equal(DEFAULT_THRESHOLDS.maxDataIntegrityFailures, 0, "data integrity has no acceptable failure rate");

  const state = greenState({ thresholds: { minCrashFreeLaunchRate: 0.5 } });
  state.metrics.crashFreeLaunchRate = 0.6;
  assert.equal(
    evaluateRolloutGate(state).decision,
    "advance",
    "an explicit threshold override is honored so a drill can exercise the path",
  );
});

// ── CLI ───────────────────────────────────────────────────────────────────────

test("the CLI reports stages, the gate decision, and the restore plan", () => {
  const lines = [];
  const log = (line) => lines.push(line);

  assert.equal(runCli({ argv: ["stages"], log }), 0, "listing stages needs no input file");
  assert.equal(lines.length, ROLLOUT_STAGES.length, "every stage is printed");

  assert.equal(
    runCli({ argv: ["gate", "state.json"], readFileImpl: () => JSON.stringify(greenState()), log }),
    0,
    "an advancing gate exits 0 so a workflow can branch on it",
  );
  assert.equal(
    runCli({ argv: ["gate", "state.json"], readFileImpl: () => JSON.stringify(greenState({ observedHours: 0 })), log }),
    1,
    "a hold exits non-zero: no automation should widen a rollout on it",
  );
  assert.equal(
    runCli({ argv: ["restore-plan", "state.json"], readFileImpl: () => JSON.stringify(greenState()), log }),
    0,
    "the drill can be printed without a live release",
  );
  assert.throws(() => runCli({ argv: ["gate"], log }), /usage/, "a missing state file is a usage error");
  assert.throws(
    () => runCli({ argv: ["gate", "missing.json"], readFileImpl: () => "{" , log }),
    /could not read rollout state/,
    "an unreadable state file names the file rather than surfacing a bare parse error",
  );
  assert.throws(() => runCli({ argv: ["nonsense"], log }), /usage/, "an unknown command prints usage");
});

test("the gate report leads with the decision", () => {
  const report = formatGateReport(evaluateRolloutGate(greenState({ observedHours: 0 })));
  assert.match(report, /^decision: hold/, "the first line answers the only question the operator asked");
});
