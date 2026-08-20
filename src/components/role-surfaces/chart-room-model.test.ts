import assert from "node:assert/strict";
import test from "node:test";

import {
  CHART_STAGES,
  ancestorsOf,
  capabilitiesForStep,
  chainHold,
  chainOf,
  chainSummary,
  chartProposals,
  decisionsOwed,
  dependants,
  dependencyDepth,
  cycleFor,
  cyclicStepIds,
  filterSteps,
  flowLayout,
  forgetStep,
  ganttRows,
  gateParent,
  graphLayout,
  laneOrder,
  lockedSteps,
  nextStage,
  normalizeOverlay,
  overlayImportPlan,
  routeSet,
  setDependency,
  sortSteps,
  stageIndex,
  stepCycles,
  stepRecommendation,
  stepState,
  toChartSteps,
  weakestCycleEdge,
  type ChartCapability,
  type ChartStageId,
  type ChartStep,
  type ChartStepEdge,
} from "./chart-room-model.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Steps take `needs` as upstream ids; edges default to automation-authored
 *  unresolved records so the pre-canonical tests keep reading naturally. */
const step = (
  id: string,
  overrides: Partial<ChartStep> = {},
): ChartStep => {
  const needs = overrides.needs ?? [];
  const edges: ChartStepEdge[] =
    overrides.edges ??
    needs.map((parent) => ({
      needs: parent,
      origin: "system",
      state: "unresolved",
      primary: false,
      pinned: false,
    }));
  return {
    id,
    title: `Step ${id}`,
    notes: "",
    stage: "backlog",
    state: "queued",
    owner: null,
    project: null,
    needsHuman: false,
    labels: [],
    endDate: null,
    updatedAt: "2026-07-31T00:00:00.000Z",
    external: [],
    ...overrides,
    needs: edges.map((edge) => edge.needs),
    edges,
  };
};

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Card ${id}`,
  notes: "",
  status: "backlog" as const,
  priority: "medium" as const,
  familiarId: null,
  sessionId: null,
  cwd: null,
  links: [],
  github: [],
  asana: [],
  labels: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  lifecycle: "queued" as const,
  lifecycleAt: "2026-07-01T00:00:00.000Z",
  retryCount: 0,
  maxRetries: 2,
  steps: [],
  ...overrides,
});

/** A canonical task dependency record, valid under the shared validator. */
const taskDep = (target: string, overrides: Record<string, unknown> = {}) => ({
  id: `dep-${target}`,
  kind: "task" as const,
  label: `Card ${target}`,
  taskId: target,
  state: "unresolved" as const,
  origin: "system" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const externalDep = (kind: string, label: string, overrides: Record<string, unknown> = {}) => ({
  id: `dep-${kind}-${label}`,
  kind,
  label,
  state: "unresolved" as const,
  origin: "human" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

// ── Stages ───────────────────────────────────────────────────────────────────

test("stages are the board's own lanes, in board order", () => {
  assert.deepEqual(
    CHART_STAGES.map((stage) => stage.id),
    ["backlog", "inbox", "running", "review", "blocked", "done"],
  );
  assert.equal(stageIndex("running"), 2);
  assert.equal(nextStage("review")?.id, "blocked");
  assert.equal(nextStage("done"), null);
});

test("blocked and done are not pipeline positions", () => {
  const pipeline = CHART_STAGES.filter((stage) => stage.pipeline).map((stage) => stage.id);
  assert.deepEqual(pipeline, ["backlog", "inbox", "running", "review"]);
});

// ── Card → step ──────────────────────────────────────────────────────────────

test("stepState ranks a question owed above a late date", () => {
  assert.equal(
    stepState({ status: "running", priority: "high", endDate: "2026-07-01", needsHuman: true, lifecycle: "running" }, "2026-07-31"),
    "decision",
  );
  assert.equal(
    stepState({ status: "running", priority: "high", endDate: "2026-07-01", needsHuman: false, lifecycle: "running" }, "2026-07-31"),
    "overdue",
  );
  assert.equal(
    stepState({ status: "done", priority: "urgent", endDate: "2026-07-01", needsHuman: true, lifecycle: "completed" }, "2026-07-31"),
    "done",
    "a finished card is never owed",
  );
  assert.equal(
    stepState({ status: "backlog", priority: "urgent", endDate: null, needsHuman: false, lifecycle: "queued" }, "2026-07-31"),
    "high",
  );
  assert.equal(
    stepState({ status: "backlog", priority: "low", endDate: null, needsHuman: false, lifecycle: "queued" }, "2026-07-31"),
    "queued",
  );
});

test("toChartSteps reads the card's canonical task dependencies as edges", () => {
  const steps = toChartSteps(
    [card("a"), card("b", { dependencies: [taskDep("a", { origin: "human" })] })] as never,
    { dependsOn: {} },
    "2026-07-31",
  );
  const b = steps.find((s) => s.id === "b");
  assert.deepEqual(b?.needs, ["a"]);
  assert.deepEqual(b?.edges, [
    { needs: "a", origin: "human", state: "unresolved", primary: false, pinned: false },
  ]);
  assert.deepEqual(steps.find((s) => s.id === "a")?.needs, []);
});

test("toChartSteps unions a surviving overlay edge with canonical ones, deduped", () => {
  const steps = toChartSteps(
    [card("a"), card("b"), card("c", { dependencies: [taskDep("a")] })] as never,
    { dependsOn: { c: "b", b: "a" } },
    "2026-07-31",
  );
  const c = steps.find((s) => s.id === "c");
  assert.deepEqual(c?.needs, ["a", "b"], "canonical first, then the surviving overlay edge");
  assert.equal(c?.edges.find((edge) => edge.needs === "b")?.origin, "overlay");
  const b = steps.find((s) => s.id === "b");
  assert.deepEqual(b?.needs, ["a"]);
  // The overlay edge duplicating a canonical one collapses to the canonical record.
  const dedup = toChartSteps(
    [card("a"), card("b", { dependencies: [taskDep("a", { origin: "human" })] })] as never,
    { dependsOn: { b: "a" } },
    "2026-07-31",
  );
  const merged = dedup.find((s) => s.id === "b");
  assert.equal(merged?.edges.length, 1);
  assert.equal(merged?.edges[0].origin, "human");
});

test("toChartSteps marks the primary blocker and its pin", () => {
  const steps = toChartSteps(
    [
      card("a"),
      card("b"),
      card("c", {
        dependencies: [taskDep("a"), taskDep("b")],
        primaryBlockerId: "dep-b",
        primaryBlockerPinned: true,
      }),
    ] as never,
    { dependsOn: {} },
    "2026-07-31",
  );
  const c = steps.find((s) => s.id === "c");
  assert.deepEqual(
    c?.edges.map((edge) => [edge.needs, edge.primary, edge.pinned]),
    [
      ["a", false, false],
      ["b", true, true],
    ],
  );
});

test("toChartSteps drops self-edges and edges to cards that are gone", () => {
  const steps = toChartSteps(
    [card("a", { dependencies: [taskDep("a"), taskDep("ghost")] })] as never,
    { dependsOn: { a: "ghost" } },
    "2026-07-31",
  );
  assert.deepEqual(steps[0].needs, []);
});

// Acceptance test 5 (I3): a card whose only blocker is external derives without
// throwing, is excluded from depth layout, and renders terminally as a chip.
test("an external-only blocker is a terminal chip, never a graph edge", () => {
  const steps = toChartSteps(
    [
      card("a", {
        status: "blocked",
        dependencies: [externalDep("github", "Merge OpenCoven/coven-cave#4527")],
      }),
      card("b", { dependencies: [taskDep("a")] }),
    ] as never,
    { dependsOn: {} },
    "2026-07-31",
  );
  const a = steps.find((s) => s.id === "a");
  assert.deepEqual(a?.needs, [], "external blockers never enter the graph");
  assert.deepEqual(a?.external, [
    { kind: "github", label: "Merge OpenCoven/coven-cave#4527", state: "unresolved" },
  ]);
  const depth = dependencyDepth(steps);
  assert.equal(depth.a, 0, "lays out at its own depth");
  assert.equal(depth.b, 1);
  const { rows } = ganttRows(steps);
  assert.equal(rows.find((row) => row.step.id === "a")?.linkAt, null);
});

// ── The legacy overlay ───────────────────────────────────────────────────────

test("normalizeOverlay prunes self-edges and edges to cards that are gone", () => {
  const overlay = normalizeOverlay({ dependsOn: { a: "b", b: "b", c: "ghost", ghost: "a" } }, ["a", "b", "c"]);
  assert.deepEqual(overlay.dependsOn, { a: "b" });
});

test("setDependency refuses a self-edge and clears on null", () => {
  assert.deepEqual(setDependency({ dependsOn: {} }, "a", "a").dependsOn, {});
  assert.deepEqual(setDependency({ dependsOn: { a: "b" } }, "a", null).dependsOn, {});
  assert.deepEqual(setDependency({ dependsOn: {} }, "a", "b").dependsOn, { a: "b" });
});

test("forgetStep cuts edges in both directions", () => {
  const overlay = forgetStep({ dependsOn: { a: "b", c: "b", b: "d" } }, "b");
  assert.deepEqual(overlay.dependsOn, {});
});

// Acceptance test 7 (migration step 2): two divergent overlay maps import to a
// deterministic merged set; no canonical edge is dropped; a re-run is a no-op.
test("overlayImportPlan merges divergent maps deterministically and never overwrites", () => {
  const cards = [card("a"), card("b"), card("c", { dependencies: [taskDep("a", { origin: "human" })] })];
  // Two navigators hold divergent maps; each import contributes only what the
  // card does not already carry, so the union is order-independent.
  const fromDeviceOne = overlayImportPlan(cards as never, { dependsOn: { b: "a", c: "b" } });
  const fromDeviceTwo = overlayImportPlan(cards as never, { dependsOn: { c: "b", b: "a" } });
  assert.deepEqual(fromDeviceOne, [
    { stepId: "b", needs: "a" },
    { stepId: "c", needs: "b" },
  ]);
  assert.deepEqual(fromDeviceTwo, fromDeviceOne, "the plan is deterministic regardless of map order");
  // The canonical human edge c→a is untouched: the plan only ever adds.
  assert.equal(fromDeviceOne.some((entry) => entry.stepId === "c" && entry.needs === "a"), false);
  // Once the import lands (the edges are canonical), a second run plans nothing.
  const imported = [
    card("a"),
    card("b", { dependencies: [taskDep("a")] }),
    card("c", { dependencies: [taskDep("a", { origin: "human" }), taskDep("b")] }),
  ];
  assert.deepEqual(overlayImportPlan(imported as never, { dependsOn: { b: "a", c: "b" } }), []);
});

test("overlayImportPlan skips self-edges and edges to cards that are gone", () => {
  assert.deepEqual(
    overlayImportPlan([card("a")] as never, { dependsOn: { a: "a", ghost: "a", a2: "ghost" } }),
    [],
  );
});

// ── Graph walks ──────────────────────────────────────────────────────────────

test("chainOf reads the route root-first, through the step, and on down", () => {
  const steps = [step("a"), step("b", { needs: ["a"] }), step("c", { needs: ["b"] })];
  assert.deepEqual(
    chainOf(steps, "b").map((s) => s.id),
    ["a", "b", "c"],
  );
});

test("chainOf follows the longest downstream branch", () => {
  const steps = [
    step("root"),
    step("short", { needs: ["root"] }),
    step("long-1", { needs: ["root"] }),
    step("long-2", { needs: ["long-1"] }),
  ];
  assert.deepEqual(
    chainOf(steps, "root").map((s) => s.id),
    ["root", "long-1", "long-2"],
  );
});

test("chainOf walks up through the deepest parent — the genuine critical path", () => {
  // d waits on both b (depth 1) and c (depth 2); the route up runs through c.
  const steps = [
    step("a"),
    step("b", { needs: ["a"] }),
    step("c", { needs: ["b"] }),
    step("d", { needs: ["b", "c"] }),
  ];
  assert.deepEqual(
    chainOf(steps, "d").map((s) => s.id),
    ["a", "b", "c", "d"],
  );
});

test("chainOf terminates on a loop instead of hanging", () => {
  const steps = [step("a", { needs: ["b"] }), step("b", { needs: ["a"] })];
  const chain = chainOf(steps, "a");
  assert.ok(chain.length <= 2, `expected a bounded chain, got ${chain.length}`);
});

test("gateParent is the deepest parent, with deterministic ties", () => {
  const steps = [
    step("a"),
    step("b", { needs: ["a"] }),
    step("shallow"),
    step("d", { needs: ["shallow", "b"] }),
  ];
  assert.equal(gateParent(steps, "d")?.id, "b");
  assert.equal(gateParent(steps, "a"), undefined);
  const tied = [step("x"), step("y"), step("z", { needs: ["y", "x"] })];
  assert.equal(gateParent(tied, "z")?.id, "x", "equal depth breaks on title then id");
});

// Acceptance test 4 (I3/I4): the diamond derives no cycle with max-over-parents
// depth, and a three-step loop across distinct entries marks all three cyclic.
test("a diamond is no cycle, and depth is max-over-parents", () => {
  const steps = [
    step("d"),
    step("b", { needs: ["d"] }),
    step("c", { needs: ["d"] }),
    step("a", { needs: ["b", "c"] }),
  ];
  assert.deepEqual(stepCycles(steps), []);
  const depth = dependencyDepth(steps);
  assert.deepEqual(depth, { d: 0, b: 1, c: 1, a: 2 });
});

test("a three-step loop across distinct dependency entries marks all three cyclic", () => {
  const steps = [
    step("a", { needs: ["c"] }),
    step("b", { needs: ["a"] }),
    step("c", { needs: ["b"] }),
    step("clear"),
  ];
  assert.deepEqual([...cyclicStepIds(steps)].sort(), ["a", "b", "c"]);
  const depth = dependencyDepth(steps);
  assert.deepEqual(depth, { a: 0, b: 0, c: 0, clear: 0 }, "cycle members resolve to zero");
});

test("dependencyDepth is the longest walk up, and a cycle resolves to zero", () => {
  const depth = dependencyDepth([step("a"), step("b", { needs: ["a"] }), step("c", { needs: ["b"] })]);
  assert.deepEqual(depth, { a: 0, b: 1, c: 2 });
  const looped = dependencyDepth([step("x", { needs: ["y"] }), step("y", { needs: ["x"] })]);
  assert.equal(Number.isFinite(looped.x), true);
});

test("cycleFor finds a three-step loop, not just a mutual pair", () => {
  const steps = [step("a", { needs: ["c"] }), step("b", { needs: ["a"] }), step("c", { needs: ["b"] })];
  const loop = cycleFor(steps, "a");
  assert.ok(loop, "expected a loop");
  assert.equal(loop?.length, 3);
  assert.equal(cycleFor([step("a"), step("b", { needs: ["a"] })], "b"), null);
});

test("cycleFor searches every parent branch, not just the first", () => {
  // The loop back to "a" hides behind the SECOND parent of "b".
  const steps = [
    step("a", { needs: ["b"] }),
    step("b", { needs: ["clear", "c"] }),
    step("c", { needs: ["a"] }),
    step("clear"),
  ];
  const loop = cycleFor(steps, "a");
  assert.deepEqual(loop, ["a", "b", "c"]);
});

test("ancestorsOf fans out across every parent branch", () => {
  const steps = [
    step("a"),
    step("b"),
    step("c", { needs: ["a"] }),
    step("d", { needs: ["b", "c"] }),
  ];
  assert.deepEqual([...ancestorsOf(steps, "d")].sort(), ["a", "b", "c"]);
});

test("routeSet lights the whole chain, up and down, across fan-in", () => {
  const steps = [
    step("a"),
    step("b", { needs: ["a"] }),
    step("side"),
    step("c", { needs: ["b", "side"] }),
    step("z"),
  ];
  const route = routeSet(steps, "c");
  assert.deepEqual([...route].sort(), ["a", "b", "c", "side"]);
  assert.equal(routeSet(steps, null).size, 0);
});

test("dependants finds everything waiting directly on a step", () => {
  const steps = [step("a"), step("b", { needs: ["a"] }), step("c", { needs: ["a"] })];
  assert.deepEqual(
    dependants(steps, "a").map((s) => s.id),
    ["b", "c"],
  );
});

// ── Proposals ────────────────────────────────────────────────────────────────

test("a loop is proposed once, not once per member", () => {
  const steps = [step("a", { needs: ["c"] }), step("b", { needs: ["a"] }), step("c", { needs: ["b"] })];
  const cycles = chartProposals(steps).filter((p) => p.kind === "cycle");
  assert.equal(cycles.length, 1);
  assert.match(cycles[0].text, /loop/);
  assert.equal(cycles[0].action?.type, "cut-dependency");
});

test("the weakest edge prefers a parent already done, then an earlier lane", () => {
  const steps = [
    step("a", { stage: "running", needs: ["b"] }),
    step("b", { stage: "done", state: "done", needs: ["a"] }),
  ];
  const loop = cycleFor(steps, "a");
  assert.ok(loop);
  // The edge a→b points at a done parent — the least real blocker.
  assert.deepEqual(weakestCycleEdge(steps, loop as string[]), { stepId: "a", needs: "b" });
});

test("a pinned primary or human-authored edge is never volunteered for the cut", () => {
  const humanEdge = (parent: string): ChartStepEdge => ({
    needs: parent,
    origin: "human",
    state: "unresolved",
    primary: false,
    pinned: false,
  });
  const steps = [
    step("a", { edges: [humanEdge("b")] }),
    step("b", { edges: [humanEdge("a")] }),
  ];
  const loop = cycleFor(steps, "a");
  assert.ok(loop);
  assert.equal(weakestCycleEdge(steps, loop as string[]), null);
  const proposal = chartProposals(steps).find((p) => p.kind === "cycle");
  assert.equal(proposal?.action?.type, "trace", "the operator picks inside the cycle card");
});

test("a backwards edge between pipeline lanes is proposed with the lane to move to", () => {
  const steps = [
    step("late", { stage: "review" }),
    step("early", { stage: "backlog", needs: ["late"] }),
  ];
  const backwards = chartProposals(steps).find((p) => p.kind === "backwards");
  assert.ok(backwards, "expected a backwards-edge proposal");
  assert.deepEqual(backwards?.action, { type: "move-stage", stepId: "early", stage: "blocked" });
});

test("blocked and done never produce backwards advice", () => {
  // Waiting on something blocked is a real situation; telling you to move the
  // dependant past Blocked would be nonsense.
  const steps = [step("stuck", { stage: "blocked" }), step("mine", { stage: "running", needs: ["stuck"] })];
  assert.equal(
    chartProposals(steps).some((p) => p.kind === "backwards"),
    false,
  );
});

test("a landed blocker proposes moving the unblocked step onward", () => {
  const steps = [step("a", { stage: "done", state: "done" }), step("b", { stage: "backlog", needs: ["a"] })];
  const unblocked = chartProposals(steps).find((p) => p.kind === "unblocked");
  assert.deepEqual(unblocked?.action, { type: "move-stage", stepId: "b", stage: "inbox" });
});

test("with fan-in, one landed parent does not unblock a step still waiting on another", () => {
  const steps = [
    step("landed", { stage: "done", state: "done" }),
    step("live", { stage: "running", state: "running" }),
    step("b", { stage: "backlog", needs: ["landed", "live"] }),
  ];
  assert.equal(chartProposals(steps).some((p) => p.kind === "unblocked"), false);
});

test("an overdue step with nothing behind it is not a stalled leg", () => {
  const alone = [step("a", { state: "overdue" })];
  assert.equal(chartProposals(alone).some((p) => p.kind === "stalled"), false);
  const withTail = [step("a", { state: "overdue" }), step("b", { needs: ["a"] })];
  const stalled = chartProposals(withTail).find((p) => p.kind === "stalled");
  assert.deepEqual(stalled?.action, { type: "trace", stepId: "a" });
});

test("a sound chart proposes nothing", () => {
  const steps = [step("a", { stage: "backlog" }), step("b", { stage: "running", needs: ["a"] })];
  assert.deepEqual(chartProposals(steps), []);
});

// ── Recommendations ──────────────────────────────────────────────────────────

test("a loop recommends cutting the weakest edge, naming it", () => {
  const steps = [step("a", { needs: ["b"] }), step("b", { needs: ["a"] })];
  const rec = stepRecommendation(steps[0], steps);
  assert.deepEqual(rec.action, { type: "cut-dependency", stepId: "a", needs: "b" });
});

test("an overdue blocker outranks everything else the step could be told", () => {
  const steps = [step("a", { state: "overdue" }), step("b", { needs: ["a"], state: "running" })];
  const rec = stepRecommendation(steps[1], steps);
  assert.match(rec.text, /overdue/);
  assert.deepEqual(rec.action, { type: "trace", stepId: "a" });
});

test("a step is only 'unblocked' once every parent has landed", () => {
  const steps = [
    step("landed", { stage: "done", state: "done" }),
    step("live", { stage: "running", state: "running" }),
    step("b", { stage: "backlog", needs: ["landed", "live"] }),
  ];
  const rec = stepRecommendation(steps[2], steps);
  assert.notEqual(rec.action?.type, "move-stage");
  const allDone = [
    step("landed", { stage: "done", state: "done" }),
    step("also", { stage: "done", state: "done" }),
    step("b", { stage: "backlog", needs: ["landed", "also"] }),
  ];
  const go = stepRecommendation(allDone[2], allDone);
  assert.deepEqual(go.action, { type: "move-stage", stepId: "b", stage: "inbox" });
});

test("a step nothing blocks and nothing waits on is left alone, with no action", () => {
  const rec = stepRecommendation(step("a"), [step("a")]);
  assert.equal(rec.action, null);
  assert.equal(rec.actionLabel, null);
  assert.match(rec.text, /not costing you anything/);
});

test("the head of the critical path is called out once two things wait on it", () => {
  const steps = [step("a"), step("b", { needs: ["a"] }), step("c", { needs: ["a"] })];
  assert.match(stepRecommendation(steps[0], steps).text, /critical path/);
});

// ── Decisions ────────────────────────────────────────────────────────────────

test("decisionsOwed reads real needsHuman cards, most-blocking first", () => {
  const steps = [
    step("quiet", { needsHuman: true, updatedAt: "2026-07-30T00:00:00.000Z" }),
    step("loud", { needsHuman: true, notes: "  which way?  " }),
    step("waiting", { needs: ["loud"] }),
    step("normal"),
  ];
  const owed = decisionsOwed(steps);
  assert.deepEqual(owed.map((d) => d.stepId), ["loud", "quiet"]);
  assert.equal(owed[0].framing, "which way?");
  assert.equal(owed[1].framing, null, "a card with no notes carries no framing, and says so");
});

test("a finished card is never owed even when the flag is still set", () => {
  assert.deepEqual(decisionsOwed([step("a", { needsHuman: true, state: "done" })]), []);
});

// ── Capabilities ─────────────────────────────────────────────────────────────

test("a capability is only linked when the card's own labels name it", () => {
  const capabilities: ChartCapability[] = [
    { id: "workflow:review-diff", kind: "workflow", name: "review-diff" },
    { id: "skill:branch-triage", kind: "skill", name: "branch-triage" },
  ];
  assert.deepEqual(
    capabilitiesForStep(step("a", { labels: ["Review-Diff", "unrelated"] }), capabilities).map((c) => c.id),
    ["workflow:review-diff"],
  );
  assert.deepEqual(capabilitiesForStep(step("b"), capabilities), []);
});

// ── Lock ─────────────────────────────────────────────────────────────────────

test("laneOrder gathers related rows at the top without re-sorting the rest", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const order = laneOrder(items, (item) => item.id === "c");
  assert.deepEqual(order, { c: 0, a: 1, b: 2, d: 3 });
});

test("locking a familiar keeps only their steps live", () => {
  const steps = [step("a", { owner: "sage" }), step("b", { owner: "vex" })];
  assert.deepEqual(
    lockedSteps(steps, { kind: "familiar", id: "sage" }, []).map((s) => s.id),
    ["a"],
  );
  assert.equal(lockedSteps(steps, null, []).length, 2);
});

test("locking a step keeps it and its immediate neighbours, across fan-in", () => {
  const steps = [
    step("up"),
    step("up-2"),
    step("me", { needs: ["up", "up-2"] }),
    step("down", { needs: ["me"] }),
    step("far"),
  ];
  assert.deepEqual(
    lockedSteps(steps, { kind: "step", id: "me" }, []).map((s) => s.id).sort(),
    ["down", "me", "up", "up-2"],
  );
});

// ── Layout ───────────────────────────────────────────────────────────────────

const LAYOUT_OPTIONS = {
  columnWidth: 200,
  columnGap: 20,
  nodeHeight: 80,
  nodeGap: 10,
  expandedHeight: 160,
  expanded: new Set<string>(),
  focusId: null,
};

test("flowLayout stacks a column and spans every lane", () => {
  const steps = [step("a", { stage: "backlog" }), step("b", { stage: "backlog" })];
  const layout = flowLayout(steps, LAYOUT_OPTIONS);
  assert.equal(layout.columns.length, CHART_STAGES.length);
  assert.equal(layout.positions.a.y, 40);
  assert.equal(layout.positions.b.y, 130, "the second node clears the first plus the gap");
  assert.equal(layout.width, 6 * 200 + 5 * 20);
});

test("an expanded node pushes the ones below it down", () => {
  const steps = [step("a", { stage: "backlog" }), step("b", { stage: "backlog" })];
  const layout = flowLayout(steps, { ...LAYOUT_OPTIONS, expanded: new Set(["a"]) });
  assert.equal(layout.positions.a.y, 80);
  assert.equal(layout.positions.b.y, 210);
});

test("flowLayout tones an edge by what it waits on", () => {
  const forward = flowLayout(
    [step("a", { stage: "backlog" }), step("b", { stage: "running", needs: ["a"] })],
    LAYOUT_OPTIONS,
  );
  assert.equal(forward.edges[0].tone, "live");

  const late = flowLayout(
    [step("a", { stage: "backlog", state: "overdue" }), step("b", { stage: "running", needs: ["a"] })],
    LAYOUT_OPTIONS,
  );
  assert.equal(late.edges[0].tone, "late");

  const backwards = flowLayout(
    [step("a", { stage: "running" }), step("b", { stage: "backlog", needs: ["a"] })],
    LAYOUT_OPTIONS,
  );
  assert.equal(backwards.edges[0].tone, "backwards");
});

test("flowLayout draws one edge per parent", () => {
  const layout = flowLayout(
    [
      step("a", { stage: "backlog" }),
      step("b", { stage: "inbox" }),
      step("c", { stage: "running", needs: ["a", "b"] }),
    ],
    LAYOUT_OPTIONS,
  );
  assert.deepEqual(layout.edges.map((edge) => edge.id).sort(), ["a->c", "b->c"]);
});

test("focusing a step mutes every edge off its route", () => {
  const layout = flowLayout(
    [
      step("a", { stage: "backlog" }),
      step("b", { stage: "running", needs: ["a"] }),
      step("x", { stage: "backlog" }),
      step("y", { stage: "running", needs: ["x"] }),
    ],
    { ...LAYOUT_OPTIONS, focusId: "a" },
  );
  const tones = Object.fromEntries(layout.edges.map((edge) => [edge.id, edge.tone]));
  assert.equal(tones["a->b"], "live");
  assert.equal(tones["x->y"], "muted");
});

test("graphLayout puts a step to the right of what it waits on", () => {
  const layout = graphLayout([step("a"), step("b", { needs: ["a"] })], {
    nodeWidth: 100,
    nodeHeight: 50,
    columnGap: 40,
    rowGap: 10,
    chain: new Set(),
  });
  assert.equal(layout.positions.a.column, 0);
  assert.equal(layout.positions.b.column, 1);
  assert.deepEqual(
    layout.rankLabels.map((rank) => rank.label),
    ["Can start now", "After 1 step"],
  );
});

test("graphLayout draws the diamond with every edge and max-over-parents columns", () => {
  const layout = graphLayout(
    [step("d"), step("b", { needs: ["d"] }), step("c", { needs: ["d"] }), step("a", { needs: ["b", "c"] })],
    { nodeWidth: 100, nodeHeight: 50, columnGap: 40, rowGap: 10, chain: new Set() },
  );
  assert.equal(layout.positions.a.column, 2);
  assert.equal(layout.edges.length, 4);
});

test("ganttRows start a bar where its gating blocker ends", () => {
  const { rows, span } = ganttRows([step("a"), step("b", { needs: ["a"] })]);
  assert.equal(span, 2);
  const first = rows.find((row) => row.step.id === "a");
  const second = rows.find((row) => row.step.id === "b");
  assert.equal(first?.left, 0);
  assert.equal(second?.left, 50);
  assert.equal(second?.linkAt, 50, "the connector marks where it is waiting");
  assert.equal(first?.linkAt, null);
});

test("with fan-in the gantt connector points at the deepest parent", () => {
  const { rows, span } = ganttRows([
    step("root"),
    step("mid", { needs: ["root"] }),
    step("shallow"),
    step("leaf", { needs: ["shallow", "mid"] }),
  ]);
  assert.equal(span, 3);
  const leaf = rows.find((row) => row.step.id === "leaf");
  // mid is the gate at depth 1; the connector lands where mid's bar ends (2/3).
  assert.equal(leaf?.linkAt, (2 / 3) * 100);
});

// ── Table ────────────────────────────────────────────────────────────────────

const noProject = () => "no project";
const noOwner = () => "unassigned";

test("the attention filter is what needs a person, not merely what is late", () => {
  const steps = [
    step("late", { state: "overdue" }),
    step("owed", { state: "decision" }),
    step("fine"),
    step("linked", { needs: ["fine"] }),
  ];
  assert.deepEqual(
    filterSteps(steps, "", "attention", noOwner, noProject).map((s) => s.id),
    ["late", "owed"],
  );
  assert.deepEqual(
    filterSteps(steps, "", "linked", noOwner, noProject).map((s) => s.id),
    ["linked"],
  );
  assert.deepEqual(filterSteps(steps, "step late", "all", noOwner, noProject).map((s) => s.id), ["late"]);
});

test("sorting by what a step waits on puts unlinked rows last", () => {
  const steps = [step("unlinked"), step("linked", { needs: ["unlinked"] })];
  const sorted = sortSteps(steps, "needs", 1, noOwner, noProject, (id) => `Step ${id}`);
  assert.deepEqual(sorted.map((s) => s.id), ["linked", "unlinked"]);
});

test("sorting by stage follows board order, not the alphabet", () => {
  const steps: ChartStep[] = (["done", "backlog", "running"] as ChartStageId[]).map((stage) =>
    step(stage, { stage }),
  );
  assert.deepEqual(
    sortSteps(steps, "stage", 1, noOwner, noProject, () => "").map((s) => s.id),
    ["backlog", "running", "done"],
  );
});

// ── Summaries ────────────────────────────────────────────────────────────────

test("chainHold points at the first step that stops the route", () => {
  const chain = [step("a", { state: "done" }), step("b", { state: "overdue" }), step("c")];
  assert.equal(chainHold(chain), 1);
  assert.equal(chainHold([step("a"), step("b")]), -1);
});

test("chainSummary counts what is idle behind the hold, not the chain length", () => {
  const held = [step("a", { state: "done" }), step("b", { state: "overdue" }), step("c"), step("d")];
  assert.equal(chainSummary(held), "held at step 2 of 4 — 2 steps idle behind it");
  assert.equal(chainSummary([step("a"), step("b")]), "2 steps, nothing holding it — it can run end to end");
  assert.equal(chainSummary([step("a")]), "", "a lone step is not a route");
});

console.log("chart-room-model.test.ts OK");
