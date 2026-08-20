/**
 * chart-room-model — the Chart Room's charting rules.
 *
 * The room reads the Cave's real board (`/api/board`) and charts a course
 * through it: every step is a real card, every stage is a real board lane, and
 * every move the room offers is a real write. Dependencies are canonical on the
 * card (`Card.dependencies`, phase 1 of cave-wqzf2) and every dependency edit
 * writes canonically; the room's old per-familiar `dependsOn` overlay survives
 * only as a read-side legacy store, unioned in until its edges are imported
 * onto the cards (see `overlayImportPlan`) and the store is retired (phase 7).
 *
 * Everything here is pure and JSX-free so the rules stay unit-testable under
 * plain `node --experimental-strip-types`.
 */

import type {
  Card,
  CardStatus,
  TaskDependencyKind,
  TaskDependencyState,
  TaskRecordOrigin,
} from "@/lib/cave-board-types";
import { dependenciesOf, isGraphEdge } from "../../lib/task-orchestration.ts";
import { COURSE_LANES } from "./navigator-charts.ts";

// ── Stages ───────────────────────────────────────────────────────────────────

export type ChartStageId = CardStatus;

export type ChartStage = {
  id: ChartStageId;
  name: string;
  /** Lanes that are a position in the pipeline, not an exception state. A
   *  blocked or finished card is not "further along" than a running one, so
   *  structural advice never reasons across them. */
  pipeline: boolean;
};

/** Stage columns, in the board's own lane order. Renaming, adding or removing a
 *  stage would mean inventing a lane the board cannot store, so the room does
 *  not offer it — the columns are the board's six lanes and nothing else. */
export const CHART_STAGES: readonly ChartStage[] = COURSE_LANES.map((id) => ({
  id,
  name: {
    backlog: "Backlog",
    inbox: "Inbox",
    running: "Underway",
    review: "Review",
    blocked: "Blocked",
    done: "Done",
  }[id],
  pipeline: id !== "blocked" && id !== "done",
}));

export function stageIndex(id: ChartStageId): number {
  return CHART_STAGES.findIndex((stage) => stage.id === id);
}

export function stageName(id: ChartStageId): string {
  return CHART_STAGES.find((stage) => stage.id === id)?.name ?? id;
}

/** The next lane a step can be pushed into, or null at the end of the board. */
export function nextStage(id: ChartStageId): ChartStage | null {
  return CHART_STAGES[stageIndex(id) + 1] ?? null;
}

