#!/usr/bin/env node
// cave-udcn7 — staged rollout gate and rollback drill (Chat v1 Phase 7, Task 13).
//
//   node scripts/release-rollout.mjs stages
//   node scripts/release-rollout.mjs gate <state.json>
//   node scripts/release-rollout.mjs restore-plan <state.json>
//
// A release that has shipped a tag has not been rolled out. This decides
// whether it may widen its audience, returning exactly one of:
//
//   advance  — widen to the next stage.
//   hold     — stay at this stage; what shipped stays shipped.
//   rollback — the candidate must not be, or must cease to be, the served
//              update. Before any stage has distributed it that reads as "do
//              not ship"; after one, as "restore the prior metadata".
//
// The severity split is the substance here, so it is stated once rather than
// per-rule: a HARD-STOP class (crash, auth, duplicate-send, data-integrity) is
// user-visible or data-affecting and means the release goes BACK. Everything
// else — an unmet observation window, a failing functional canary, acceptance
// evidence that is merely incomplete, a metric nobody measured — means the
// release STAYS PUT. Absent data never advances a rollout and never triggers a
// rollback: it holds.
//
// SCOPE. Two neighbouring questions are deliberately not answered here:
//   - "is the prior release a usable rollback target?" belongs to the release
//     workflow's rollback-readiness gate, which resolves the baseline against
//     live release history. This gate consumes its verdict
//     (`state.rollbackReadiness`) rather than re-deriving it.
//   - "did the three-OS acceptance journey pass?" belongs to
//     scripts/release-acceptance.mjs, whose summary lands in
//     `state.acceptance`.
// Both are preconditions this gate refuses to advance without.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Stages run in order. `percentage` is the share of installs offered the
// update automatically; the two manual stages deliberately sit at 0 so no
// broad automatic update exists before the stable stages.
export const ROLLOUT_STAGES = [
  { id: "maintainer", percentage: 0, distribution: "manual", minObservationHours: 24 },
  { id: "private-beta", percentage: 0, distribution: "manual", minObservationHours: 48 },
  { id: "stable-5", percentage: 5, distribution: "automatic", minObservationHours: 24 },
  { id: "stable-25", percentage: 25, distribution: "automatic", minObservationHours: 48 },
  { id: "stable-100", percentage: 100, distribution: "automatic", minObservationHours: 0 },
];

export const HARD_STOP_CLASSES = ["crash", "auth", "duplicate-send", "data-integrity"];

export const CANARIES = ["read", "send", "resume", "restart", "revoke"];

export const DEFAULT_THRESHOLDS = {
  minCrashFreeLaunchRate: 0.995,
  minPairingSuccessRate: 0.98,
  maxDuplicateSends: 0,
  maxDataIntegrityFailures: 0,
};

// Restoring prior updater metadata rewrites one file: latest.json, the
// manifest the updater endpoint resolves to. Everything below mutates
// published release history instead, and no rollback may reach for one.
export const FORBIDDEN_RESTORE_OPERATIONS = [
  "tag-move",
  "artifact-overwrite",
  "version-unpublish",
  "signature-regeneration",
];

export function stageById(id) {
  return ROLLOUT_STAGES.find((stage) => stage.id === id) ?? null;
}

/**
 * Read `state.rollbackReadiness` in the shape the upstream gate actually
 * produces. `scripts/release-rollback-readiness.mjs` resolves to
 *
 *   { tag, version, baseline: { tag, version, publishedAt, url } | null,
 *     baselineWaived, platforms, ready }
 *
 * and there are three traps in it worth naming, because reading it loosely
 * yields a rollback decision that does not say what to roll back to:
 *
 *   - `version` is the *target's* version — the release being rolled out. The
 *     rollback target is `baseline.version`, never the top-level one.
 *   - there is no blocker list. That gate throws `RollbackReadinessError` on
 *     every shortfall, so a not-ready verdict only ever reaches this state file
 *     as an operator transcribing the message it threw. That is `error` here.
 *   - `baselineWaived: true` with `baseline: null` is a real, ready verdict:
 *     the `--allow-missing-baseline` waiver a repository's genuine first
 *     release needs. See the waiver note in evaluateRolloutGate().
 */
