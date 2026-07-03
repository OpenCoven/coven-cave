// Unit tests for the pure eval domain model. Run as a plain node script
// (matches the repo's node:assert/strict convention).
import assert from "node:assert/strict";
import {
  gradeDeterministic,
  graderNeedsModel,
  applyJudgeVerdict,
  buildCaseResult,
  summarizeResults,
  suiteRunBlockReason,
  graderLabel,
  deriveThreadEvalState,
  rollupEvalGroup,
  buildManualEvalQueueItems,
  type EvalCase,
  type EvalSuite,
  type Grader,
  type EvalGroup,
  type ThreadEvalSnapshot,
  type ThreadEvalState,
} from "./eval-model.ts";

function mkCase(over: Partial<EvalCase> = {}): EvalCase {
  return { id: "c1", name: "case", input: "hi", graders: [], ...over };
}

// ---- contains / not_contains ----
{
  const r = gradeDeterministic({ kind: "contains", value: "hello" }, "well hello there", 10);
  assert.equal(r.pass, true, "contains finds substring");
  assert.equal(r.score, 1);
  const miss = gradeDeterministic({ kind: "contains", value: "bye" }, "hello", 10);
  assert.equal(miss.pass, false, "contains misses absent substring");
  const ci = gradeDeterministic({ kind: "contains", value: "HELLO", caseInsensitive: true }, "hello", 10);
  assert.equal(ci.pass, true, "contains honors caseInsensitive");
  const excl = gradeDeterministic({ kind: "not_contains", value: "error" }, "all good", 10);
  assert.equal(excl.pass, true, "not_contains passes when absent");
}

// ---- equals / regex ----
{
  assert.equal(gradeDeterministic({ kind: "equals", value: "  yes " }, "yes", 5).pass, true, "equals trims");
  assert.equal(gradeDeterministic({ kind: "regex", value: "^\\d{3}-\\d{4}$" }, "555-1234", 5).pass, true, "regex matches");
  assert.equal(gradeDeterministic({ kind: "regex", value: "(" }, "x", 5).pass, false, "invalid regex fails gracefully");
}

// ---- json_has ----
{
  const out = 'sure! ```json\n{"result":{"items":[{"id":7}]}}\n``` done';
  assert.equal(gradeDeterministic({ kind: "json_has", value: "result.items.0.id" }, out, 5).pass, true, "json_has digs into fenced json");
  assert.equal(gradeDeterministic({ kind: "json_has", value: "result.missing" }, out, 5).pass, false, "json_has fails on missing path");
  assert.equal(gradeDeterministic({ kind: "json_has", value: "a" }, "not json", 5).pass, false, "json_has fails on non-json");
}

// ---- latency_under ----
{
  assert.equal(gradeDeterministic({ kind: "latency_under", value: "1000" }, "x", 500).pass, true, "latency under limit passes");
  assert.equal(gradeDeterministic({ kind: "latency_under", value: "1000" }, "x", 1500).pass, false, "latency over limit fails");
}

// ---- llm_judge deferral ----
{
  const g: Grader = { kind: "llm_judge", value: "", rubric: "answer is polite" };
  assert.equal(graderNeedsModel(g), true, "judge needs a model call");
  const pending = gradeDeterministic(g, "whatever", 5);
  assert.equal(pending.pass, false, "deterministic pass is false until judged");
  const judged = applyJudgeVerdict(g, 0.8, "polite enough");
  assert.equal(judged.pass, true, "judge verdict >= 0.5 passes");
  assert.equal(judged.score, 0.8);
  assert.equal(applyJudgeVerdict(g, 0.3, "rude").pass, false, "judge verdict < 0.5 fails");
  // An explicit judge boolean wins over the score threshold (a judge may return
  // a high score but pass:false, or vice-versa).
  assert.equal(applyJudgeVerdict(g, 0.9, "high score, explicit fail", false).pass, false, "explicit pass:false overrides a >=0.5 score");
  assert.equal(applyJudgeVerdict(g, 0.2, "low score, explicit pass", true).pass, true, "explicit pass:true overrides a <0.5 score");
  assert.equal(graderNeedsModel({ kind: "contains", value: "x" }), false, "deterministic graders need no model");
}