export function previousStage(id: ChartStageId): ChartStage | null {
  const at = stageIndex(id);
  return at > 0 ? CHART_STAGES[at - 1] : null;
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** What a step is doing, in the room's vocabulary. Derived from the card — the
 *  room never stores a state of its own. */
export type ChartStepState = "decision" | "overdue" | "running" | "high" | "queued" | "done";

/** Where an upstream edge came from. Canonical records carry their card origin;
 *  `"overlay"` marks a surviving legacy overlay edge not yet imported. */
export type ChartEdgeOrigin = TaskRecordOrigin | "overlay";

/** One upstream task edge, with the canonical facts the room reasons over. */
export type ChartStepEdge = {
  /** The upstream card id this step waits on. */
  needs: string;
  origin: ChartEdgeOrigin;
  state: TaskDependencyState;
  /** True when this edge is the card's primary blocker. */
  primary: boolean;
  /** True when the primary designation is operator-pinned — never auto-demote. */
  pinned: boolean;
};

/** A non-task blocker — GitHub, human, credential, service, execution,
 *  external. Terminal by contract (invariant I3): it renders as a chip and
 *  never enters depth or cycle math. */
export type ChartExternalBlocker = {
  kind: Exclude<TaskDependencyKind, "task">;
  label: string;
  state: TaskDependencyState;
};

export type ChartStep = {
  /** The real board card id. */
  id: string;
  title: string;
  notes: string;
  stage: ChartStageId;
  state: ChartStepState;
  /** Familiar id, or null when the card is unassigned. */
  owner: string | null;
  /** Project id, or null when the card is not tied to one. */
  project: string | null;
  /** Upstream card ids — the union of the card's canonical task dependencies
   *  and any surviving overlay edge. Empty when nothing blocks it. */
  needs: string[];
  /** The same upstreams with their canonical facts, in card priority order. */
  edges: ChartStepEdge[];
  /** Non-task blockers, rendered terminally and excluded from graph math. */
  external: ChartExternalBlocker[];
  /** True when the card is flagged as needing a human. */
  needsHuman: boolean;
  labels: string[];
  endDate: string | null;
  updatedAt: string;
};

/**
 * A card's state, most-urgent first. `decision` outranks `overdue` because a
 * question owed to the operator blocks differently than a late piece of work:
 * one needs an answer, the other needs time.
 */
export function stepState(
  card: Pick<Card, "status" | "priority" | "endDate" | "needsHuman" | "lifecycle">,
  today: string,
): ChartStepState {
  if (card.status === "done") return "done";
  if (card.needsHuman) return "decision";
  if (card.endDate != null && card.endDate !== "" && card.endDate < today) return "overdue";
  if (card.status === "running" || card.lifecycle === "running" || card.lifecycle === "dispatched") {
    return "running";
  }
  if (card.priority === "urgent" || card.priority === "high") return "high";
  return "queued";
}

// ── The legacy chart overlay ─────────────────────────────────────────────────

/**
 * The room's pre-canonical dependency store: step id → the one step it waits
 * on, per-familiar and per-browser. Kept read-only so divergent maps from other
 * navigators or devices are never clobbered — each edge is imported onto the
 * card (`overlayImportPlan`) and survives here only until that import lands.
 * Dependency edits write canonically; the only overlay writes left are prunes.
 */
export type ChartOverlay = {
  /** step id → the step it waits on. One upstream per step — the legacy shape. */
  dependsOn: Record<string, string>;
};

export const EMPTY_OVERLAY: ChartOverlay = { dependsOn: {} };

/**
 * Drop edges that no longer point at a real card, and any self-edge. Cards get
 * archived and deleted underneath the chart; a dangling edge would draw a line
 * to nowhere, so it is pruned on every read rather than left to rot.
 */
export function normalizeOverlay(
  overlay: ChartOverlay | null | undefined,
  liveIds: Iterable<string>,
): ChartOverlay {
  const live = new Set(liveIds);
  const dependsOn: Record<string, string> = {};
  for (const [id, needs] of Object.entries(overlay?.dependsOn ?? {})) {
    if (id === needs) continue;
    if (!live.has(id) || !live.has(needs)) continue;
    dependsOn[id] = needs;
  }
  return { dependsOn };
}

/** Prune one legacy edge — used when a canonical edit supersedes it. */
export function setDependency(overlay: ChartOverlay, stepId: string, needs: string | null): ChartOverlay {
  const dependsOn = { ...overlay.dependsOn };
  if (needs == null || needs === stepId) delete dependsOn[stepId];
  else dependsOn[stepId] = needs;
  return { dependsOn };
}

/** Cut every legacy edge into and out of a step — used when its card leaves the board. */
export function forgetStep(overlay: ChartOverlay, stepId: string): ChartOverlay {
  const dependsOn: Record<string, string> = {};
  for (const [id, needs] of Object.entries(overlay.dependsOn)) {
    if (id === stepId || needs === stepId) continue;
    dependsOn[id] = needs;
  }
  return { dependsOn };
}

/**
 * The overlay edges that still need importing as canonical dependencies:
 * every normalized edge whose card has no canonical task dependency naming the
 * same upstream, in a deterministic order. The import merges — it never
 * overwrites a canonical edge — so once an edge is canonical it drops out of
 * the plan and a re-run is a no-op. Divergent maps from two navigators or two
 * browsers therefore union instead of clobbering each other.
 */
export function overlayImportPlan(
  cards: readonly Card[],
  overlay: ChartOverlay | null | undefined,
): Array<{ stepId: string; needs: string }> {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const plan: Array<{ stepId: string; needs: string }> = [];
  for (const [stepId, needs] of Object.entries(overlay?.dependsOn ?? {})) {
    if (stepId === needs) continue;
    const card = byId.get(stepId);
    if (!card || !byId.has(needs)) continue;
    const already = dependenciesOf(card).some((dep) => isGraphEdge(dep) && dep.taskId === needs);
    if (!already) plan.push({ stepId, needs });
  }
  return plan.sort((a, b) => a.stepId.localeCompare(b.stepId) || a.needs.localeCompare(b.needs));
}

// ── Card → step ──────────────────────────────────────────────────────────────

export function toChartSteps(
  cards: readonly Card[],
  overlay: ChartOverlay,
  today: string,
): ChartStep[] {
  const live = new Set(cards.map((card) => card.id));
  return cards.map((card) => {
    const canonical = dependenciesOf(card);
    const edges: ChartStepEdge[] = [];
    for (const dep of canonical) {
      if (!isGraphEdge(dep)) continue;
      const target = dep.taskId as string;
      if (target === card.id || !live.has(target)) continue;
      const primary = card.primaryBlockerId != null && card.primaryBlockerId === dep.id;
      const existing = edges.findIndex((edge) => edge.needs === target);
      const edge: ChartStepEdge = {
        needs: target,
        origin: dep.origin,
        state: dep.state,
        primary,
        pinned: primary && card.primaryBlockerPinned === true,
      };
      // Two records naming the same upstream collapse to one edge; the primary
      // record wins so the room never loses the pin.
      if (existing === -1) edges.push(edge);
      else if (primary && !edges[existing].primary) edges[existing] = edge;
    }
    const legacy = overlay.dependsOn[card.id];
    if (legacy != null && legacy !== card.id && live.has(legacy) && !edges.some((edge) => edge.needs === legacy)) {
      edges.push({ needs: legacy, origin: "overlay", state: "unresolved", primary: false, pinned: false });
    }
    return {
      id: card.id,
      title: card.title,
      notes: card.notes ?? "",
      stage: card.status,
      state: stepState(card, today),
      owner: card.familiarId ?? null,
      project: card.projectId ?? null,
      needs: edges.map((edge) => edge.needs),
      edges,
      external: canonical
        .filter((dep) => !isGraphEdge(dep))
        .map((dep) => ({
          kind: dep.kind as ChartExternalBlocker["kind"],
          label: dep.label,
          state: dep.state,
        })),
      needsHuman: card.needsHuman === true,
      labels: card.labels ?? [],
      endDate: card.endDate ?? null,
      updatedAt: card.updatedAt,
    };
  });
}

// ── Graph walks ──────────────────────────────────────────────────────────────

/** Mirrors the canonical validator's traversal guard (task-orchestration.ts):
 *  a graph this deep is a data fault, not a chart. */
const GUARD = 1000;

function indexById(steps: readonly ChartStep[]): Map<string, ChartStep> {
  return new Map(steps.map((step) => [step.id, step]));
}

/** Parent ids of a step that point at real steps. */
function parentsOf(byId: Map<string, ChartStep>, id: string): string[] {
  return (byId.get(id)?.needs ?? []).filter((parent) => byId.has(parent));
}

/** Everything waiting directly on this step. */
export function dependants(steps: readonly ChartStep[], id: string): ChartStep[] {
  return steps.filter((step) => step.needs.includes(id));
}

/**
 * Every cycle in the chart, each as ids in walk order (each entry waits on the
 * next, and the last waits on the first). A full DFS over every parent, because
 * fan-in makes accidental loops easier to close and a linear walk would miss
 * any loop off the first-parent spine. Mirrors the canonical `detectCycles`.
 */
export function stepCycles(steps: readonly ChartStep[]): string[][] {
  const byId = indexById(steps);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const settled = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const walk = (id: string, depth: number): void => {
    if (depth >= GUARD) return;
    seen.add(id);
    stack.push(id);
    onStack.add(id);
    for (const parent of parentsOf(byId, id)) {
      if (onStack.has(parent)) {
        cycles.push(stack.slice(stack.indexOf(parent)));
      } else if (!settled.has(parent)) {
        walk(parent, depth + 1);
      }
    }
    stack.pop();
    onStack.delete(id);
    settled.add(id);
  };

  for (const step of steps) {
    if (!seen.has(step.id)) walk(step.id, 0);
  }
  return cycles;
}

/** Ids that sit on any cycle. */
export function cyclicStepIds(steps: readonly ChartStep[]): Set<string> {
  const out = new Set<string>();
  for (const cycle of stepCycles(steps)) {
    for (const id of cycle) out.add(id);
  }
  return out;
}

/**
 * The loop this step sits in, starting at the step and walking parent-ward, or
 * null when its routes are sound. Searches every parent branch — the three-step
 * loops nobody spots by eye now hide behind fan-in as easily as behind length.
 */
export function cycleFor(steps: readonly ChartStep[], id: string): string[] | null {
  const byId = indexById(steps);
  if (!byId.has(id)) return null;
  const path: string[] = [];
  const onPath = new Set<string>();
  const exhausted = new Set<string>();
  let found: string[] | null = null;

  const walk = (cursor: string): void => {
    if (found || path.length >= GUARD) return;
    path.push(cursor);
    onPath.add(cursor);
    for (const parent of parentsOf(byId, cursor)) {
      if (found) break;
      if (parent === id) {
        found = [...path];
        break;
      }
      if (!onPath.has(parent) && !exhausted.has(parent)) walk(parent);
    }
    path.pop();
    onPath.delete(cursor);
    exhausted.add(cursor);
  };

  walk(id);
  return found;
}

/**
 * Longest dependency depth. Rank is what the graph and the gantt lay out on:
 * stage cannot do this job, because two cards in the same lane can be a week
 * apart when one waits on the other. Depth is max-over-parents — a step with
 * two upstreams cannot start until the later one lands — and cycle members
 * resolve to 0 rather than hanging, mirroring the canonical walk.
 */
export function dependencyDepth(steps: readonly ChartStep[]): Record<string, number> {
  const byId = indexById(steps);
  const cyclic = cyclicStepIds(steps);
  const memo: Record<string, number> = {};
  const walk = (id: string, seen: Set<string>): number => {
    if (cyclic.has(id)) {
      memo[id] = 0;
      return 0;
    }
    const cached = memo[id];
    if (cached !== undefined) return cached;
    if (seen.has(id) || seen.size >= GUARD) return 0;
    seen.add(id);
    let depth = 0;
    for (const parent of parentsOf(byId, id)) {
      depth = Math.max(depth, walk(parent, seen) + 1);
    }
    seen.delete(id);
    memo[id] = depth;
    return depth;
  };
  for (const step of steps) walk(step.id, new Set());
  return memo;
}

/** Every id upstream of this one across every parent branch, so a downstream
 *  link can never close a loop. */
export function ancestorsOf(steps: readonly ChartStep[], id: string): Set<string> {
  const byId = indexById(steps);
  const out = new Set<string>();
  const queue = [...parentsOf(byId, id)];
  while (queue.length > 0 && out.size < GUARD) {
    const next = queue.shift() as string;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...parentsOf(byId, next));
  }
  return out;
}

