// Orchestration contract for Cave tasks: what blocks a task, and what happens
// next. Pure functions only — no I/O, no board access — so every write path
// (create, patch, drag, bulk edit, lifecycle, Enhance) can share one validator
// without importing the board module. Phase 2 wires these into the cave-board.ts
// mutators, which is the only chokepoint every caller passes through; Enhance
// calls updateCard directly and would bypass route-level checks.
//
// Contract: docs/orchestration-ready-tasks.md
// Design:   docs/superpowers/specs/2026-08-03-orchestration-ready-task-shape-design.md

import type {
  Card,
  OrchestrationError,
  TaskDependency,
  TaskNextStep,
  TaskReadiness,
} from "@/lib/cave-board-types";

/**
 * Depth/cycle walks bail past this. The old Chart Room walk returned null here,
 * silently reporting "no cycle" on a long chain; a graph this size is a data
 * fault, so it now surfaces as `dependency_cycle` rather than passing.
 */
export const TRAVERSAL_GUARD = 1000;

/** Only task edges form the graph. Everything else is a terminal blocker. */
export function isGraphEdge(dep: TaskDependency): boolean {
  return dep.kind === "task" && typeof dep.taskId === "string" && dep.taskId.length > 0;
}

export function dependenciesOf(card: Pick<Card, "dependencies">): TaskDependency[] {
  return card.dependencies ?? [];
}

