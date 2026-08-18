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

const DEPENDENCY_KINDS = new Set([
  "task",
  "github",
  "human",
  "credential",
  "service",
  "execution",
  "external",
]);
const DEPENDENCY_STATES = new Set(["unresolved", "resolved", "waived"]);
const RECORD_ORIGINS = new Set(["human", "enhance", "system"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isValidDependencyShape(value: unknown): value is TaskDependency {
  if (!isRecord(value)) return false;
  return (
    isNonEmpty(value.id) &&
    typeof value.kind === "string" &&
    DEPENDENCY_KINDS.has(value.kind) &&
    isNonEmpty(value.label) &&
    typeof value.state === "string" &&
    DEPENDENCY_STATES.has(value.state) &&
    typeof value.origin === "string" &&
    RECORD_ORIGINS.has(value.origin) &&
    isTimestamp(value.createdAt) &&
    isOptionalString(value.taskId) &&
    isOptionalString(value.ref) &&
    isOptionalString(value.url) &&
    isOptionalString(value.resolvedAt) &&
    isOptionalString(value.resolvedBy) &&
    isOptionalString(value.evidence)
  );
}

export function dependenciesOf(card: Pick<Card, "dependencies">): TaskDependency[] {
  const raw = (card as { dependencies?: unknown }).dependencies;
  return Array.isArray(raw) ? raw.filter(isValidDependencyShape) : [];
}

export function unresolvedOf(card: Pick<Card, "dependencies">): TaskDependency[] {
  return dependenciesOf(card).filter((dep) => dep.state === "unresolved");
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidNextStepShape(step: unknown): step is TaskNextStep {
  if (!isRecord(step)) return false;
  return (
    typeof step.summary === "string" &&
    typeof step.requiresApproval === "boolean" &&
    typeof step.origin === "string" &&
    RECORD_ORIGINS.has(step.origin) &&
    isTimestamp(step.updatedAt) &&
    isOptionalString(step.actorFamiliarId) &&
    isOptionalString(step.capability) &&
    isOptionalString(step.target) &&
    (step.inputs === undefined ||
      (Array.isArray(step.inputs) && step.inputs.every((input) => typeof input === "string")))
  );
}

export function isValidNextStep(step: TaskNextStep | null | undefined): step is TaskNextStep {
  return isValidNextStepShape(step) && isNonEmpty(step.summary);
}

function sameOptionalString(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameDependency(left: TaskDependency | undefined, right: TaskDependency): boolean {
  return (
    left != null &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.label === right.label &&
    sameOptionalString(left.taskId, right.taskId) &&
    sameOptionalString(left.ref, right.ref) &&
    sameOptionalString(left.url, right.url) &&
    left.state === right.state &&
    left.origin === right.origin &&
    left.createdAt === right.createdAt &&
    sameOptionalString(left.resolvedAt, right.resolvedAt) &&
    sameOptionalString(left.resolvedBy, right.resolvedBy) &&
    sameOptionalString(left.evidence, right.evidence)
  );
}

function sameNextStep(left: TaskNextStep | null | undefined, right: TaskNextStep): boolean {
  return (
    left != null &&
    left.summary === right.summary &&
    sameOptionalString(left.actorFamiliarId, right.actorFamiliarId) &&
    sameOptionalString(left.capability, right.capability) &&
    sameOptionalString(left.target, right.target) &&
    sameStringArray(left.inputs, right.inputs) &&
    left.requiresApproval === right.requiresApproval &&
    left.origin === right.origin &&
    left.updatedAt === right.updatedAt
  );
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

function oversizedComponents(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const adjacent = new Map<string, Set<string>>();
  for (const id of edges.keys()) adjacent.set(id, new Set());
  for (const [id, parents] of edges) {
    for (const parent of parents) {
      adjacent.get(id)?.add(parent);
      adjacent.get(parent)?.add(id);
    }
  }

  const visited = new Set<string>();
  const oversized: string[][] = [];
  for (const id of edges.keys()) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const pending = [id];
    visited.add(id);
    while (pending.length > 0) {
      const next = pending.pop() as string;
      component.push(next);
      for (const neighbor of adjacent.get(next) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (component.length > TRAVERSAL_GUARD) oversized.push(component);
  }
  return oversized;
}

/**
 * Every cycle in the task graph, each as the ids on the loop in walk order.
 * Oversized connected components are returned as cycle-class data faults so
 * traversal guards can never make validation silently pass.
 */
export function detectCycles(cards: readonly Card[]): string[][] {
  const edges = buildEdges(cards);
  const cycles = oversizedComponents(edges);
  const guardFaultIds = new Set(cycles.flat());
  const seen = new Set<string>();
  const settled = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const walk = (id: string, depth: number): void => {
    if (depth >= TRAVERSAL_GUARD) {
      // Defensive fallback: oversized components are filtered before DFS.
      cycles.push([...stack, id]);
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
    if (!guardFaultIds.has(card.id) && !seen.has(card.id)) walk(card.id, 0);
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
  /** Internal resolution transaction that leaves a ready card in Blocked for explicit unblocking. */
  allowReadyBlocked?: boolean;
};

export class OrchestrationValidationError extends Error {
  readonly errors: OrchestrationError[];

  constructor(errors: OrchestrationError[]) {
    super("Task orchestration validation failed");
    this.name = "OrchestrationValidationError";
    this.errors = errors;
  }
}

export function assertValidOrchestration(card: Card, ctx: OrchestrationContext): void {
  const errors = validateOrchestration(card, ctx);
  if (errors.length > 0) throw new OrchestrationValidationError(errors);
}

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
  const rawDependencies = (card as { dependencies?: unknown }).dependencies;
  if (rawDependencies !== undefined && rawDependencies !== null) {
    if (!Array.isArray(rawDependencies)) {
      errors.push({
        code: "dependency_invalid",
        field: "dependencies",
        message: "Dependencies must be an array of complete dependency records.",
      });
    } else {
      const seen = new Set<string>();
      for (const raw of rawDependencies) {
        const dependencyId =
          isRecord(raw) && typeof raw.id === "string" ? raw.id : undefined;
        if (!isValidDependencyShape(raw)) {
          errors.push({
            code: "dependency_invalid",
            field: "dependencies",
            ...(dependencyId ? { dependencyId } : {}),
            message: "Every dependency must include a valid id, kind, label, state, origin, and createdAt.",
          });
          continue;
        }
        if (seen.has(raw.id)) {
          errors.push({
            code: "dependency_invalid",
            field: "dependencies",
            dependencyId: raw.id,
            message: `Dependency id "${raw.id}" is duplicated.`,
          });
        }
        seen.add(raw.id);
      }
    }
  }

  const rawPrimary = (card as { primaryBlockerId?: unknown }).primaryBlockerId;
  if (
    rawPrimary !== undefined &&
    rawPrimary !== null &&
    !isNonEmpty(rawPrimary)
  ) {
    errors.push({
      code: "primary_blocker_invalid",
      field: "primaryBlockerId",
      message: "The primary blocker must be a non-empty dependency id or null.",
    });
  }
  const rawPinned = (card as { primaryBlockerPinned?: unknown }).primaryBlockerPinned;
  if (rawPinned !== undefined && typeof rawPinned !== "boolean") {
    errors.push({
      code: "primary_blocker_invalid",
      field: "primaryBlockerPinned",
      message: "The primary blocker pin must be true or false.",
    });
  }

  const rawNextStep = (card as { nextStep?: unknown }).nextStep;
  if (
    rawNextStep !== undefined &&
    rawNextStep !== null &&
    !isValidNextStepShape(rawNextStep)
  ) {
    errors.push({
      code: "next_step_invalid",
      field: "nextStep",
      message: "The next step must include a summary, approval flag, origin, and updatedAt.",
    });
  }
  if (
    (card.lifecycle === "dispatched" || card.lifecycle === "running") &&
    isValidNextStepShape(rawNextStep) &&
    rawNextStep.requiresApproval
  ) {
    errors.push({
      code: "next_step_requires_approval",
      field: "nextStep",
      message: "Clear the next step's approval requirement before dispatching this task.",
    });
  }

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
    const readyBlocked =
      deps.length > 0 &&
      unresolved.length === 0 &&
      card.primaryBlockerId == null &&
      (
        ctx.allowReadyBlocked === true ||
        (
          ctx.previous?.status === "blocked" &&
          dependenciesOf(ctx.previous).length > 0 &&
          unresolvedOf(ctx.previous).length === 0 &&
          ctx.previous.primaryBlockerId == null
        )
      );
    if (unresolved.length === 0 && !readyBlocked) {
      errors.push({
        code: "blocked_requires_dependency",
        field: "dependencies",
        message: "A blocked task must name at least one unresolved dependency.",
      });
    }

    const primary = deps.find((dep) => dep.id === card.primaryBlockerId);
    if (readyBlocked) {
      // Resolution deliberately does not move the card. Readiness becomes
      // `ready`, and the operator gets an explicit unblocking recommendation.
    } else if (!isNonEmpty(card.primaryBlockerId) || !primary) {
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

    if (!readyBlocked && !isValidNextStep(card.nextStep)) {
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
      !sameNextStep(card.nextStep, prevStep)
    ) {
      errors.push({
        code: "next_step_authorship",
        field: "nextStep",
        message: "This next step was written by a human. Propose a change instead of overwriting it.",
      });
    }
    const currentById = new Map(deps.map((dep) => [dep.id, dep]));
    for (const before of dependenciesOf(ctx.previous)) {
      if (before.origin !== "human") continue;
      if (!sameDependency(currentById.get(before.id), before)) {
        errors.push({
          code: "dependency_authorship",
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
 * it cannot drift out of step with the dependencies it describes. List callers
 * should compute `cyclicIds(cards)` once and pass it as the third argument.
 */
export function deriveReadiness(
  card: Card,
  cards: readonly Card[],
  cyclic: ReadonlySet<string> = cyclicIds(cards),
): TaskReadiness {
  if (cyclic.has(card.id)) return "cyclic";

  const unresolved = unresolvedOf(card);
  if (card.status === "blocked") {
    if (unresolved.length === 0) {
      return dependenciesOf(card).length > 0 && card.primaryBlockerId == null
        ? "ready"
        : "incomplete";
    }
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
 * cleanup queue instead of failing a read. List callers can reuse the same
 * precomputed cycle set accepted by `deriveReadiness`.
 */
export function repairRecommendations(
  card: Card,
  cards: readonly Card[],
  cyclic: ReadonlySet<string> = cyclicIds(cards),
): RepairRecommendation[] {
  const out: RepairRecommendation[] = [];
  const deps = dependenciesOf(card);
  const unresolved = unresolvedOf(card);

  if (cyclic.has(card.id)) {
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

    if ((unresolved.length > 0 || deps.length === 0) && !isValidNextStep(card.nextStep)) {
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