/**
 * The gate: the parent that actually holds a step, i.e. the deepest one — the
 * genuine critical path runs through it, because the step cannot start until
 * its latest-ending upstream lands. Ties break on title then id so the chart
 * never flickers between reads.
 */
export function gateParent(
  steps: readonly ChartStep[],
  id: string,
  depth?: Record<string, number>,
): ChartStep | undefined {
  const byId = indexById(steps);
  const ranks = depth ?? dependencyDepth(steps);
  let gate: ChartStep | undefined;
  for (const parent of parentsOf(byId, id)) {
    const candidate = byId.get(parent);
    if (!candidate) continue;
    if (
      !gate ||
      (ranks[candidate.id] ?? 0) > (ranks[gate.id] ?? 0) ||
      ((ranks[candidate.id] ?? 0) === (ranks[gate.id] ?? 0) &&
        (candidate.title.localeCompare(gate.title) < 0 ||
          (candidate.title === gate.title && candidate.id < gate.id)))
    ) {
      gate = candidate;
    }
  }
  return gate;
}

/**
 * The whole route through a step, root first: up the critical path — at each
 * fan-in the deepest parent, the one the step genuinely waits for — then the
 * single longest line of work waiting on it. Secondary parents stay visible as
 * edges in the lenses; the strip flattens to the path that sets the dates. A
 * lone step is not a route — callers treat a length of one as "no chain".
 */
