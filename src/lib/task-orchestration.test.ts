// @ts-nocheck
// Phase 1 of the orchestration-ready task contract: the pure validator and the
// derived readiness/repair surface. Nothing calls these yet — Phase 2 wires them
// into the cave-board.ts mutators — so this file is where the contract in
// docs/orchestration-ready-tasks.md is actually pinned.
//
// Covers invariants I1 (blocked triple), I3 (external blockers stay out of the
// graph), I4 (cycles and dangling refs), I5 (resolution evidence), I6
// (authorship), I8 (legacy cards stay readable), and every error code.

import assert from "node:assert/strict";

const {
  validateOrchestration,
  deriveReadiness,
  repairRecommendations,
  detectCycles,
  cyclicIds,
  dependencyDepth,
  ancestorsOf,
  isGraphEdge,
  unresolvedOf,
  TRAVERSAL_GUARD,
} = await import("./task-orchestration.ts");

const NOW = "2026-08-04T00:00:00.000Z";

function card(id, overrides = {}) {
  return {
    id,
    title: id,
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
    createdAt: NOW,
    updatedAt: NOW,
    lifecycle: "queued",
    lifecycleAt: NOW,
    retryCount: 0,
    maxRetries: 3,
    steps: [],
    dependencies: [],
    ...overrides,
  };
}

function dep(id, overrides = {}) {
  return {
    id,
    kind: "task",
    label: `dependency ${id}`,
    state: "unresolved",
    origin: "human",
    createdAt: NOW,
    ...overrides,
  };
}

function step(overrides = {}) {
  return {
    summary: "Rerun the failed e2e job",
    requiresApproval: false,
    origin: "human",
    updatedAt: NOW,
    ...overrides,
  };
}

function codes(errors) {
  return errors.map((error) => error.code).sort();
}

// Runtime callers cross a JSON boundary. Malformed records must be rejected
// with field errors instead of crashing or persisting type-invalid data.
{
  const malformedDependency = card("malformed-dependency", {
    dependencies: [null],
  });
  assert.deepEqual(
    codes(validateOrchestration(malformedDependency, { cards: [malformedDependency] })),
    ["dependency_invalid"],
  );

  const malformedNextStep = card("malformed-next-step", {
    nextStep: { summary: "Rerun tests" },
  });
  assert.deepEqual(
    codes(validateOrchestration(malformedNextStep, { cards: [malformedNextStep] })),
    ["next_step_invalid"],
  );

  const malformedPrimary = card("malformed-primary", {
    primaryBlockerId: 42,
  });
  assert.deepEqual(
    codes(validateOrchestration(malformedPrimary, { cards: [malformedPrimary] })),
    ["primary_blocker_invalid"],
  );

  const duplicateDependencies = card("duplicate-dependencies", {
    dependencies: [
      dep("same", { kind: "human" }),
      dep("same", { kind: "human" }),
    ],
  });
  assert.deepEqual(
    codes(validateOrchestration(duplicateDependencies, { cards: [duplicateDependencies] })),
    ["dependency_invalid"],
  );
}

// ── I1: the blocked triple ───────────────────────────────────────────────────

{
  const upstream = card("up");
  const blocked = card("a", {
    status: "blocked",
    dependencies: [dep("d1", { taskId: "up" })],
    primaryBlockerId: "d1",
    nextStep: step(),
  });
  const errors = validateOrchestration(blocked, { cards: [upstream, blocked] });
  assert.deepEqual(errors, [], "a complete blocked triple is accepted");
  assert.equal(deriveReadiness(blocked, [upstream, blocked]), "waiting");
  assert.deepEqual(repairRecommendations(blocked, [upstream, blocked]), []);
}

{
  const blocked = card("a", { status: "blocked", nextStep: step() });
  const errors = validateOrchestration(blocked, { cards: [blocked] });
  assert.deepEqual(codes(errors), ["blocked_requires_dependency"]);
  assert.equal(errors[0].field, "dependencies");
}

{
  // Every dependency resolved is still not a valid blocked card — nothing holds it.
  const upstream = card("up");
  const blocked = card("a", {
    status: "blocked",
    dependencies: [dep("d1", { taskId: "up", state: "resolved", evidence: "merged in #1" })],
    primaryBlockerId: "d1",
    nextStep: step(),
  });
  const errors = validateOrchestration(blocked, { cards: [upstream, blocked] });
  assert.deepEqual(codes(errors), ["blocked_requires_dependency", "blocked_requires_primary"]);
  assert.equal(deriveReadiness(blocked, [upstream, blocked]), "incomplete");
}

