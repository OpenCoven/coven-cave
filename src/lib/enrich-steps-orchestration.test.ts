// @ts-nocheck
// cave-bmcoe: dependency and next-step suggestions from the bulk Enhance route.
// Verifies the three auto-application gates (grounding, structural validity,
// non-conflict), the review-queue records that name the failed gate, and the
// write-level parity the bead demands (acceptance tests 3 and 10).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assessEnrichmentGates,
  buildEnrichmentProposalRecord,
  cleanEnrichmentConfidence,
  cleanOrchestrationProposal,
  ENRICHMENT_GATES,
  enrichmentPatch,
  hasOrchestrationContent,
} from "./enrich-steps-orchestration.ts";
import type { Card, TaskDependency, TaskNextStep } from "./cave-board-types.ts";

const now = "2026-08-20T10:00:00.000Z";

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Task ${id}`,
    notes: "",
    status: "backlog",
    priority: "medium",
    familiarId: null,
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: now,
    updatedAt: now,
    lifecycle: "queued",
    lifecycleAt: now,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    primaryBlockerPinned: false,
    nextStep: null,
    orchestrationAudit: [],
    ...overrides,
  };
}

function dependency(id: string, overrides: Partial<TaskDependency> = {}): TaskDependency {
  return {
    id,
    kind: "external",
    label: `Resolve ${id}`,
    state: "unresolved",
    origin: "enhance",
    createdAt: now,
    ...overrides,
  };
}

function nextStep(overrides: Partial<TaskNextStep> = {}): TaskNextStep {
  return {
    summary: "Review the proposed task change",
    requiresApproval: false,
    origin: "enhance",
    updatedAt: now,
    ...overrides,
  };
}

// ── Cleaning ───────────────────────────────────────────────────────────────

const target = card("target", {
  github: [{
    id: "g1",
    kind: "issue",
    repo: "OpenCoven/coven-cave",
    number: 4201,
    title: "Fix the bug",
    url: "https://github.com/OpenCoven/coven-cave/issues/4201",
    labels: [],
  }],
});
const upstream = card("upstream");

const cleaned = cleanOrchestrationProposal({
  dependencies: [
    { id: "dep-task", kind: "task", label: "Finish the upstream task", taskId: "upstream" },
    { id: "dep-gh", kind: "github", label: "Merge the fix", ref: "OpenCoven/coven-cave#4201" },
    { id: "dep-svc", kind: "service", label: "Restore the build", ref: "svc:build" },
    { id: "dep-missing-kind", kind: "bogus", label: "Ignored" },
    { label: "Missing kind", state: "unresolved" },
  ],
  primaryBlockerId: "dep-task",
  primaryBlockerPinned: false,
  nextStep: { summary: "Rerun the failed job", requiresApproval: true },
  confidence: 1.7,
  rationale: "Because",
}, target, now);

assert.ok(hasOrchestrationContent(cleaned), "a dependency proposal counts as orchestration content");
assert.equal(cleaned.dependencies?.length, 3, "malformed dependency entries are dropped");
assert.equal(cleaned.dependencies?.[0].id, "dep-task", "stable model ids are kept");
assert.equal(cleaned.dependencies?.[0].origin, "enhance", "proposals are always enhance-authored");
assert.equal(cleaned.dependencies?.[0].createdAt, now);
assert.equal(cleaned.dependencies?.[1].ref, "OpenCoven/coven-cave#4201");
assert.equal(cleaned.dependencies?.[2].ref, "svc:build");
assert.equal(cleaned.primaryBlockerId, "dep-task");
assert.equal(cleaned.nextStep?.requiresApproval, true);
assert.equal(cleaned.nextStep?.origin, "enhance");
assert.equal(cleaned.nextStep?.updatedAt, now);
assert.equal(cleaned.confidence, 1, "out-of-range confidence clamps to 1");
assert.equal(cleanEnrichmentConfidence("high"), null, "non-numeric confidence is dropped");
assert.equal(hasOrchestrationContent(cleanOrchestrationProposal({}, target, now)), false, "empty output has no orchestration content");
assert.equal(hasOrchestrationContent(cleanOrchestrationProposal({ notes: "x" }, target, now)), false, "plain enrichment alone has no orchestration content");
assert.equal(hasOrchestrationContent(cleanOrchestrationProposal({ nextStep: null }, target, now)), true, "explicit nextStep null is still a proposal");
assert.equal(hasOrchestrationContent(cleanOrchestrationProposal({ primaryBlockerId: null }, target, now)), true, "clearing the primary blocker is a proposal");

// Model ids collide with existing dependency ids — synthesize instead.
const withExisting = card("existing", { dependencies: [dependency("dep-task")] });
const collision = cleanOrchestrationProposal(
  { dependencies: [{ id: "dep-task", kind: "task", label: "Duplicate id", taskId: "upstream" }] },
  withExisting,
  now,
);
assert.notEqual(collision.dependencies?.[0].id, "dep-task", "colliding model ids are replaced");
assert.match(collision.dependencies?.[0].id ?? "", /^[0-9a-f-]{36}$/, "synthesized ids are uuids");

// ── Grounding gate ─────────────────────────────────────────────────────────

const boards = [target, upstream];

function gatesFor(proposal, boardCards = boards) {
  const candidate = { ...target, ...enrichmentPatch(proposal) } as Card;
  return assessEnrichmentGates(target, boardCards, proposal, candidate);
}

const grounded = gatesFor({
  dependencies: [
    dependency("dep-task", { kind: "task", label: "Finish upstream", taskId: "upstream" }),
    dependency("dep-gh", { kind: "github", label: "Merge the fix", ref: "OpenCoven/coven-cave#4201" }),
    dependency("dep-svc", { kind: "service", label: "Restore the build", ref: "svc:build" }),
  ],
  confidence: 0.8,
});
assert.equal(grounded.gatesFailed.includes("grounding"), false, "live task, attached GitHub item, and known service all ground");

const ungroundedTask = gatesFor({
  dependencies: [dependency("dep-bad-task", { kind: "task", label: "Ghost task", taskId: "no-such-card" })],
});
assert.ok(
  ungroundedTask.issues.some((entry) => entry.gate === "grounding" && entry.code === "ungrounded_reference"),
  "a task dependency naming a non-live card fails grounding",
);

const selfDep = gatesFor({
  dependencies: [dependency("dep-self", { kind: "task", label: "Depend on myself", taskId: "target" })],
});
assert.ok(
  selfDep.issues.some((entry) => entry.gate === "grounding" && entry.dependencyId === "dep-self"),
  "a task dependency on the card itself fails grounding",
);

const ungroundedGithub = gatesFor({
  dependencies: [dependency("dep-gh2", { kind: "github", label: "Invented issue", ref: "OpenCoven/coven-cave#9999" })],
});
assert.ok(
  ungroundedGithub.issues.some((entry) => entry.gate === "grounding"),
  "a GitHub reference attached nowhere fails grounding",
);

const ungroundedService = gatesFor({
  dependencies: [dependency("dep-svc2", { kind: "service", label: "Mystery service", ref: "svc:not-a-real-service" })],
});
assert.ok(
  ungroundedService.issues.some((entry) => entry.gate === "grounding"),
  "an unknown svc: reference fails grounding",
);

const ungroundedStepTarget = gatesFor({ nextStep: nextStep({ target: "svc:not-a-real-service" }) });
assert.ok(
  ungroundedStepTarget.issues.some((entry) => entry.gate === "grounding" && entry.field === "nextStep"),
  "a next step targeting an unknown service fails grounding",
);

const groundedStepTarget = gatesFor({ nextStep: nextStep({ target: "svc:build" }) });
assert.equal(
  groundedStepTarget.gatesFailed.includes("grounding"),
  false,
  "a next step targeting a known service grounds",
);

// ── Structural gate ────────────────────────────────────────────────────────

const a = card("a");
const b = card("b");
const c = card("c");
const cycleCards = [a, b, c];
const cycle = assessEnrichmentGates(
  a,
  cycleCards,
  { dependencies: [dependency("a-dep", { kind: "task", label: "Wait on b", taskId: "b" })] },
  {
    ...a,
    dependencies: [dependency("a-dep", { kind: "task", label: "Wait on b", taskId: "b" })],
    // b depends on c, c depends on a → cycle through the candidate edge
  } as Card,
);
// Direct cycle check: b -> c -> a -> b
const cycleCards2 = [a, b, c];
const bDep = dependency("b-dep", { kind: "task", label: "Wait on c", taskId: "c" });
const cDep = dependency("c-dep", { kind: "task", label: "Wait on a", taskId: "a" });
const cycleResult = assessEnrichmentGates(
  b,
  [
    { ...a, dependencies: [dependency("a-dep", { kind: "task", label: "Wait on b", taskId: "b" })] },
    b,
    c,
  ],
  { dependencies: [bDep, cDep] },
  {
    ...b,
    dependencies: [bDep, cDep],
  } as Card,
);
assert.ok(
  cycleResult.issues.some((entry) => entry.gate === "structural" && entry.code === "dependency_cycle"),
  "a proposal closing a dependency cycle fails the structural gate",
);

const danglingCards = [target, upstream];
const dangling = gatesFor({
  dependencies: [dependency("dep-dangling", { kind: "task", label: "Wait on ghost", taskId: "deleted-card" })],
}, danglingCards);
assert.ok(
  dangling.issues.some((entry) => entry.gate === "structural" && entry.code === "dependency_dangling"),
  "a task dependency naming a missing card fails the structural gate",
);

const invalidBlocked = gatesFor({
  dependencies: [],
  nextStep: nextStep(),
});
const blockedCandidate = { ...target, status: "blocked", dependencies: [], nextStep: nextStep() } as Card;
const invalidBlockedResult = assessEnrichmentGates(target, boards, { nextStep: nextStep() }, blockedCandidate);
assert.ok(
  invalidBlockedResult.issues.some((entry) => entry.gate === "structural" && entry.code === "blocked_requires_dependency"),
  "acceptance test 3: an Enhance write that would produce an invalid blocked card fails the structural gate",
);

const validBlocked = card("blocked-target", {
  status: "blocked",
  dependencies: [dependency("b1", { kind: "human", label: "Maintainer decision" })],
  primaryBlockerId: "b1",
  nextStep: nextStep(),
});
const validBlockedResult = assessEnrichmentGates(
  validBlocked,
  [validBlocked, upstream],
  { dependencies: [dependency("b1", { kind: "human", label: "Maintainer decision" })], primaryBlockerId: "b1", nextStep: nextStep() },
  {
    ...validBlocked,
    dependencies: [dependency("b1", { kind: "human", label: "Maintainer decision" })],
    primaryBlockerId: "b1",
    nextStep: nextStep(),
  } as Card,
);
assert.equal(
  validBlockedResult.gatesFailed.length,
  0,
  "a complete blocked triple passes every gate",
);

// ── Non-conflict gate ──────────────────────────────────────────────────────

const humanStep = nextStep({ summary: "Ask the maintainer", requiresApproval: true, origin: "human" });
const humanDep = dependency("human-dep", { origin: "human" });
const humanCard = card("human-card", {
  status: "blocked",
  dependencies: [humanDep],
  primaryBlockerId: "human-dep",
  nextStep: humanStep,
});

const overwriteHumanStep = assessEnrichmentGates(
  humanCard,
  [humanCard, upstream],
  { nextStep: nextStep({ summary: "Rerun the job" }) },
  { ...humanCard, nextStep: nextStep({ summary: "Rerun the job" }) } as Card,
);
assert.ok(
  overwriteHumanStep.issues.some((entry) => entry.gate === "non-conflict" && entry.code === "next_step_authorship"),
  "a proposal overwriting a human-authored next step fails non-conflict",
);

const removeHumanDep = assessEnrichmentGates(
  humanCard,
  [humanCard, upstream],
  { dependencies: [] },
  { ...humanCard, dependencies: [] } as Card,
);
assert.ok(
  removeHumanDep.issues.some((entry) => entry.gate === "non-conflict" && entry.code === "dependency_authorship"),
  "a proposal removing a human-authored dependency fails non-conflict",
);

const enhanceRewrite = assessEnrichmentGates(
  card("enhance-card", { dependencies: [dependency("e1")] }),
  [card("enhance-card", { dependencies: [dependency("e1")] }), upstream],
  { dependencies: [dependency("e1", { label: "Updated enhance dependency" })] },
  { ...card("enhance-card", { dependencies: [dependency("e1")] }), dependencies: [dependency("e1", { label: "Updated enhance dependency" })] } as Card,
);
assert.equal(
  enhanceRewrite.gatesFailed.includes("non-conflict"),
  false,
  "rewriting an enhance-authored dependency is allowed",
);

// ── Review-queue records ───────────────────────────────────────────────────

const gateRecord = buildEnrichmentProposalRecord(target, boards, ungroundedTask.proposal, ungroundedTask, now);
assert.equal(gateRecord.state, "blocked", "gate failures land in the queue as blocked");
assert.ok(
  gateRecord.validation.errors.some((entry) => entry.gate === "grounding"),
  "the queue entry names the gate that rejected it",
);
assert.ok(
  gateRecord.validation.checks.some((check) => check.id === "gate:grounding" && check.state === "failed"),
  "the queue entry carries a failed check for the rejected gate",
);
assert.ok(
  gateRecord.validation.checks.some((check) => check.id === "gate:non-conflict" && check.state === "passed"),
  "passing gates are recorded as passed",
);
assert.equal(gateRecord.recommendation.kind, "dependency", "dependency proposals use the dependency kind");

const appliedRecord = buildEnrichmentProposalRecord(
  card("plain", {}),
  [card("plain", {}), upstream],
  grounded.proposal,
  grounded,
  now,
);
assert.equal(appliedRecord.state, "auto-applied", "gate-passed suggestions auto-apply");
assert.equal(appliedRecord.patch?.dependencies?.length, 3, "the record shows exactly what auto-application changed");
assert.ok(
  appliedRecord.recommendation.rankReasons.some((reason) => reason.includes("Model-reported confidence")),
  "model confidence ranks the suggestion",
);
assert.equal(
  appliedRecord.recommendation.application.requiresApproval,
  false,
  "a non-approval next step is not approval-bound",
);

// ── Acceptance test 10: approval-gated next steps ──────────────────────────

const approvalProposal = cleanOrchestrationProposal(
  { nextStep: { summary: "Get the maintainer to approve the deployment", requiresApproval: true } },
  target,
  now,
);
const approvalGates = gatesFor(approvalProposal);
const approvalRecord = buildEnrichmentProposalRecord(target, boards, approvalProposal, approvalGates, now);
assert.equal(approvalRecord.state, "auto-applied", "an approval-gated next step may still be written");
assert.equal(approvalRecord.needsHuman, true, "an approval-gated next step flags the record for a human");
assert.equal(approvalRecord.recommendation.application.requiresApproval, true);
assert.ok(
  approvalRecord.recommendation.rankReasons.some((reason) => reason.includes("Passed gates")),
  "auto-applications record which gates passed",
);

// ── Write-level parity (acceptance tests 3 and 10) ─────────────────────────

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-enrich-orchestration-"));
process.env.HOME = tmpHome;
process.env.COVEN_CAVE_HOME = tmpHome;
await mkdir(tmpHome, { recursive: true });
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({
    version: 1,
    cards: [target, upstream],
  }),
);

const board = await import("./cave-board.ts");
const orchestration = await import("./task-orchestration.ts");

// AT3: the same invalid blocked write is rejected by the mutator with the same
// codes the structural gate produced — enforcement lives in the lib, so the
// Enhance route cannot bypass it.
await assert.rejects(
  board.updateCard(target.id, { status: "blocked", nextStep: nextStep() }, { automated: true }),
  (error) => {
    assert.ok(error instanceof board.OrchestrationValidationError);
    const codes = error.errors.map((entry) => entry.code);
    assert.ok(codes.includes("blocked_requires_dependency"), "mutator rejects the invalid blocked write");
    return true;
  },
);

// AT10: an approval-gated next step sets needsHuman and is refused by the
// auto-dispatch path (transition to dispatched).
const approvalCard = await board.updateCard(target.id, { nextStep: { ...nextStep({ requiresApproval: true }) } });
assert.equal(approvalCard?.needsHuman, true, "an approval-gated next step sets needsHuman");
await assert.rejects(
  board.transitionCard(target.id, { to: "dispatched" }),
  (error) => {
    assert.ok(error instanceof board.OrchestrationValidationError);
    assert.deepEqual(error.errors.map((entry) => entry.code), ["next_step_requires_approval"]);
    return true;
  },
  "an approval-gated next step stays ineligible for auto-dispatch",
);
// Clean up: clear the approval gate so the card is dispatchable again.
await board.updateCard(target.id, { nextStep: nextStep({ requiresApproval: false }) });
assert.equal((await board.transitionCard(target.id, { to: "dispatched" }))?.lifecycle, "dispatched");

console.log("enrich-steps-orchestration.test.ts OK");