export function chainOf(steps: readonly ChartStep[], id: string): ChartStep[] {
  const byId = indexById(steps);
  const self = byId.get(id);
  if (!self) return [];
  const depth = dependencyDepth(steps);

  const up: ChartStep[] = [];
  const seenUp = new Set<string>([id]);
  let cursor = gateParent(steps, id, depth);
  let guard = 0;
  while (cursor && !seenUp.has(cursor.id) && guard++ < GUARD) {
    seenUp.add(cursor.id);
    up.unshift(cursor);
    cursor = gateParent(steps, cursor.id, depth);
  }

  const longestDownstream = (head: string, seen: Set<string>, at: number): ChartStep[] => {
    if (at >= GUARD) return [];
    let longest: ChartStep[] = [];
    for (const next of steps) {
      if (!next.needs.includes(head) || seen.has(next.id)) continue;
      const branch = [next, ...longestDownstream(next.id, new Set([...seen, next.id]), at + 1)];
      if (branch.length > longest.length) longest = branch;
    }
    return longest;
  };
  const down = longestDownstream(id, new Set([id, ...seenUp]), 0);

  return [...up, self, ...down];
}

/** The chain lit when a step is hovered or selected: everything upstream of it
 *  across every parent branch, and every step downstream of anything on it. */
export function routeSet(steps: readonly ChartStep[], focusId: string | null): Set<string> {
  const route = new Set<string>();
  if (focusId == null) return route;
  const byId = indexById(steps);
  if (!byId.has(focusId)) return route;
  route.add(focusId);
  for (const ancestor of ancestorsOf(steps, focusId)) route.add(ancestor);
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of steps) {
      if (!route.has(step.id) && step.needs.some((parent) => route.has(parent))) {
        route.add(step.id);
        grew = true;
      }
    }
  }
  return route;
}

// ── What Astra proposes ──────────────────────────────────────────────────────

export type ChartProposalKind = "cycle" | "backwards" | "unblocked" | "stalled";

export type ChartProposal = {
  id: string;
  kind: ChartProposalKind;
  /** The step the repair acts on. */
  stepId: string;
  text: string;
  /** Null when the repair is a place to look rather than a move to make. */
  action: ChartProposalAction | null;
  actionLabel: string;
};

export type ChartProposalAction =
  | { type: "cut-dependency"; stepId: string; needs: string }
  | { type: "move-stage"; stepId: string; stage: ChartStageId }
  | { type: "trace"; stepId: string };

const clip = (text: string, at = 28): string =>
  text.length > at ? `${text.slice(0, at).trim()}…` : text;

/**
 * The edge on a loop that costs least to cut, or null when the operator should
 * pick. Respects the canonical contract: a pinned primary blocker is never
 * proposed for demotion, and a human-authored edge is never proposed for
 * automated removal — the room only volunteers edges automation wrote. Among
 * those it prefers a parent that is already done (or a record already
 * resolved), then a parent in an earlier lane: the least real blocker.
 */
export function weakestCycleEdge(
  steps: readonly ChartStep[],
  cycle: readonly string[],
): { stepId: string; needs: string } | null {
  const byId = indexById(steps);
  let best: { stepId: string; needs: string; score: number; key: string } | null = null;
  for (let index = 0; index < cycle.length; index += 1) {
    const child = byId.get(cycle[index]);
    const parent = byId.get(cycle[(index + 1) % cycle.length]);
    if (!child || !parent) continue;
    const edge = child.edges.find((entry) => entry.needs === parent.id);
    if (!edge || edge.pinned || edge.origin === "human") continue;
    const score =
      parent.state === "done" || edge.state !== "unresolved"
        ? 0
        : stageIndex(parent.stage) < stageIndex(child.stage)
          ? 1
          : 2;
    const key = `${child.id}->${parent.id}`;
    if (!best || score < best.score || (score === best.score && key < best.key)) {
      best = { stepId: child.id, needs: parent.id, score, key };
    }
  }
  return best ? { stepId: best.stepId, needs: best.needs } : null;
}

/**
 * Standing repairs the room would make to the chart. Structural faults only —
 * a loop, an edge running backwards, a leg stalled behind something late.
 * Nothing cosmetic, and nothing applies itself: each one is a staged write the
 * operator accepts or dismisses.
 */