// ---- buildCaseResult AND semantics ----
{
  const c = mkCase({ graders: [{ kind: "contains", value: "a" }, { kind: "contains", value: "b" }] });
  const allPass = buildCaseResult(c, "ab", 10, [
    gradeDeterministic(c.graders[0], "ab", 10),
    gradeDeterministic(c.graders[1], "ab", 10),
  ]);
  assert.equal(allPass.pass, true, "case passes when all graders pass");
  assert.equal(allPass.score, 1);
  const onePass = buildCaseResult(c, "a", 10, [
    gradeDeterministic(c.graders[0], "a", 10),
    gradeDeterministic(c.graders[1], "a", 10),
  ]);
  assert.equal(onePass.pass, false, "case fails when any grader fails");
  assert.equal(onePass.score, 0.5, "score is mean of grader scores");
  const errored = buildCaseResult(c, "", 0, [], "boom");
  assert.equal(errored.pass, false, "errored case never passes");
  assert.equal(errored.score, 0);
}

// ---- summarizeResults ----
{
  const c = mkCase({ graders: [{ kind: "contains", value: "x" }] });
  const results = [
    buildCaseResult(c, "x", 100, [gradeDeterministic(c.graders[0], "x", 100)]),
    buildCaseResult(c, "y", 300, [gradeDeterministic(c.graders[0], "y", 300)]),
  ];
  const s = summarizeResults(results);
  assert.equal(s.total, 2);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.avgLatencyMs, 200);
  assert.deepEqual(summarizeResults([]), { total: 0, passed: 0, failed: 0, passRate: 0, avgScore: 0, avgLatencyMs: 0 }, "empty summary");
}

// ---- suiteRunBlockReason ----
{
  const base: EvalSuite = {
    id: "s1", name: "suite", cases: [], createdAt: "", updatedAt: "",
  };
  assert.match(suiteRunBlockReason(base, undefined) ?? "", /familiar/i, "blocks without familiar");
  assert.match(suiteRunBlockReason(base, "fam") ?? "", /at least one case/i, "blocks with no cases");
  const withBlank: EvalSuite = { ...base, cases: [mkCase({ input: "  " })] };
  assert.match(suiteRunBlockReason(withBlank, "fam") ?? "", /no input/i, "blocks blank input");
  const noGraders: EvalSuite = { ...base, cases: [mkCase({ input: "hi", graders: [] })] };
  assert.match(suiteRunBlockReason(noGraders, "fam") ?? "", /no graders/i, "blocks missing graders");
  const ok: EvalSuite = { ...base, cases: [mkCase({ input: "hi", graders: [{ kind: "contains", value: "x" }] })] };
  assert.equal(suiteRunBlockReason(ok, "fam"), null, "runnable suite has no block reason");
}

// ---- graderLabel ----
{
  assert.equal(graderLabel({ kind: "contains", value: "x" }), "Contains");
  assert.equal(graderLabel({ kind: "contains", value: "x", label: "Has greeting" }), "Has greeting");
}