export function readRollbackReadiness(raw) {
  const verdict = isPlainObject(raw) ? raw : null;
  const baseline = isPlainObject(verdict?.baseline) ? verdict.baseline : null;
  const target = firstNonEmptyString(baseline?.version, baseline?.tag);
  return {
    ready: verdict?.ready === true,
    waived: verdict?.baselineWaived === true,
    target,
    error: firstNonEmptyString(verdict?.error),
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function nextStageId(id) {
  const index = ROLLOUT_STAGES.findIndex((stage) => stage.id === id);
  if (index < 0 || index === ROLLOUT_STAGES.length - 1) return null;
  return ROLLOUT_STAGES[index + 1].id;
}

/** The bounded restore procedure, in order. Only one step mutates anything. */
export function planRollbackRestore(baseline) {
  const tag = isPlainObject(baseline) ? String(baseline.tag ?? "<baseline-tag>") : "<baseline-tag>";
  return [
    {
      id: "verify-baseline-artifacts",
      type: "verify",
      mutates: false,
      detail: `confirm every asset ${tag}'s manifest references is still present and signature-valid`,
    },
    {
      id: "republish-baseline-manifest",
      type: "metadata-restore",
      mutates: true,
      detail:
        "upload the baseline manifest as latest.json on the release the updater endpoint resolves to " +
        "(metadata only — no artifact is rewritten and no tag moves)",
    },
    {
      id: "verify-updater-chain",
      type: "verify",
      mutates: false,
      detail: "pnpm release:verify-updater — the served manifest must now be the baseline version",
    },
  ];
}

/** Refuse a restore plan that reaches for an operation rollback may not use. */
export function assertBoundedRestore(operations) {
  if (!Array.isArray(operations)) throw new Error("restore plan must be an array of operations");
  for (const operation of operations) {
    const type = isPlainObject(operation) ? String(operation.type ?? "") : "";
    if (FORBIDDEN_RESTORE_OPERATIONS.includes(type)) {
      throw new Error(`restore operation '${type}' is forbidden: rollback never mutates published release history`);
    }
  }
  return operations;
}

/**
 * Decide whether the rollout advances, holds, or goes back.
 *
 * Reasons carry their own severity so the caller can print the whole picture
 * rather than only the one that decided it.
 */
export function evaluateRolloutGate(state) {
  if (!isPlainObject(state)) throw new Error("state must be a JSON object");
  const stage = stageById(state.stage);
  if (!stage) {
    throw new Error(
      `unknown rollout stage '${String(state.stage)}'; known stages: ${ROLLOUT_STAGES.map((s) => s.id).join(", ")}`,
    );
  }

  const reasons = [];
  const hold = (detail) => reasons.push({ severity: "hold", detail });
  const rollback = (detail, regressionClass) => reasons.push({ severity: "rollback", detail, class: regressionClass });

  const thresholds = { ...DEFAULT_THRESHOLDS, ...(isPlainObject(state.thresholds) ? state.thresholds : {}) };

  // 1. Preconditions. These gate the rollout as a whole, not just this stage.
  const acceptanceStatus = String(state.acceptance?.status ?? "missing");
  if (acceptanceStatus === "failed") {
    rollback("release acceptance recorded a failed step", "acceptance");
  } else if (acceptanceStatus !== "complete") {
    hold(`release acceptance is '${acceptanceStatus}': three-OS acceptance must be complete before rollout`);
  }

  const readiness = readRollbackReadiness(state.rollbackReadiness);
  if (!readiness.ready) {
    hold(
      "rollback readiness is not proven; a rollout with no verified way back may not begin" +
        (readiness.error ? `: ${readiness.error}` : ""),
    );
  } else if (!readiness.target && !readiness.waived) {
    // `ready: true` with no baseline and no waiver is not a verdict the
    // upstream gate can produce, so it is a hand-edited or truncated state
    // file. Fail closed rather than roll out toward an unnamed target.
    hold("rollback readiness is 'ready' but names no baseline; a rollback target that cannot be named is not one");
  }
  // The waiver is deliberately NOT a hold. `--allow-missing-baseline` is
  // already an explicit, attributed decision taken upstream for a repository's
  // genuine first release, and re-litigating it here would make that release
  // impossible to roll out at all. It is instead carried on every report, and
  // `restore-plan` refuses outright, because the only remedy for a waived
  // baseline is patching forward — there is nothing to restore.

  // 2. Hard-stop regressions reported by an operator or a monitor.
  for (const regression of asArray(state.regressions)) {
    const regressionClass = String(regression?.class ?? "");
    const id = String(regression?.id ?? "unidentified");
    if (HARD_STOP_CLASSES.includes(regressionClass)) {
      rollback(`${regressionClass} regression ${id} reported`, regressionClass);
    } else {
      hold(`regression ${id} has unrecognized class '${regressionClass}'; classify it before deciding`);
    }
  }

  // 3. Threshold breaches, each mapped to the class it belongs to.
  const metrics = isPlainObject(state.metrics) ? state.metrics : {};
  checkMinimum(metrics.crashFreeLaunchRate, thresholds.minCrashFreeLaunchRate, "crash-free launch rate", "crash", {
    hold,
    rollback,
  });
  checkMinimum(metrics.pairingSuccessRate, thresholds.minPairingSuccessRate, "pairing success rate", "auth", {
    hold,
    rollback,
  });
  checkMaximum(metrics.duplicateSendCount, thresholds.maxDuplicateSends, "duplicate sends", "duplicate-send", {
    hold,
    rollback,
  });
  checkMaximum(
    metrics.dataIntegrityFailures,
    thresholds.maxDataIntegrityFailures,
    "data-integrity failures",
    "data-integrity",
    { hold, rollback },
  );

  // 4. Functional canaries pause expansion without reversing the release.
  const canaries = isPlainObject(metrics.canaries) ? metrics.canaries : {};
  for (const canary of CANARIES) {
    const result = String(canaries[canary] ?? "missing");
    if (result !== "pass") hold(`${canary} canary is '${result}'`);
  }

  // 5. The observation window.
  const observedHours = Number(state.observedHours);
  if (!Number.isFinite(observedHours) || observedHours < 0) {
    hold("observedHours is not recorded");
  } else if (observedHours < stage.minObservationHours) {
    hold(`stage '${stage.id}' has been observed ${observedHours}h of the required ${stage.minObservationHours}h`);
  }

  const decision = reasons.some((reason) => reason.severity === "rollback")
    ? "rollback"
    : reasons.some((reason) => reason.severity === "hold")
      ? "hold"
      : "advance";

  return {
    decision,
    stage: stage.id,
    percentage: stage.percentage,
    nextStage: decision === "advance" ? nextStageId(stage.id) : stage.id,
    rollbackTarget: decision === "rollback" ? readiness.target : null,
    rollbackReady: readiness.ready,
    rollbackBaselineWaived: readiness.waived,
    reasons,
  };
}

function checkMinimum(value, minimum, label, regressionClass, { hold, rollback }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    hold(`${label} is not measured`);
    return;
  }
  if (numeric < minimum) rollback(`${label} ${numeric} is below the ${minimum} threshold`, regressionClass);
}

function checkMaximum(value, maximum, label, regressionClass, { hold, rollback }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    hold(`${label} is not measured`);
    return;
  }
  if (numeric > maximum) rollback(`${label} ${numeric} exceeds the ${maximum} threshold`, regressionClass);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatGateReport(result) {
  const lines = [
    `decision: ${result.decision}`,
    `stage: ${result.stage} (${result.percentage}%)`,
    result.decision === "rollback"
      ? `rollback target: ${describeRollbackTarget(result)}`
      : `next stage: ${result.nextStage ?? "fully rolled out"}`,
  ];
  // A waived baseline is stated on every decision, not only on a rollback: an
  // operator advancing a rollout is entitled to know the way back is a patch
  // forward rather than a restore.
  if (result.rollbackBaselineWaived) {
    lines.push("rollback target: none — baseline waived upstream; the only remedy is patching forward");
  }
  for (const reason of result.reasons) {
    lines.push(`  ${reason.severity === "rollback" ? "✗" : "!"} ${reason.detail}`);
  }
  return lines.join("\n");
}

function describeRollbackTarget(result) {
  if (result.rollbackTarget) return `${result.rollbackTarget} (ready: ${result.rollbackReady})`;
  if (result.rollbackBaselineWaived) return "none — baseline waived; do not ship, and patch forward";
  // Not a lookup failure: it means nothing upstream proved a way back. Saying
  // "unknown" would read as one, and send the operator hunting for a version.
  return "not established — rollback readiness was never proven";
}

export function runCli({ argv = process.argv.slice(2), readFileImpl = readFileSync, log = console.log } = {}) {
  const [command, argument] = argv.filter((entry) => !entry.startsWith("--"));

  if (command === "stages") {
    for (const stage of ROLLOUT_STAGES) {
      log(`${stage.id}\t${stage.percentage}%\t${stage.distribution}\t${stage.minObservationHours}h`);
    }
    return 0;
  }

  if (command === "gate" || command === "restore-plan") {
    if (!argument) throw new Error(`usage: release-rollout.mjs ${command} <state.json>`);
    let state;
    try {
      state = JSON.parse(readFileImpl(argument, "utf8"));
    } catch (error) {
      throw new Error(`could not read rollout state ${argument}: ${error.message}`);
    }

    if (command === "restore-plan") {
      if (readRollbackReadiness(state?.rollbackReadiness).waived) {
        throw new Error(
          "rollback readiness waived the baseline (a repository's first release), so there is no prior manifest to " +
            "restore; the remedy for this release is a patch-forward version, not a drill",
        );
      }
      for (const operation of assertBoundedRestore(planRollbackRestore(state?.rollbackReadiness?.baseline))) {
        log(`${operation.mutates ? "*" : " "} ${operation.id}: ${operation.detail}`);
      }
      return 0;
    }

    const result = evaluateRolloutGate(state);
    log(formatGateReport(result));
    return result.decision === "advance" ? 0 : 1;
  }

  throw new Error("usage: release-rollout.mjs <stages|gate|restore-plan> [state.json]");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`release-rollout: ${error.message}`);
    process.exitCode = 1;
  }
}