export function chartProposals(steps: readonly ChartStep[]): ChartProposal[] {
  const byId = indexById(steps);
  const out: ChartProposal[] = [];

  const seenCycles = new Set<string>();
  for (const loop of stepCycles(steps)) {
    const key = [...loop].sort().join("|");
    if (seenCycles.has(key)) continue;
    seenCycles.add(key);
    const names = loop.map((id) => clip(byId.get(id)?.title ?? id));
    const cut = weakestCycleEdge(steps, loop);
    out.push({
      id: `cycle:${key}`,
      kind: "cycle",
      stepId: loop[0],
      text:
        loop.length === 2
          ? `${names[0]} and ${names[1]} wait on each other — neither can start.`
          : `${loop.length} steps wait on each other in a loop (${names.join(" → ")}) — none of them can start.`,
      action: cut
        ? { type: "cut-dependency", stepId: cut.stepId, needs: cut.needs }
        : { type: "trace", stepId: loop[0] },
      actionLabel: cut ? "Cut the weakest edge" : "Trace the loop and pick the edge",
    });
  }

  const cyclic = cyclicStepIds(steps);
  for (const step of steps) {
    if (cyclic.has(step.id)) continue;

    // Both sides have to be pipeline lanes. Blocked and Done are exception
    // states, not positions — advising a move across them would be nonsense.
    const stepStage = CHART_STAGES[stageIndex(step.stage)];
    for (const parentId of step.needs) {
      const dep = byId.get(parentId);
      if (!dep) continue;
      const depStage = CHART_STAGES[stageIndex(dep.stage)];
      if (stepStage?.pipeline && depStage?.pipeline && stageIndex(dep.stage) > stageIndex(step.stage)) {
        const to = CHART_STAGES[stageIndex(dep.stage) + 1];
        if (to && to.id !== step.stage) {
          out.push({
            id: `backwards:${step.id}`,
            kind: "backwards",
            stepId: step.id,
            text: `${clip(step.title)} sits before ${clip(dep.title)}, the step it waits on.`,
            action: { type: "move-stage", stepId: step.id, stage: to.id },
            actionLabel: `Move to ${to.name}`,
          });
          break; // One repositioning proposal per step, whichever edge trips first.
        }
      }
    }

    // Unblocked only when every upstream has landed — with fan-in, one parent
    // done and another live is still blocked, so the room stays quiet.
    const parents = step.needs.map((parentId) => byId.get(parentId)).filter(Boolean) as ChartStep[];
    if (parents.length > 0 && parents.every((parent) => parent.state === "done") && step.stage !== "done") {
      const gate = gateParent(steps, step.id);
      const to = nextStage(step.stage);
      if (to && to.id !== "blocked") {
        out.push({
          id: `unblocked:${step.id}`,
          kind: "unblocked",
          stepId: step.id,
          text: `${clip(gate?.title ?? parents[0].title)} landed — ${clip(step.title)} is unblocked and still sitting in ${stageName(step.stage)}.`,
          action: { type: "move-stage", stepId: step.id, stage: to.id },
          actionLabel: `Move to ${to.name}`,
        });
      }
    }
  }

  for (const step of steps) {
    if (step.state !== "overdue") continue;
    const waiting = dependants(steps, step.id);
    if (waiting.length === 0) continue;
    out.push({
      id: `stalled:${step.id}`,
      kind: "stalled",
      stepId: step.id,
      text: `${clip(step.title)} is overdue with ${waiting.length} step${waiting.length > 1 ? "s" : ""} behind it — the whole leg is stalled.`,
      action: { type: "trace", stepId: step.id },
      actionLabel: "Trace the path",
    });
  }

  return out;
}

// ── Astra's read on one step ─────────────────────────────────────────────────

export type ChartRecommendation = {
  iconName: string;
  text: string;
  /** Null when the right move is not one the room can make for you. */
  action: ChartProposalAction | null;
  actionLabel: string | null;
};

/**
 * The single next move for one step, phrased as a recommendation with a
 * one-click apply — never a menu of options where one move is obviously right.
 */
export function stepRecommendation(
  step: ChartStep,
  steps: readonly ChartStep[],
): ChartRecommendation {
  const byId = indexById(steps);
  const parents = step.needs.map((parentId) => byId.get(parentId)).filter(Boolean) as ChartStep[];
  const gate = gateParent(steps, step.id);
  const waiting = dependants(steps, step.id);
  const here = stageName(step.stage);
  const onward = nextStage(step.stage);

  const loop = cycleFor(steps, step.id);
  if (loop) {
    const cut = weakestCycleEdge(steps, loop);
    if (cut) {
      const parent = byId.get(cut.needs);
      return {
        iconName: "ph:arrows-clockwise",
        text: `This step sits in a loop with ${clip(parent?.title ?? "another")} — nothing on it can start. Cut one edge; this is the one to drop.`,
        action: { type: "cut-dependency", stepId: cut.stepId, needs: cut.needs },
        actionLabel: "Cut this edge",
      };
    }
    return {
      iconName: "ph:arrows-clockwise",
      text: `This step sits in a loop of ${loop.length} — nothing on it can start. Every edge is operator-made or pinned, so pick the one to cut yourself.`,
      action: { type: "trace", stepId: step.id },
      actionLabel: "Trace the loop",
    };
  }
  const overdueParent = parents.find((parent) => parent.state === "overdue");
  if (overdueParent) {
    return {
      iconName: "ph:warning-diamond",
      text: `Blocked behind ${clip(overdueParent.title)}, which is overdue. Nothing here moves until that does.`,
      action: { type: "trace", stepId: overdueParent.id },
      actionLabel: "Open the blocker",
    };
  }
  if (step.state === "decision") {
    return {
      iconName: "ph:scales",
      text: "This one is waiting on you, not on work. Answer it and the step is free to move.",
      action: null,
      actionLabel: null,
    };
  }
  if (step.state === "overdue") {
    return waiting.length > 0
      ? {
          iconName: "ph:scissors",
          text: `Past its date with ${waiting.length} step${waiting.length > 1 ? "s" : ""} behind it. Cut scope so the ones waiting can start.`,
          action: { type: "trace", stepId: step.id },
          actionLabel: "Show what waits",
        }
      : {
          iconName: "ph:calendar-x",
          text: "Past its date and nothing waits on it. Re-date it or drop it — a permanently late step teaches the board to ignore dates.",
          action: null,
          actionLabel: null,
        };
  }
  if (parents.length > 0 && parents.every((parent) => parent.state === "done") && onward) {
    return {
      iconName: "ph:arrow-right",
      text: `${clip(gate?.title ?? parents[0].title)} landed, so nothing holds this. Move it to ${onward.name}.`,
      action: { type: "move-stage", stepId: step.id, stage: onward.id },
      actionLabel: `Move to ${onward.name}`,
    };
  }
  if (parents.length === 0 && waiting.length >= 2) {
    return {
      iconName: "ph:flow-arrow",
      text: `${waiting.length} steps wait on this and nothing blocks it — it is the head of the critical path. Start it before anything else in ${here}.`,
      action: { type: "trace", stepId: step.id },
      actionLabel: "Show what waits",
    };
  }
  if (step.state === "running" && onward) {
    return {
      iconName: "ph:check-circle",
      text: `Running clean, nothing blocked behind it. When it lands it belongs in ${onward.name}.`,
      action: { type: "move-stage", stepId: step.id, stage: onward.id },
      actionLabel: `Move to ${onward.name}`,
    };
  }
  return {
    iconName: "ph:check-circle",
    text: `Nothing blocks it and nothing waits on it. Leave it in ${here} — it is not costing you anything where it is.`,
    action: null,
    actionLabel: null,
  };
}