{
  const upstream = card("up");
  const blocked = card("a", {
    status: "blocked",
    dependencies: [dep("d1", { taskId: "up" })],
    nextStep: step(),
  });
  const errors = validateOrchestration(blocked, { cards: [upstream, blocked] });
  assert.deepEqual(codes(errors), ["blocked_requires_primary"]);
  assert.equal(errors[0].field, "primaryBlockerId");
}

{
  const upstream = card("up");
  const blocked = card("a", {
    status: "blocked",
    dependencies: [dep("d1", { taskId: "up" })],
    primaryBlockerId: "d1",
  });
  assert.deepEqual(codes(validateOrchestration(blocked, { cards: [upstream, blocked] })), [
    "blocked_requires_next_step",
  ]);

  const whitespace = { ...blocked, nextStep: step({ summary: "   " }) };
  assert.deepEqual(
    codes(validateOrchestration(whitespace, { cards: [upstream, whitespace] })),
    ["blocked_requires_next_step"],
    "a whitespace-only summary is not a next step",
  );
}

// ── I3: external blockers are terminal ───────────────────────────────────────

{
  const external = dep("d1", {
    kind: "github",
    taskId: null,
    ref: "OpenCoven/coven-cave#4201",
    label: "Merge PR #4201",
  });
  assert.equal(isGraphEdge(external), false);

  const blocked = card("a", {
    status: "blocked",
    dependencies: [external],
    primaryBlockerId: "d1",
    nextStep: step(),
  });
  const cards = [blocked];
  assert.deepEqual(validateOrchestration(blocked, { cards }), [], "an external blocker validates");
  assert.equal(deriveReadiness(blocked, cards), "waiting");
  // Excluded from depth layout: a GitHub blocker has no depth to lay a bar against.
  assert.equal(dependencyDepth(cards).a, 0);
  assert.equal(cyclicIds(cards).size, 0);
}

{
  // Every non-task kind stays terminal, including the synthesized failure blocker.
  for (const kind of ["github", "human", "credential", "service", "execution", "external"]) {
    const only = card("a", {
      status: "blocked",
      dependencies: [dep("d1", { kind, taskId: null, label: `${kind} blocker` })],
      primaryBlockerId: "d1",
      nextStep: step({ origin: "system" }),
    });
    assert.deepEqual(
      validateOrchestration(only, { cards: [only] }),
      [],
      `${kind} blocker validates without a task edge`,
    );
    assert.equal(dependencyDepth([only]).a, 0, `${kind} blocker stays out of depth math`);
  }
}

// ── I4: cycles and dangling references ───────────────────────────────────────

{
  // A three-way loop across distinct entries. The single-upstream walk this
  // replaces could not see a loop that closed through a sibling parent.
  const a = card("a", { dependencies: [dep("da", { taskId: "c" })] });
  const b = card("b", { dependencies: [dep("db", { taskId: "a" })] });
  const c = card("c", { dependencies: [dep("dc", { taskId: "b" })] });
  const cards = [a, b, c];

  assert.equal(detectCycles(cards).length, 1);
  const onCycle = cyclicIds(cards);
  for (const id of ["a", "b", "c"]) {
    assert.ok(onCycle.has(id), `${id} is on the cycle`);
    assert.equal(
      deriveReadiness(cards.find((x) => x.id === id), cards, onCycle),
      "cyclic",
      "list derivation can reuse one precomputed cycle index",
    );
  }
  assert.deepEqual(
    dependencyDepth(cards),
    { a: 0, b: 0, c: 0 },
    "cycle members stay out of dependency-depth layout",
  );
  assert.deepEqual(codes(validateOrchestration(a, { cards })), ["dependency_cycle"]);
  assert.deepEqual(
    repairRecommendations(a, cards, onCycle).map((r) => r.code),
    ["dependency_cycle"],
  );
}

{
  // A diamond is not a cycle, and depth is max-over-parents: A waits on both
  // B and C, so it cannot start until the later one lands.
  const d = card("d");
  const b = card("b", { dependencies: [dep("db", { taskId: "d" })] });
  const c = card("c", { dependencies: [dep("dc", { taskId: "d" })] });
  const a = card("a", {
    dependencies: [dep("d1", { taskId: "b" }), dep("d2", { taskId: "c" })],
  });
  const cards = [d, b, c, a];

  assert.deepEqual(detectCycles(cards), [], "a diamond has no cycle");
  const depth = dependencyDepth(cards);
  assert.equal(depth.d, 0);
  assert.equal(depth.b, 1);
  assert.equal(depth.c, 1);
  assert.equal(depth.a, 2, "depth is max-over-parents, not first-parent");
  assert.deepEqual([...ancestorsOf(cards, "a")].sort(), ["b", "c", "d"]);
  assert.deepEqual(validateOrchestration(a, { cards }), []);
}

