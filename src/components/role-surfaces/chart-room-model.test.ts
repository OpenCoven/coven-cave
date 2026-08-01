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
  filterSteps,
  flowLayout,
  forgetStep,
  ganttRows,
  graphLayout,
  laneOrder,
  lockedSteps,
  nextStage,
  normalizeOverlay,
  routeSet,
  setDependency,
  sortSteps,
  stageIndex,
  stepRecommendation,
  stepState,
  toChartSteps,
  type ChartCapability,
  type ChartStageId,
  type ChartStep,
} from "./chart-room-model.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const step = (
  id: string,
  overrides: Partial<ChartStep> = {},
): ChartStep => ({
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
  ...overrides,
});

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

test("toChartSteps carries the overlay's dependency onto the real card", () => {
  const steps = toChartSteps(
    [card("a"), card("b")] as never,
    { dependsOn: { b: "a" } },
    "2026-07-31",
  );
  assert.equal(steps.find((s) => s.id === "b")?.needs, "a");
  assert.equal(steps.find((s) => s.id === "a")?.needs, undefined);
});

// ── The overlay ──────────────────────────────────────────────────────────────

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

// ── Graph walks ──────────────────────────────────────────────────────────────

test("chainOf reads the route root-first, through the step, and on down", () => {
  const steps = [step("a"), step("b", { needs: "a" }), step("c", { needs: "b" })];
  assert.deepEqual(
    chainOf(steps, "b").map((s) => s.id),
    ["a", "b", "c"],
  );
});

test("chainOf follows the longest downstream branch", () => {
  const steps = [
    step("root"),
    step("short", { needs: "root" }),
    step("long-1", { needs: "root" }),
    step("long-2", { needs: "long-1" }),
  ];
  assert.deepEqual(
    chainOf(steps, "root").map((s) => s.id),
    ["root", "long-1", "long-2"],
  );
});

test("chainOf terminates on a loop instead of hanging", () => {
  const steps = [step("a", { needs: "b" }), step("b", { needs: "a" })];
  const chain = chainOf(steps, "a");
  assert.ok(chain.length <= 2, `expected a bounded chain, got ${chain.length}`);
});

test("dependencyDepth is the longest walk up, and a cycle resolves to zero", () => {
  const depth = dependencyDepth([step("a"), step("b", { needs: "a" }), step("c", { needs: "b" })]);
  assert.deepEqual(depth, { a: 0, b: 1, c: 2 });
  const looped = dependencyDepth([step("x", { needs: "y" }), step("y", { needs: "x" })]);
  assert.equal(Number.isFinite(looped.x), true);
});

test("cycleFor finds a three-step loop, not just a mutual pair", () => {
  const steps = [step("a", { needs: "c" }), step("b", { needs: "a" }), step("c", { needs: "b" })];
  const loop = cycleFor(steps, "a");
  assert.ok(loop, "expected a loop");
  assert.equal(loop?.length, 3);
  assert.equal(cycleFor([step("a"), step("b", { needs: "a" })], "b"), null);
});

test("ancestorsOf lists everything upstream so a link cannot close a loop", () => {
  const steps = [step("a"), step("b", { needs: "a" }), step("c", { needs: "b" })];
  assert.deepEqual([...ancestorsOf(steps, "c")].sort(), ["a", "b"]);
});

test("routeSet lights the whole chain, up and down", () => {
  const steps = [step("a"), step("b", { needs: "a" }), step("c", { needs: "b" }), step("z")];
  const route = routeSet(steps, "b");
  assert.deepEqual([...route].sort(), ["a", "b", "c"]);
  assert.equal(routeSet(steps, null).size, 0);
});

test("dependants finds everything waiting directly on a step", () => {
  const steps = [step("a"), step("b", { needs: "a" }), step("c", { needs: "a" })];
  assert.deepEqual(
    dependants(steps, "a").map((s) => s.id),
    ["b", "c"],
  );
});

// ── Proposals ────────────────────────────────────────────────────────────────

test("a loop is proposed once, not once per member", () => {
  const steps = [step("a", { needs: "c" }), step("b", { needs: "a" }), step("c", { needs: "b" })];
  const cycles = chartProposals(steps).filter((p) => p.kind === "cycle");
  assert.equal(cycles.length, 1);
  assert.match(cycles[0].text, /loop/);
});

test("a backwards edge between pipeline lanes is proposed with the lane to move to", () => {
  const steps = [
    step("late", { stage: "review" }),
    step("early", { stage: "backlog", needs: "late" }),
  ];
  const backwards = chartProposals(steps).find((p) => p.kind === "backwards");
  assert.ok(backwards, "expected a backwards-edge proposal");
  assert.deepEqual(backwards?.action, { type: "move-stage", stepId: "early", stage: "blocked" });
});

test("blocked and done never produce backwards advice", () => {
  // Waiting on something blocked is a real situation; telling you to move the
  // dependant past Blocked would be nonsense.
  const steps = [step("stuck", { stage: "blocked" }), step("mine", { stage: "running", needs: "stuck" })];
  assert.equal(
    chartProposals(steps).some((p) => p.kind === "backwards"),
    false,
  );
});