// ── Decisions owed ───────────────────────────────────────────────────────────

/**
 * What is owed by the operator. The board records *that* a card needs a human
 * (`needsHuman`), never a framed question with options and a recommendation —
 * so the ledger shows the real thing: the card, what it says, how long it has
 * waited, and what is stacked behind it. It does not invent tradeoffs.
 */
export type ChartDecision = {
  stepId: string;
  question: string;
  /** The card's own notes, or null when it carries none. */
  framing: string | null;
  project: string | null;
  stage: ChartStageId;
  /** Steps that cannot start until this is answered. */
  blocking: ChartStep[];
  updatedAt: string;
};

export function decisionsOwed(steps: readonly ChartStep[]): ChartDecision[] {
  return steps
    .filter((step) => step.needsHuman && step.state !== "done")
    .map((step) => ({
      stepId: step.id,
      question: step.title,
      framing: step.notes.trim() === "" ? null : step.notes.trim(),
      project: step.project,
      stage: step.stage,
      blocking: dependants(steps, step.id),
      updatedAt: step.updatedAt,
    }))
    .sort((a, b) => b.blocking.length - a.blocking.length || a.updatedAt.localeCompare(b.updatedAt));
}

// ── Capabilities ─────────────────────────────────────────────────────────────

export type ChartCapabilityKind = "workflow" | "skill";

export type ChartCapability = {
  id: string;
  kind: ChartCapabilityKind;
  name: string;
};

/**
 * What a step draws on. The board records no step→capability edge, so the only
 * honest association is the one the operator already wrote down: a card's own
 * labels naming a real workflow or skill. A card that names none simply has no
 * capability edge, and the lane says so.
 */
export function capabilitiesForStep(
  step: ChartStep,
  capabilities: readonly ChartCapability[],
): ChartCapability[] {
  const labels = new Set(step.labels.map((label) => label.trim().toLowerCase()));
  if (labels.size === 0) return [];
  return capabilities.filter((capability) => labels.has(capability.name.trim().toLowerCase()));
}

/**
 * Where each row sits in its lane once the map is locked. Rows related to the
 * lock gather at the top; everything else keeps its original relative order and
 * falls below. Positions rather than a re-sorted list, so the DOM order stays
 * stable and the regroup animates instead of jumping.
 */
export function laneOrder<T extends { id: string }>(
  items: readonly T[],
  isRelated: (item: T) => boolean,
): Record<string, number> {
  const order: Record<string, number> = {};
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (isRelated(a.item) ? 0 : 1) - (isRelated(b.item) ? 0 : 1) || a.index - b.index)
    .forEach((entry, position) => {
      order[entry.item.id] = position;
    });
  return order;
}

/** What the orchestration map is focused on, or null for the whole map. */
export type ChartLock = { kind: "familiar" | "capability" | "step"; id: string };

/** The steps a lock keeps live. Everything else in the map dims. */
export function lockedSteps(
  steps: readonly ChartStep[],
  lock: ChartLock | null,
  capabilities: readonly ChartCapability[],
): ChartStep[] {
  if (lock == null) return [...steps];
  if (lock.kind === "familiar") return steps.filter((step) => step.owner === lock.id);
  if (lock.kind === "capability") {
    return steps.filter((step) => capabilitiesForStep(step, capabilities).some((cap) => cap.id === lock.id));
  }
  const target = steps.find((step) => step.id === lock.id);
  return steps.filter(
    (step) =>
      step.id === lock.id || step.needs.includes(lock.id) || (target?.needs ?? []).includes(step.id),
  );
}

// ── Flow layout ──────────────────────────────────────────────────────────────

export type FlowNodePosition = {
  /** Column index. */
  column: number;
  /** Left and right edge of the column, in canvas px. */
  left: number;
  right: number;
  /** Vertical centre of the node, in canvas px. */
  y: number;
};

export type FlowEdge = {
  id: string;
  d: string;
  /** Which tone the edge carries — resolved to a token by the stylesheet. */
  tone: "live" | "late" | "backwards" | "muted";
  lit: boolean;
  /** Where the arrow head sits. */
  dotX: number;
  dotY: number;
};

/** A rounded elbow from one column to the next. */
export function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = x1 + (x2 - x1) / 2;
  const r = 8;
  if (Math.abs(y2 - y1) < 2) return `M${x1} ${y1} H${x2}`;
  const dir = y2 > y1 ? 1 : -1;
  return `M${x1} ${y1} H${mid - r} Q${mid} ${y1} ${mid} ${y1 + r * dir} V${y2 - r * dir} Q${mid} ${y2} ${mid + r} ${y2} H${x2}`;
}