{
  const self = card("a", { dependencies: [dep("d1", { taskId: "a" })] });
  const errors = validateOrchestration(self, { cards: [self] });
  assert.deepEqual(codes(errors), ["dependency_cycle"], "one error per fault, not two");
  assert.equal(errors[0].dependencyId, "d1", "and it names the offending dependency");
}

{
  const orphan = card("a", { dependencies: [dep("d1", { taskId: "ghost" })] });
  const errors = validateOrchestration(orphan, { cards: [orphan] });
  assert.deepEqual(codes(errors), ["dependency_dangling"]);
  assert.equal(errors[0].dependencyId, "d1");
  assert.deepEqual(repairRecommendations(orphan, [orphan]).map((r) => r.code), [
    "dependency_dangling",
  ]);
}

{
  // A stale primary pointer left by a delete is a fault in any lane.
  const stale = card("a", { dependencies: [], primaryBlockerId: "gone" });
  const errors = validateOrchestration(stale, { cards: [stale] });
  assert.deepEqual(codes(errors), ["dependency_dangling"]);
  assert.equal(errors[0].field, "primaryBlockerId");
}

{
  // The guard is a bound, not a silent pass: a long legal chain still resolves.
  const chain = [];
  for (let i = 0; i < 50; i += 1) {
    chain.push(
      card(`n${i}`, {
        dependencies: i === 0 ? [] : [dep(`d${i}`, { taskId: `n${i - 1}` })],
      }),
    );
  }
  assert.deepEqual(detectCycles(chain), []);
  assert.equal(dependencyDepth(chain).n49, 49);
  assert.ok(TRAVERSAL_GUARD > 50);
}

{
  const size = TRAVERSAL_GUARD + 2;
  const oversizedCycle = Array.from({ length: size }, (_, index) =>
    card(`n${index}`, {
      dependencies: [dep(`d${index}`, { taskId: `n${(index + 1) % size}` })],
    }),
  );
  const onCycle = cyclicIds(oversizedCycle);
  assert.equal(onCycle.size, size, "guard exhaustion rejects the whole oversized component");
  for (const member of oversizedCycle) {
    assert.ok(onCycle.has(member.id), `${member.id} is included in the guard fault`);
  }
  assert.deepEqual(
    codes(validateOrchestration(oversizedCycle.at(-1), { cards: oversizedCycle })),
    ["dependency_cycle"],
    "the member beyond the traversal boundary cannot pass validation",
  );
}

// ── I5: resolution requires evidence ─────────────────────────────────────────

{
  const upstream = card("up");
  const noEvidence = card("a", {
    dependencies: [dep("d1", { taskId: "up", state: "resolved" })],
  });
  const errors = validateOrchestration(noEvidence, { cards: [upstream, noEvidence] });
  assert.deepEqual(codes(errors), ["dependency_needs_evidence"]);
  assert.equal(errors[0].dependencyId, "d1");

  const waived = card("a", {
    dependencies: [dep("d1", { taskId: "up", state: "waived", evidence: "" })],
  });
  assert.deepEqual(
    codes(validateOrchestration(waived, { cards: [upstream, waived] })),
    ["dependency_needs_evidence"],
    "waiving needs evidence too",
  );

  const withEvidence = card("a", {
    dependencies: [
      dep("d1", { taskId: "up", state: "resolved", evidence: "merged in #4201", resolvedAt: NOW }),
    ],
  });
  assert.deepEqual(validateOrchestration(withEvidence, { cards: [upstream, withEvidence] }), []);
  assert.equal(deriveReadiness(withEvidence, [upstream, withEvidence]), "ready");
}

// ── I6: automation never overwrites human authorship ─────────────────────────

{
  const previous = card("a", {
    dependencies: [dep("d1", { kind: "human", taskId: null, label: "Approve the pricing copy" })],
    nextStep: step({ summary: "Ask Val about pricing", origin: "human" }),
  });
  const rewritten = card("a", {
    dependencies: [dep("d1", { kind: "human", taskId: null, label: "Something Enhance guessed" })],
    nextStep: step({ summary: "Ship it", origin: "enhance" }),
  });

  const errors = validateOrchestration(rewritten, {
    cards: [rewritten],
    previous,
    automated: true,
  });
  assert.deepEqual(codes(errors), ["dependency_authorship", "next_step_authorship"]);

  assert.deepEqual(
    validateOrchestration(rewritten, { cards: [rewritten], previous, automated: false }),
    [],
    "a human may edit their own records",
  );
}