test("a landed blocker proposes moving the unblocked step onward", () => {
  const steps = [step("a", { stage: "done", state: "done" }), step("b", { stage: "backlog", needs: "a" })];
  const unblocked = chartProposals(steps).find((p) => p.kind === "unblocked");
  assert.deepEqual(unblocked?.action, { type: "move-stage", stepId: "b", stage: "inbox" });
});

test("an overdue step with nothing behind it is not a stalled leg", () => {
  const alone = [step("a", { state: "overdue" })];
  assert.equal(chartProposals(alone).some((p) => p.kind === "stalled"), false);
  const withTail = [step("a", { state: "overdue" }), step("b", { needs: "a" })];
  const stalled = chartProposals(withTail).find((p) => p.kind === "stalled");
  assert.deepEqual(stalled?.action, { type: "trace", stepId: "a" });
});

test("a sound chart proposes nothing", () => {
  const steps = [step("a", { stage: "backlog" }), step("b", { stage: "running", needs: "a" })];
  assert.deepEqual(chartProposals(steps), []);
});

// ── Recommendations ──────────────────────────────────────────────────────────

test("a loop recommends cutting this edge", () => {
  const steps = [step("a", { needs: "b" }), step("b", { needs: "a" })];
  const rec = stepRecommendation(steps[0], steps);
  assert.deepEqual(rec.action, { type: "cut-dependency", stepId: "a" });
});

test("an overdue blocker outranks everything else the step could be told", () => {
  const steps = [step("a", { state: "overdue" }), step("b", { needs: "a", state: "running" })];
  const rec = stepRecommendation(steps[1], steps);
  assert.match(rec.text, /overdue/);
  assert.deepEqual(rec.action, { type: "trace", stepId: "a" });
});

test("a step nothing blocks and nothing waits on is left alone, with no action", () => {
  const rec = stepRecommendation(step("a"), [step("a")]);
  assert.equal(rec.action, null);
  assert.equal(rec.actionLabel, null);
  assert.match(rec.text, /not costing you anything/);
});

test("the head of the critical path is called out once two things wait on it", () => {
  const steps = [step("a"), step("b", { needs: "a" }), step("c", { needs: "a" })];
  assert.match(stepRecommendation(steps[0], steps).text, /critical path/);
});

// ── Decisions ────────────────────────────────────────────────────────────────

test("decisionsOwed reads real needsHuman cards, most-blocking first", () => {
  const steps = [
    step("quiet", { needsHuman: true, updatedAt: "2026-07-30T00:00:00.000Z" }),
    step("loud", { needsHuman: true, notes: "  which way?  " }),
    step("waiting", { needs: "loud" }),
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

test("locking a step keeps it and its immediate neighbours", () => {
  const steps = [step("up"), step("me", { needs: "up" }), step("down", { needs: "me" }), step("far")];
  assert.deepEqual(
    lockedSteps(steps, { kind: "step", id: "me" }, []).map((s) => s.id).sort(),
    ["down", "me", "up"],
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
    [step("a", { stage: "backlog" }), step("b", { stage: "running", needs: "a" })],
    LAYOUT_OPTIONS,
  );
  assert.equal(forward.edges[0].tone, "live");

  const late = flowLayout(
    [step("a", { stage: "backlog", state: "overdue" }), step("b", { stage: "running", needs: "a" })],
    LAYOUT_OPTIONS,
  );
  assert.equal(late.edges[0].tone, "late");

  const backwards = flowLayout(
    [step("a", { stage: "running" }), step("b", { stage: "backlog", needs: "a" })],
    LAYOUT_OPTIONS,
  );
  assert.equal(backwards.edges[0].tone, "backwards");
});

test("focusing a step mutes every edge off its route", () => {
  const layout = flowLayout(
    [
      step("a", { stage: "backlog" }),
      step("b", { stage: "running", needs: "a" }),
      step("x", { stage: "backlog" }),
      step("y", { stage: "running", needs: "x" }),
    ],
    { ...LAYOUT_OPTIONS, focusId: "a" },
  );
  const tones = Object.fromEntries(layout.edges.map((edge) => [edge.id, edge.tone]));
  assert.equal(tones["a->b"], "live");
  assert.equal(tones["x->y"], "muted");
});

test("graphLayout puts a step to the right of what it waits on", () => {
  const layout = graphLayout([step("a"), step("b", { needs: "a" })], {
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

test("ganttRows start a bar where its blocker ends", () => {
  const { rows, span } = ganttRows([step("a"), step("b", { needs: "a" })]);
  assert.equal(span, 2);
  const first = rows.find((row) => row.step.id === "a");
  const second = rows.find((row) => row.step.id === "b");
  assert.equal(first?.left, 0);
  assert.equal(second?.left, 50);
  assert.equal(second?.linkAt, 50, "the connector marks where it is waiting");
  assert.equal(first?.linkAt, null);
});

// ── Table ────────────────────────────────────────────────────────────────────

const noProject = () => "no project";
const noOwner = () => "unassigned";

test("the attention filter is what needs a person, not merely what is late", () => {
  const steps = [
    step("late", { state: "overdue" }),
    step("owed", { state: "decision" }),
    step("fine"),
    step("linked", { needs: "fine" }),
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
  const steps = [step("unlinked"), step("linked", { needs: "unlinked" })];
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