/** A long arc under the columns, for an edge that runs the wrong way. */
export function backArcPath(x1: number, y1: number, x2: number, y2: number): string {
  const drop = Math.max(y1, y2) + 62;
  return `M${x1} ${y1} C${x1 - 46} ${y1}, ${x2 + 46} ${drop}, ${x2} ${y2}`;
}

export type FlowLayout = {
  columns: Array<{ stage: ChartStage; steps: ChartStep[] }>;
  positions: Record<string, FlowNodePosition>;
  edges: FlowEdge[];
  width: number;
  height: number;
};

export function flowLayout(
  steps: readonly ChartStep[],
  options: {
    columnWidth: number;
    columnGap: number;
    nodeHeight: number;
    nodeGap: number;
    expandedHeight: number;
    expanded: ReadonlySet<string>;
    focusId: string | null;
  },
): FlowLayout {
  const { columnWidth, columnGap, nodeHeight, nodeGap, expandedHeight, expanded, focusId } = options;
  const columns = CHART_STAGES.map((stage) => ({
    stage,
    steps: steps.filter((step) => step.stage === stage.id),
  }));

  const positions: Record<string, FlowNodePosition> = {};
  let tallest = 0;
  columns.forEach((column, index) => {
    let y = 0;
    for (const step of column.steps) {
      const height = expanded.has(step.id) ? expandedHeight : nodeHeight;
      positions[step.id] = {
        column: index,
        left: index * (columnWidth + columnGap),
        right: index * (columnWidth + columnGap) + columnWidth,
        y: y + height / 2,
      };
      y += height + nodeGap;
    }
    tallest = Math.max(tallest, y);
  });

  const lit = routeSet(steps, focusId);
  const onRoute = (id: string) => focusId == null || lit.has(id);
  const byId = indexById(steps);
  const edges: FlowEdge[] = [];
  for (const step of steps) {
    for (const parentId of step.needs) {
      const from = positions[parentId];
      const to = positions[step.id];
      if (!from || !to) continue;
      const source = byId.get(parentId);
      const isLit = onRoute(step.id) && onRoute(parentId);
      if (from.column < to.column) {
        edges.push({
          id: `${parentId}->${step.id}`,
          d: elbowPath(from.right, from.y, to.left, to.y),
          tone: !isLit ? "muted" : source?.state === "overdue" ? "late" : "live",
          lit: isLit && focusId != null,
          dotX: to.left,
          dotY: to.y,
        });
      } else {
        edges.push({
          id: `${parentId}->${step.id}`,
          d: backArcPath(from.left, from.y, to.right, to.y),
          tone: isLit ? "backwards" : "muted",
          lit: false,
          dotX: to.right,
          dotY: to.y,
        });
      }
    }
  }

  return {
    columns,
    positions,
    edges,
    width: CHART_STAGES.length * columnWidth + (CHART_STAGES.length - 1) * columnGap,
    height: Math.max(tallest, 1),
  };
}

// ── Graph layout ─────────────────────────────────────────────────────────────

export type GraphNodePosition = { x: number; y: number; column: number; row: number };

export type GraphLayout = {
  positions: Record<string, GraphNodePosition>;
  /** Column labels, left to right: "Can start now", "After 1 step", … */
  rankLabels: Array<{ depth: number; label: string; x: number }>;
  edges: Array<{ id: string; d: string; tone: "live" | "late" | "backwards"; lit: boolean; arrow: string | null }>;
  width: number;
  height: number;
};

/**
 * Laid out by dependency depth, not by stage: column one is everything that
 * can start today. A traced route is pulled to the top row of every column it
 * passes through, so the chain reads as one line instead of a zigzag.
 */
export function graphLayout(
  steps: readonly ChartStep[],
  options: { nodeWidth: number; nodeHeight: number; columnGap: number; rowGap: number; chain: ReadonlySet<string> },
): GraphLayout {
  const { nodeWidth, nodeHeight, columnGap, rowGap, chain } = options;
  const depth = dependencyDepth(steps);
  const byDepth = new Map<number, ChartStep[]>();
  for (const step of steps) {
    const rank = depth[step.id] ?? 0;
    const bucket = byDepth.get(rank);
    if (bucket) bucket.push(step);
    else byDepth.set(rank, [step]);
  }
  const ranks = [...byDepth.keys()].sort((a, b) => a - b);

  const positions: Record<string, GraphNodePosition> = {};
  let rows = 1;
  ranks.forEach((rank, column) => {
    const bucket = byDepth.get(rank) ?? [];
    bucket.sort(
      (a, b) =>
        (chain.has(b.id) ? 1 : 0) - (chain.has(a.id) ? 1 : 0) ||
        (a.project ?? "").localeCompare(b.project ?? "") ||
        a.title.localeCompare(b.title),
    );
    rows = Math.max(rows, bucket.length);
    bucket.forEach((step, row) => {
      positions[step.id] = {
        x: column * (nodeWidth + columnGap),
        y: row * (nodeHeight + rowGap),
        column,
        row,
      };
    });
  });

  const width = Math.max(nodeWidth, ranks.length * (nodeWidth + columnGap) - columnGap + 20);
  const height = Math.max(nodeHeight, rows * (nodeHeight + rowGap) - rowGap + 30);

  const byId = indexById(steps);
  const edges: GraphLayout["edges"] = [];
  for (const step of steps) {
    for (const parentId of step.needs) {
      const from = positions[parentId];
      const to = positions[step.id];
      if (!from || !to) continue;
      const source = byId.get(parentId);
      const backwards = from.column >= to.column;
      const isLit = chain.has(step.id) && chain.has(parentId);
      const x1 = from.x + nodeWidth;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + nodeHeight / 2;
      edges.push({
        id: `${parentId}->${step.id}`,
        d: backwards
          ? `M${from.x} ${y1} C${from.x - 60} ${y1}, ${x2 + 60} ${y2 + 70}, ${x2 + nodeWidth / 2} ${to.y + nodeHeight}`
          : `M${x1} ${y1} C${x1 + columnGap * 0.62} ${y1}, ${x2 - columnGap * 0.62} ${y2}, ${x2 - 7} ${y2}`,
        tone: backwards ? "backwards" : source?.state === "overdue" ? "late" : "live",
        lit: isLit,
        arrow: backwards ? null : `M${x2 - 7} ${y2 - 4.5} L${x2} ${y2} L${x2 - 7} ${y2 + 4.5} Z`,
      });
    }
  }

  return {
    positions,
    rankLabels: ranks.map((depthValue, column) => ({
      depth: depthValue,
      label: depthValue === 0 ? "Can start now" : `After ${depthValue} step${depthValue > 1 ? "s" : ""}`,
      x: column * (nodeWidth + columnGap),
    })),
    edges,
    width,
    height,
  };
}