{
  const previous = card("a", {
    dependencies: [
      dep("d1", { kind: "human", taskId: null, label: "Approve the pricing copy" }),
      dep("d2", { kind: "github", taskId: null, ref: "OpenCoven/coven-cave#4201" }),
    ],
  });
  const rewritten = card("a", {
    dependencies: [
      dep("d2", {
        kind: "github",
        taskId: null,
        ref: "OpenCoven/coven-cave#4201",
        state: "resolved",
        evidence: "Enhance guessed this was merged",
      }),
    ],
  });

  const errors = validateOrchestration(rewritten, {
    cards: [rewritten],
    previous,
    automated: true,
  }).filter((error) => error.code === "dependency_authorship");
  assert.deepEqual(
    errors.map((error) => error.dependencyId).sort(),
    ["d1", "d2"],
    "automation cannot remove or partially rewrite human dependencies",
  );
}

{
  // Automation may freely rewrite what automation wrote.
  const previous = card("a", {
    dependencies: [dep("d1", { kind: "service", taskId: null, origin: "enhance" })],
    nextStep: step({ origin: "system" }),
  });
  const next = card("a", {
    dependencies: [dep("d1", { kind: "service", taskId: null, origin: "enhance", label: "new" })],
    nextStep: step({ summary: "Retry the provisioning run", origin: "system" }),
  });
  assert.deepEqual(
    validateOrchestration(next, { cards: [next], previous, automated: true }),
    [],
    "derived records are automation's to refresh",
  );
}

{
  // I6: automation silently deleting a human-authored dependency must be caught.
  // The old loop iterated current deps, so a missing dep was never compared.
  const previous = card("a", {
    dependencies: [dep("d1", { kind: "human", taskId: null, label: "Legal sign-off", origin: "human" })],
    nextStep: step({ origin: "system" }),
  });
  const deleted = card("a", { dependencies: [], nextStep: step({ origin: "system" }) });
  const errors = validateOrchestration(deleted, {
    cards: [deleted],
    previous,
    automated: true,
  });
  assert.ok(
    errors.some((e) => e.code === "dependency_authorship" && e.field === "dependencies"),
    "deleting a human dependency must produce dependency_authorship",
  );
}

{
  // I6: automation rewriting a non-label field (e.g. state, evidence) on a
  // human dependency must be caught. The old check only compared label/kind/taskId.
  const humanDep = dep("d1", { kind: "human", taskId: null, label: "Design approval", origin: "human", state: "unresolved" });
  const previous = card("a", {
    dependencies: [humanDep],
    nextStep: step({ origin: "system" }),
  });
  const fieldRewrite = card("a", {
    dependencies: [{ ...humanDep, state: "resolved", evidence: "Enhance says so" }],
    nextStep: step({ origin: "system" }),
  });
  const errors = validateOrchestration(fieldRewrite, {
    cards: [fieldRewrite],
    previous,
    automated: true,
  });
  assert.ok(
    errors.some((e) => e.code === "dependency_authorship" && e.dependencyId === "d1"),
    "rewriting a non-label field on a human dep must produce dependency_authorship",
  );
}

// ── I8: legacy blocked cards stay readable ───────────────────────────────────

{
  // Predates the contract: blocked, no dependencies, no next step. It must
  // derive incomplete and yield repairs — never throw, never hard-fail a read.
  const legacy = card("a", { status: "blocked" });
  delete legacy.dependencies;

  assert.equal(deriveReadiness(legacy, [legacy]), "incomplete");
  assert.deepEqual(unresolvedOf(legacy), []);
  const repairs = repairRecommendations(legacy, [legacy]);
  assert.deepEqual(codes(repairs), ["blocked_requires_dependency", "blocked_requires_next_step"]);
  for (const repair of repairs) {
    assert.ok(repair.action.length > 0, "every repair names the action that fixes it");
  }
}

{
  // A resolved-out blocked card is told to leave the lane, not to invent a blocker.
  const upstream = card("up");
  const done = card("a", {
    status: "blocked",
    dependencies: [dep("d1", { taskId: "up", state: "resolved", evidence: "merged" })],
    primaryBlockerId: "d1",
    nextStep: step(),
  });
  const repairs = repairRecommendations(done, [upstream, done]);
  assert.ok(
    repairs.some((r) => r.action.includes("move this task out of Blocked")),
    "a fully resolved blocked card is recommended for unblocking",
  );
}

// ── Readiness for unblocked lanes ────────────────────────────────────────────

{
  const clear = card("a", { status: "backlog" });
  assert.equal(deriveReadiness(clear, [clear]), "ready");

  const upstream = card("up");
  const waiting = card("a", {
    status: "backlog",
    dependencies: [dep("d1", { taskId: "up" })],
  });
  assert.equal(
    deriveReadiness(waiting, [upstream, waiting]),
    "waiting",
    "unresolved work holds a task even outside the Blocked lane",
  );
}

console.log("task-orchestration: ok");