// ---- thread eval freshness ----
{
  const baseSnapshot: ThreadEvalSnapshot = {
    threadId: "thread-1",
    familiarId: "cody",
    evaluatedThroughTurnId: "turn-2",
    inputHash: "hash-a",
    rubricVersion: "rubric-v1",
    confidenceRubricVersion: "confidence-v1",
    skillsVersion: "skills-v1",
    permissionsHash: "perms-v1",
    responseConfidenceEventIds: ["confidence-1"],
    evaluatedAt: "2026-06-28T08:00:00.000Z",
  };

  assert.deepEqual(
    deriveThreadEvalState(null, {
      threadId: "thread-1",
      familiarId: "cody",
      latestTurnId: "turn-1",
      now: "2026-06-28T08:10:00.000Z",
    }),
    {
      threadId: "thread-1",
      familiarId: "cody",
      status: "never-run",
      staleReasons: ["never-run"],
      evaluatedAt: null,
      details: {
        latestTurnId: "turn-1",
        evaluatedThroughTurnId: undefined,
        rubricVersion: undefined,
        snapshotRubricVersion: undefined,
        confidenceRubricVersion: undefined,
        snapshotConfidenceRubricVersion: undefined,
        skillsVersion: undefined,
        snapshotSkillsVersion: undefined,
        permissionsHash: undefined,
        snapshotPermissionsHash: undefined,
        responseConfidenceEventCount: 0,
        snapshotResponseConfidenceEventCount: 0,
        groupUpdatedAt: undefined,
        ttlMs: undefined,
      },
    },
    "missing snapshot is never-run",
  );

  assert.equal(
    deriveThreadEvalState(baseSnapshot, {
      threadId: "thread-1",
      familiarId: "cody",
      latestTurnId: "turn-2",
      inputHash: "hash-a",
      rubricVersion: "rubric-v1",
      confidenceRubricVersion: "confidence-v1",
      skillsVersion: "skills-v1",
      permissionsHash: "perms-v1",
      responseConfidenceEventIds: ["confidence-1"],
      now: "2026-06-28T08:10:00.000Z",
    }).status,
    "fresh",
    "matching snapshot is fresh",
  );

  const stale = deriveThreadEvalState(baseSnapshot, {
    threadId: "thread-1",
    familiarId: "cody",
    latestTurnId: "turn-4",
    inputHash: "hash-b",
    rubricVersion: "rubric-v2",
    confidenceRubricVersion: "confidence-v2",
    skillsVersion: "skills-v2",
    permissionsHash: "perms-v2",
    responseConfidenceEventIds: ["confidence-1", "confidence-2"],
    ttlMs: 60_000,
    now: "2026-06-28T08:10:00.000Z",
  });
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.staleReasons, [
    "new-turns",
    "thread-changed",
    "rubric-changed",
    "confidence-rubric-changed",
    "skills-changed",
    "permissions-changed",
    "confidence-events-added",
    "ttl-expired",
  ]);
  assert.deepEqual(
    stale.details,
    {
      latestTurnId: "turn-4",
      evaluatedThroughTurnId: "turn-2",
      rubricVersion: "rubric-v2",
      snapshotRubricVersion: "rubric-v1",
      confidenceRubricVersion: "confidence-v2",
      snapshotConfidenceRubricVersion: "confidence-v1",
      skillsVersion: "skills-v2",
      snapshotSkillsVersion: "skills-v1",
      permissionsHash: "perms-v2",
      snapshotPermissionsHash: "perms-v1",
      responseConfidenceEventCount: 2,
      snapshotResponseConfidenceEventCount: 1,
      groupUpdatedAt: undefined,
      ttlMs: 60_000,
    },
    "stale thread eval state includes reviewable freshness evidence",
  );

  assert.equal(
    deriveThreadEvalState(baseSnapshot, {
      threadId: "thread-1",
      familiarId: "cody",
      evalLock: { locked: true, stale: false },
      now: "2026-06-28T08:10:00.000Z",
    }).status,
    "running",
    "fresh daemon lock reports running",
  );
  assert.equal(
    deriveThreadEvalState(baseSnapshot, {
      threadId: "thread-1",
      familiarId: "cody",
      evalLock: { locked: true, stale: true },
      now: "2026-06-28T08:10:00.000Z",
    }).status,
    "blocked",
    "stale daemon lock reports blocked",
  );
}

// ---- eval groups and manual queue ----
{
  const group: EvalGroup = {
    id: "group-1",
    name: "Current thread confidence",
    description: "Confidence eval group",
    scope: "thread",
    members: [{ kind: "thread", id: "thread-1", familiarId: "cody" }, { kind: "thread", id: "thread-2", familiarId: "cody" }],
    tracks: ["confidence", "regression"],
    rubricVersion: "rubric-v1",
    stalePolicy: { ttlMs: 60_000 },
    schedulePolicy: { mode: "manual" },
    createdAt: "2026-06-28T08:00:00.000Z",
    updatedAt: "2026-06-28T08:00:00.000Z",
  };
  const states: ThreadEvalState[] = [
    {
      threadId: "thread-1",
      familiarId: "cody",
      status: "stale",
      staleReasons: ["new-turns"],
      evaluatedAt: "2026-06-28T08:00:00.000Z",
      details: { responseConfidenceEventCount: 0, snapshotResponseConfidenceEventCount: 0 },
    },
    {
      threadId: "thread-2",
      familiarId: "cody",
      status: "blocked",
      staleReasons: ["eval-lock-stale"],
      evaluatedAt: "2026-06-28T08:00:00.000Z",
      details: { responseConfidenceEventCount: 0, snapshotResponseConfidenceEventCount: 0 },
    },
  ];

  const rollup = rollupEvalGroup(group, states);
  assert.equal(rollup.totalThreads, 2);
  assert.equal(rollup.staleThreads, 1);
  assert.equal(rollup.blockedThreads, 1);
  assert.deepEqual(rollup.runnableThreadIds, ["thread-1"]);

  const queueItems = buildManualEvalQueueItems(group, states, "2026-06-28T08:15:00.000Z");
  assert.equal(queueItems.length, 1, "manual queue skips blocked threads");
  assert.equal(queueItems[0].groupId, "group-1");
  assert.equal(queueItems[0].threadId, "thread-1");
  assert.equal(queueItems[0].status, "queued");
  assert.deepEqual(queueItems[0].staleReasons, ["new-turns"]);
}

console.log("eval-model.test.ts OK");