// ── Gantt ────────────────────────────────────────────────────────────────────

export type GanttRow = {
  step: ChartStep;
  depth: number;
  /** Percent of the track. */
  left: number;
  width: number;
  /** Where the gating blocker ends, as a percent, or null when nothing blocks it. */
  linkAt: number | null;
  when: string;
};

/**
 * Bars placed by dependency depth, not by a date nobody entered — a step starts
 * where its blocker ends. With fan-in the connector points at the gate: the
 * deepest parent, the one that actually sets the start.
 */
export function ganttRows(steps: readonly ChartStep[]): { rows: GanttRow[]; span: number } {
  const depth = dependencyDepth(steps);
  const span = Math.max(1, ...steps.map((step) => (depth[step.id] ?? 0) + 1));
  const rows = [...steps]
    .sort(
      (a, b) =>
        (depth[a.id] ?? 0) - (depth[b.id] ?? 0) ||
        (a.project ?? "").localeCompare(b.project ?? "") ||
        a.title.localeCompare(b.title),
    )
    .map((step) => {
      const value = depth[step.id] ?? 0;
      const gate = gateParent(steps, step.id, depth);
      const blockerDepth = gate ? depth[gate.id] : undefined;
      return {
        step,
        depth: value,
        left: (value / span) * 100,
        width: (1 / span) * 100,
        linkAt: blockerDepth === undefined ? null : ((blockerDepth + 1) / span) * 100,
        when: value === 0 ? "now" : `after ${value}`,
      };
    });
  return { rows, span };
}

// ── Table ────────────────────────────────────────────────────────────────────

export type ChartSortKey = "project" | "stage" | "title" | "state" | "needs" | "owner";
export type ChartStateFilter = "all" | "attention" | "linked" | "overdue" | "running";

export function filterSteps(
  steps: readonly ChartStep[],
  query: string,
  filter: ChartStateFilter,
  ownerName: (id: string | null) => string,
  projectName: (id: string | null) => string,
): ChartStep[] {
  const needle = query.trim().toLowerCase();
  return steps.filter((step) => {
    if (
      needle !== "" &&
      !`${step.title} ${projectName(step.project)} ${ownerName(step.owner)}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (filter === "all") return true;
    if (filter === "attention") return step.state === "overdue" || step.state === "decision";
    if (filter === "linked") return step.needs.length > 0;
    if (filter === "overdue") return step.state === "overdue";
    return step.state === "running";
  });
}

export function sortSteps(
  steps: readonly ChartStep[],
  key: ChartSortKey,
  direction: 1 | -1,
  ownerName: (id: string | null) => string,
  projectName: (id: string | null) => string,
  titleOf: (id: string) => string,
): ChartStep[] {
  const value = (step: ChartStep): string => {
    switch (key) {
      case "project":
        return projectName(step.project);
      case "stage":
        return String(stageIndex(step.stage)).padStart(3, "0");
      case "state":
        return step.state;
      case "needs":
        // Unlinked rows sort last in either direction's natural reading.
        return step.needs.length > 0 ? titleOf(step.needs[0]) : "￿";
      case "owner":
        return ownerName(step.owner);
      default:
        return step.title.toLowerCase();
    }
  };
  return [...steps].sort((a, b) => value(a).localeCompare(value(b)) * direction);
}

// ── Room summaries ───────────────────────────────────────────────────────────

/**
 * Where a chain stops. The count alone says nothing — what matters is where it
 * is held and how much work is stacked behind that one step.
 */
export function chainHold(chain: readonly ChartStep[]): number {
  return chain.findIndex(
    (step) => step.state === "overdue" || step.state === "decision" || step.state === "running",
  );
}

export function chainSummary(chain: readonly ChartStep[]): string {
  if (chain.length <= 1) return "";
  const hold = chainHold(chain);
  if (hold < 0) return `${chain.length} steps, nothing holding it — it can run end to end`;
  const idle = chain.length - hold - 1;
  return `held at step ${hold + 1} of ${chain.length} — ${idle} step${idle === 1 ? "" : "s"} idle behind it`;
}