export function unresolvedOf(card: Pick<Card, "dependencies">): TaskDependency[] {
  return dependenciesOf(card).filter((dep) => dep.state === "unresolved");
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidNextStep(step: TaskNextStep | null | undefined): step is TaskNextStep {
  return step != null && isNonEmpty(step.summary);
}

// ── Graph ────────────────────────────────────────────────────────────────────

/** Adjacency over task edges only, dropping references to cards that don't exist. */
function buildEdges(cards: readonly Card[]): Map<string, string[]> {
  const live = new Set(cards.map((card) => card.id));
  const edges = new Map<string, string[]>();
  for (const card of cards) {
    const parents = dependenciesOf(card)
      .filter(isGraphEdge)
      .map((dep) => dep.taskId as string)
      .filter((id) => live.has(id));
    edges.set(card.id, parents);
  }
  return edges;
}

/**
 * Every cycle in the task graph, each as the ids on the loop in walk order.
 * A full multi-parent DFS: the single-upstream walk this replaces could not see
 * a loop that closed through a sibling parent, so `cyclic` was under-reported.
 */
export function detectCycles(cards: readonly Card[]): string[][] {
  const edges = buildEdges(cards);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const settled = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  // Any component that hits the traversal guard is treated as a data fault
  // (contract I4). We must mark every member of such a component as cyclic,
  // not just the nodes visited before the guard fired. Collect the oversized
  // component roots here and fan-out afterward.
  const guardedRoots = new Set<string>();

  const walk = (id: string, depth: number): void => {
    if (depth >= TRAVERSAL_GUARD) {
      // Guard hit: record a cycle spanning the current stack and flag the
      // root so all reachable members get swept in the post-pass below.
      cycles.push([...stack, id]);
      guardedRoots.add(stack[0] ?? id);
      return;
    }
    seen.add(id);
    stack.push(id);
    onStack.add(id);
    for (const parent of edges.get(id) ?? []) {
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

  for (const card of cards) {
    if (!seen.has(card.id)) walk(card.id, 0);
  }

  // Ensure every node reachable from a guarded root is included in a cycle
  // entry so that `cyclicIds` marks them all, not only the visited prefix.
  if (guardedRoots.size > 0) {
    const guardedMembers: string[] = [];
    const bfsVisited = new Set<string>();
    const queue = [...guardedRoots];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (bfsVisited.has(next)) continue;
      bfsVisited.add(next);
      guardedMembers.push(next);
      queue.push(...(edges.get(next) ?? []));
    }
    cycles.push(guardedMembers);
  }
  return cycles;
}

/** Ids that sit on any cycle. What `cyclic` readiness keys on. */
export function cyclicIds(cards: readonly Card[]): Set<string> {
  const out = new Set<string>();
  for (const cycle of detectCycles(cards)) {
    for (const id of cycle) out.add(id);
  }
  return out;
}

/**
 * Longest distance to a root, for graph and gantt layout. Depth is
 * max-over-parents because a card with two upstreams cannot start until the
 * later one lands. Cards on a cycle resolve to 0 rather than hanging.
 */
export function dependencyDepth(cards: readonly Card[]): Record<string, number> {
  const edges = buildEdges(cards);
  // Cycle members always get depth 0 so they never contribute misleading Gantt
  // bars. Compute membership first, then skip cyclic nodes in the depth walk.
  const cyclic = cyclicIds(cards);
  const memo: Record<string, number> = {};
  const walk = (id: string, seen: Set<string>): number => {
    if (cyclic.has(id)) {
      memo[id] = 0;
      return 0;
    }
    const cached = memo[id];
    if (cached !== undefined) return cached;
    if (seen.has(id) || seen.size >= TRAVERSAL_GUARD) return 0;
    seen.add(id);
    let depth = 0;
    for (const parent of edges.get(id) ?? []) {
      depth = Math.max(depth, walk(parent, seen) + 1);
    }
    seen.delete(id);
    memo[id] = depth;
    return depth;
  };
  for (const card of cards) walk(card.id, new Set());
  return memo;
}

/** Every id upstream of this one, so a new edge can be checked before it closes a loop. */
export function ancestorsOf(cards: readonly Card[], id: string): Set<string> {
  const edges = buildEdges(cards);
  const out = new Set<string>();
  const queue = [...(edges.get(id) ?? [])];
  while (queue.length > 0 && out.size < TRAVERSAL_GUARD) {
    const next = queue.shift() as string;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...(edges.get(next) ?? []));
  }
  return out;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type OrchestrationContext = {
  /** The board the card is being written into, for dangling and cycle checks. */
  cards: readonly Card[];
  /** The card's prior state, when this is an update. Drives the authorship guard. */
  previous?: Card | null;
  /** True when the writer is automation (Enhance or a system transition). */
  automated?: boolean;
};

/**
 * Every way a write can violate the contract. Returns all of them rather than
 * the first, so the inspector can mark every bad field in one pass instead of
 * making the operator fix them one round-trip at a time.
 */
export function validateOrchestration(
  card: Card,
  ctx: OrchestrationContext,
): OrchestrationError[] {
  const errors: OrchestrationError[] = [];
  const deps = dependenciesOf(card);
  const unresolved = unresolvedOf(card);
  const live = new Set(ctx.cards.map((other) => other.id));

  // I5 — leaving unresolved requires proof.
  for (const dep of deps) {
    if (dep.state !== "unresolved" && !isNonEmpty(dep.evidence)) {
      errors.push({
        code: "dependency_needs_evidence",
        field: "dependencies",
        dependencyId: dep.id,
        message: `Dependency "${dep.label}" is ${dep.state} without evidence. Record what proves it.`,
      });
    }
  }

  // I4 — a task edge must name a live card.
  for (const dep of deps) {
    if (dep.kind !== "task") continue;
    if (!isNonEmpty(dep.taskId) || !live.has(dep.taskId)) {
      errors.push({
        code: "dependency_dangling",
        field: "dependencies",
        dependencyId: dep.id,
        message: `Dependency "${dep.label}" points at a task that no longer exists.`,
      });
    } else if (dep.taskId === card.id) {
      errors.push({
        code: "dependency_cycle",
        field: "dependencies",
        dependencyId: dep.id,
        message: "A task cannot depend on itself.",
      });
    }
  }

  // I4 — and it must not close a loop. Skipped when a direct self-reference
  // already reported, so the inspector gets one error per fault rather than two.
  const alreadyCyclic = errors.some((error) => error.code === "dependency_cycle");
  const projected = ctx.cards.some((other) => other.id === card.id)
    ? ctx.cards.map((other) => (other.id === card.id ? card : other))
    : [...ctx.cards, card];
  if (!alreadyCyclic && cyclicIds(projected).has(card.id)) {
    errors.push({
      code: "dependency_cycle",
      field: "dependencies",
      message: "These dependencies close a cycle, so nothing on it can ever start.",
    });
  }

  // I1 — the blocked triple. Legacy cards are read-only-tolerated (I8); this is
  // the write path, so the contract is strict here.
  if (card.status === "blocked") {
    if (unresolved.length === 0) {
      errors.push({
        code: "blocked_requires_dependency",
        field: "dependencies",
        message: "A blocked task must name at least one unresolved dependency.",
      });
    }

    const primary = deps.find((dep) => dep.id === card.primaryBlockerId);
    if (!isNonEmpty(card.primaryBlockerId) || !primary) {
      if (unresolved.length > 0) {
        errors.push({
          code: "blocked_requires_primary",
          field: "primaryBlockerId",
          message: "A blocked task must name which dependency is the primary blocker.",
        });
      }
    } else if (primary.state !== "unresolved") {
      errors.push({
        code: "blocked_requires_primary",
        field: "primaryBlockerId",
        dependencyId: primary.id,
        message: `The primary blocker "${primary.label}" is already ${primary.state}. Promote another.`,
      });
    }

    if (!isValidNextStep(card.nextStep)) {
      errors.push({
        code: "blocked_requires_next_step",
        field: "nextStep",
        message: "A blocked task must carry one imperative next step.",
      });
    }
  } else if (isNonEmpty(card.primaryBlockerId) && !deps.some((dep) => dep.id === card.primaryBlockerId)) {
    // A stale pointer left by a delete is a fault in any lane, not just blocked.
    errors.push({
      code: "dependency_dangling",
      field: "primaryBlockerId",
      message: "The primary blocker names a dependency this task no longer has.",
    });
  }

  // I6 — automation proposes against human authorship, never overwrites it.
  if (ctx.automated && ctx.previous) {
    const prevStep = ctx.previous.nextStep;
    if (
      prevStep?.origin === "human" &&
      JSON.stringify(card.nextStep ?? null) !== JSON.stringify(prevStep)
    ) {
      errors.push({
        code: "next_step_authorship",
        field: "nextStep",
        message: "This next step was written by a human. Propose a change instead of overwriting it.",
      });
    }
    // Iterate the *previous* human-authored dependencies, not the new ones.
    // This catches deletions and field-level rewrites beyond label/kind/taskId.
    // Use key-sorted serialisation so insertion-order differences don't produce
    // false positives when the same record is round-tripped through two paths.
    const sortedJSON = (v: unknown): string =>
      v == null ? JSON.stringify(v) : JSON.stringify(v, Object.keys(v as object).sort());
    const newById = new Map(deps.map((dep) => [dep.id, dep]));
    for (const before of dependenciesOf(ctx.previous)) {
      if (before.origin !== "human") continue;
      const after = newById.get(before.id);
      if (sortedJSON(after ?? null) !== sortedJSON(before)) {
        errors.push({
          code: "next_step_authorship",
          field: "dependencies",
          dependencyId: before.id,
          message: `Dependency "${before.label}" was written by a human. Propose a change instead of overwriting it.`,
        });
      }
    }
  }

  return errors;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * Readiness is computed on read from the fields above and never persisted, so
 * it cannot drift out of step with the dependencies it describes.
 */
export function deriveReadiness(card: Card, cards: readonly Card[]): TaskReadiness {
  if (cyclicIds(cards).has(card.id)) return "cyclic";

  const unresolved = unresolvedOf(card);
  if (card.status === "blocked") {
    const primary = dependenciesOf(card).find((dep) => dep.id === card.primaryBlockerId);
    const complete =
      unresolved.length > 0 && primary?.state === "unresolved" && isValidNextStep(card.nextStep);
    return complete ? "waiting" : "incomplete";
  }

  return unresolved.length > 0 ? "waiting" : "ready";
}

export type RepairRecommendation = {
  code: OrchestrationError["code"];
  field: OrchestrationError["field"];
  /** Imperative, addressed to whoever opens the card. */
  action: string;
};

/**
 * What a task is missing, phrased as the action that fixes it. Tasks blocked
 * before this contract existed stay readable (I8) — they surface here as a
 * cleanup queue instead of failing a read.
 */
export function repairRecommendations(card: Card, cards: readonly Card[]): RepairRecommendation[] {
  const out: RepairRecommendation[] = [];
  const deps = dependenciesOf(card);
  const unresolved = unresolvedOf(card);

  if (cyclicIds(cards).has(card.id)) {
    out.push({
      code: "dependency_cycle",
      field: "dependencies",
      action: "Break the dependency cycle — nothing on it can start until you do.",
    });
  }

  if (card.status === "blocked") {
    if (unresolved.length === 0) {
      out.push({
        code: "blocked_requires_dependency",
        field: "dependencies",
        action:
          deps.length === 0
            ? "Name what blocks this task, or move it out of Blocked."
            : "Every dependency here is resolved — move this task out of Blocked.",
      });
    } else {
      const primary = deps.find((dep) => dep.id === card.primaryBlockerId);
      if (!primary || primary.state !== "unresolved") {
        out.push({
          code: "blocked_requires_primary",
          field: "primaryBlockerId",
          action: `Choose the primary blocker from the ${unresolved.length} unresolved ${
            unresolved.length === 1 ? "dependency" : "dependencies"
          }.`,
        });
      }
    }

    if (!isValidNextStep(card.nextStep)) {
      out.push({
        code: "blocked_requires_next_step",
        field: "nextStep",
        action: "Write the next step as one imperative action.",
      });
    }
  }

  const live = new Set(cards.map((other) => other.id));
  for (const dep of deps) {
    if (dep.kind === "task" && (!isNonEmpty(dep.taskId) || !live.has(dep.taskId))) {
      out.push({
        code: "dependency_dangling",
        field: "dependencies",
        action: `Re-point or remove "${dep.label}" — the task it waits on is gone.`,
      });
    }
    if (dep.state !== "unresolved" && !isNonEmpty(dep.evidence)) {
      out.push({
        code: "dependency_needs_evidence",
        field: "dependencies",
        action: `Record what proves "${dep.label}" is ${dep.state}.`,
      });
    }
  }

  return out;
}
