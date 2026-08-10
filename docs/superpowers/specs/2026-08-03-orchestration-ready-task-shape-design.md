# Orchestration-Ready Task Shape Design

**Date:** 2026-08-03 · **Bead:** `cave-wqzf2` · **Status:** approved design, not yet implemented
**Reviewers:** Astra (implementation alignment), Sage (research and best practice)

Cave tasks are the unit of work every familiar, surface, and orchestrator reads.
Today a task can say it is Blocked without saying *what* blocks it or *what
happens next*, so no agent can pick the task up and act without asking a human
to reconstruct the context. This spec defines the task shape that closes that
gap.

Companion operating guide: [`../../orchestration-ready-tasks.md`](../../orchestration-ready-tasks.md).

## Goal

Make every Cave task self-describing enough that an orchestrator can answer three
questions from the task alone:

1. **Can this start?** — is anything unresolved holding it.
2. **What is the single thing holding it?** — one named primary blocker.
3. **What is the next concrete action?** — an imperative step with an actor, a
   capability, and a target.

The design must do this without weakening the human approval boundary and
without letting model-generated guesses silently rewrite orchestration data.

## Current state

- `Card` (`src/lib/cave-board-types.ts`) carries status, lifecycle, familiar,
  session, project, dates, retries, steps, `needsHuman`, and integrations. It has
  no dependency field and no next-step field.
- Chart Room keeps dependencies in a private overlay
  (`src/components/role-surfaces/chart-room-model.ts`) shaped
  `dependsOn: Record<string, string>` — **one** upstream per card, persisted in
  per-familiar browser storage (`src/lib/role-surface-state.ts`). The server,
  other familiars, and other devices cannot see it.
- `docs/role-surfaces.md` documents this as a deliberate workaround: "the one
  thing the board cannot store is which card *waits on* which".
- Enhance (`src/app/api/board/enrich-steps/route.ts`) writes notes, steps,
  state, dates, links, GitHub data, sessions, and `needsHuman` — nothing
  orchestration-shaped. It calls `updateCard` directly, bypassing route
  handlers.
- Blocked is reachable from lifecycle failure: `transitionCard` routes `failed`
  and `cancelled` to `status: "blocked"`, and retry exhaustion auto-rolls a card
  to blocked with `needsHuman`. Board drag and bulk move do the same.

## Data contract

Three additive fields on `Card`. Everything else is derived.

```ts
export type TaskDependencyKind =
  | "task"        // another Cave task
  | "github"      // issue, PR, check, release
  | "human"       // a decision or approval owed by a person
  | "credential"  // a secret, key, or account that must exist
  | "service"     // an external system that must be reachable or provisioned
  | "execution"   // a failed or cancelled run that must be resolved
  | "external"    // any other named, resolvable condition

export type TaskDependencyState = "unresolved" | "resolved" | "waived";

export type TaskDependency = {
  /** Stable id, generated once, never reused. Referenced by primaryBlockerId. */
  id: string;
  kind: TaskDependencyKind;
  /** Imperative human sentence: "Merge PR #4201", "Approve the pricing copy". */
  label: string;
  /** Set only when kind === "task". Must resolve to a live card id. */
  taskId?: string | null;
  /** Stable external identity: "OpenCoven/coven-cave#4201", "svc:tailscale". */
  ref?: string | null;
  url?: string | null;
  state: TaskDependencyState;
  /** Who created it. Governs whether automation may rewrite it. */
  origin: "human" | "enhance" | "system";
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  /** Required to move to resolved/waived: what proves it. */
  evidence?: string | null;
};

export type TaskNextStep = {
  /** Imperative, one action, no conjunctions: "Rerun the failed e2e job". */
  summary: string;
  actorFamiliarId?: string | null;
  /** Named capability, skill, or tool the actor uses. */
  capability?: string | null;
  /** Repo, path, URL, project, or session the action lands on. */
  target?: string | null;
  inputs?: string[];
  /** True routes the step through the human gate before any dispatch. */
  requiresApproval: boolean;
  origin: "human" | "enhance" | "system";
  updatedAt: string;
};

// Added to Card:
//   dependencies: TaskDependency[];
//   primaryBlockerId?: string | null;
//   primaryBlockerPinned?: boolean;
//   nextStep?: TaskNextStep | null;
```

**Derived, never persisted as independent truth:**

| Readiness | Meaning |
| --- | --- |
| `ready` | No unresolved dependencies; the task can start now. |
| `waiting` | Valid unresolved blockers; the contract is satisfied. |
| `incomplete` | Blocked but missing dependencies, primary blocker, or next step. |
| `cyclic` | The task participates in a task-to-task dependency cycle. |

Readiness is recomputed on read from `dependencies`, `primaryBlockerId`, and
`nextStep`. Nothing writes it.

## Invariants

**I1 — Blocked requires the full triple.** Any write that creates a card in
`blocked` or moves one into `blocked` must produce: at least one dependency in
state `unresolved`; a `primaryBlockerId` naming one of those unresolved
dependencies; and a `nextStep` with a non-empty `summary`.

**I2 — Failure is a dependency, not an exemption.** Lifecycle failure and
cancellation do not bypass I1. `transitionCard` synthesizes a
`kind: "execution"` dependency (`origin: "system"`, label carrying
`lifecycleReason`) and a system `nextStep` — `"Review the failed run and choose
retry or repair"`, `requiresApproval: true` — then satisfies I1 normally. One
contract covers dependency-blocked and failure-blocked; neither has a private
path. *(Astra B1: without this, every run failure and every drag-to-Blocked
throws.)*

**I3 — Only task edges form the graph.** Cycle detection and depth layout walk
`kind: "task"` dependencies only. External kinds are terminal blockers: they
render as chips, they never enter `byId` lookups, and a card whose primary
blocker is external lays out at its own depth. *(Astra B3.)*

**I4 — Cycles and dangling references are rejected on write.** A write that would
close a task-to-task cycle, or that names a `primaryBlockerId` absent from
`dependencies`, or a `taskId` that is not a live card, is rejected with a
field-specific error. Multi-parent DFS replaces the current single-`needs` walk,
and the existing `GUARD=200` iteration cap becomes an explicit validation error
rather than a silent `null`.

**I5 — Resolution requires evidence.** Moving a dependency to `resolved` or
`waived` requires `evidence` — a merge URL, a run id, a decision record, a
person. Free text is accepted; empty is not.

**I6 — Authorship is never silently overwritten.** Automation may rewrite only
records whose `origin` is `enhance` or `system`. A `human` dependency or
`nextStep` is preserved; automation proposes a replacement instead.

**I7 — Approval blocks dispatch.** `nextStep.requiresApproval === true` sets
`needsHuman`, surfaces the card in Chart Room Decisions, and makes the step
ineligible for automatic dispatch. Enhance may *write* such a step; nothing may
*execute* it without a human.

**I8 — Legacy blocked cards stay readable.** Existing blocked cards missing any
part of the triple load normally, derive `incomplete`, and carry concrete repair
recommendations. They are never a hard error. The next blocked write to such a
card must satisfy I1.

## Enforcement

Validation lives in the `cave-board.ts` mutators — `createCard`, `updateCard`,
`transitionCard`, under the existing `withBoardLock` — **not** in route handlers.
That is the only common chokepoint: `PATCH /api/board/[id]` passes the body
straight through today, and Enhance calls `updateCard` directly, so
handler-level validation would leave both unguarded. *(Astra B2.)*

Covered paths: create, patch, drag between lanes, bulk edit, lifecycle
transition, Enhance, and automatic blocker promotion.

Errors are field-specific and machine-readable so the Board inspector can point
at the offending field:

| Code | Condition |
| --- | --- |
| `blocked_requires_dependency` | I1, empty or fully resolved dependency set |
| `blocked_requires_primary` | I1, missing or resolved primary blocker |
| `blocked_requires_next_step` | I1, missing or empty `nextStep.summary` |
| `dependency_cycle` | I4, task edge closes a cycle |
| `dependency_dangling` | I4, unknown `taskId` or `primaryBlockerId` |
| `dependency_needs_evidence` | I5 |
| `dependency_invalid` | Dependency payload is malformed or repeats an id |
| `primary_blocker_invalid` | Primary blocker is neither null nor a non-empty id |
| `next_step_invalid` | Next-step payload is missing required structured fields |
| `dependency_authorship` | I6, automation tried to overwrite a human dependency |
| `next_step_authorship` | I6, automation tried to overwrite a human next step |

## Automation behavior

**Primary blocker promotion.** When the primary blocker resolves, the first
remaining `unresolved` dependency in array order is promoted and a derived
`nextStep` is refreshed. Array order *is* priority order and is operator-
editable; `primaryBlockerPinned` freezes the choice so promotion skips it. This
replaces both FIFO-by-creation and model-chosen ordering — the operator decides,
deterministically. *(Sage R2, adapted: explicit ordering beats a severity
heuristic the operator cannot see.)*

Promotion is idempotent: re-resolving an already-resolved dependency is a no-op
that does not touch `updatedAt`. Each promotion appends an audit entry —
`{ taskId, resolvedDependencyId, previousNextStep, nextStep, at, actor }` — so a
rewritten step is explainable rather than mysterious. *(Sage R4.)*

When nothing unresolved remains, the card derives `ready` and is recommended for
unblocking. It is **not** auto-moved: leaving Blocked is a human or explicit
orchestrator act.

**Enhance.** Enhance proposes dependencies and next steps for active tasks.
Auto-application requires all three of:

1. **Grounding** — every reference resolves to something real (a live card id, a
   reachable GitHub item, a named service already known to the Cave).
2. **Structural validity** — the proposal passes the full validator, including
   cycle and dangling checks, as a dry run.
3. **Non-conflict** — the field it would write has `origin` `enhance` or
   `system`, and no human record is displaced.

Anything failing a gate is stored as a recommendation for review. The model's
own confidence claim is an input to ranking, never the authority for a write —
single-model self-reported confidence is not calibrated, and the auto-apply
decision has to rest on checks the Cave can verify itself. *(Sage F4/R3.)*
Every auto-applied change records what it was and which gates passed.

## Chart Room migration

Expand → migrate → contract, with the overlay reader outliving the overlay
writer. *(Sage F5/R5, Astra R1.)*

1. **Expand.** Canonical fields ship and are written. The overlay reader stays.
   Chart Room reads the union of canonical dependencies and any surviving
   overlay edges.
2. **Import.** On Chart Room load, each overlay edge is converted to a canonical
   `kind: "task"` dependency with `origin: "system"` and evidence naming the
   overlay import. The import **merges**: it never overwrites a canonical edge,
   and re-running it is a no-op. This matters because the overlay is
   per-familiar and per-browser — two navigators and two devices can hold
   divergent maps, and a clobbering import would silently drop one.
3. **Rewrite.** Graph, Flow, Orchestration, Table, Gantt, and Decisions consume
   canonical fields. Traversals become multi-parent: depth is max-over-parents,
   cycle detection is a full DFS, external blockers are excluded from both.
4. **Stop writing.** Chart Room dependency edits write canonically only.
5. **Contract.** After a deprecation window, the overlay reader and
   `dependsOn` are removed and `docs/role-surfaces.md` is updated.

Repair diagnostics for legacy incomplete cards are **advisory** during expand —
they surface recommendations, they do not auto-mutate — so an operator reviews
before data changes.

## Surfaces

- **Board inspector** — dependency list with kind, state, and evidence; primary
  blocker selector with a pin; structured next-step editor; readiness badge with
  repair actions when `incomplete`.
- **New card modal** — when Blocked is chosen at creation, the triple is
  required inline rather than rejected after the fact.
- **Chart Room** — canonical edges everywhere; external blockers as terminal
  chips; Decisions continues to key on `needsHuman`, now also fed by
  `requiresApproval`.
- **Enhance review** — recommendations queue showing proposed dependencies and
  next steps with the gate each one failed.

## Acceptance tests

1. Retry exhaustion reaches `blocked` with a synthesized `execution` dependency,
   a system next step, `needsHuman: true`, and no throw. (I2)
2. A blocked write with an empty dependency set, an already-resolved primary
   blocker, or an empty next step is rejected with the matching error code; the
   valid triple is accepted. (I1)
3. An Enhance write that would produce an invalid blocked card is rejected by the
   same validator as the PATCH route — proving enforcement sits in the lib. (B2)
4. A→B→C→A across distinct dependency entries derives `cyclic` for all three; the
   diamond A→{B,C}, B→D, C→D derives no cycle and `depth(A) = max + 1`. (I3/I4)
5. A card whose only blocker is a GitHub or human dependency derives readiness
   without throwing, is excluded from depth layout, and renders terminally. (I3)
6. A legacy blocked card with zero dependencies loads, derives `incomplete`, and
   yields a repair recommendation. (I8)
7. Two divergent overlay maps import to a deterministic merged set; no canonical
   edge is dropped; a second import is a no-op. (Migration step 2)
8. Resolving a primary blocker promotes the next unresolved dependency, refreshes
   a derived next step, preserves a human-authored one, and does not touch
   `updatedAt` on a repeat. (I6, promotion idempotency)
9. Deleting a card that is another card's primary blocker clears or re-points the
   reference, leaving no dangling edge. (I4)
10. A next step with `requiresApproval: true` sets `needsHuman`, appears in
    Decisions, and is refused by any auto-dispatch path. (I7)

## Rejected alternatives

- **Separate dependency graph store.** Split-brain risk: two sources of truth for
  the same relationship, with reconciliation cost on every read.
- **Keeping the Chart Room overlay.** Invisible to the server and to every other
  familiar and device. It cannot support orchestration by construction.
- **Free-text `nextStep`.** Not routable. An orchestrator cannot derive an actor,
  a capability, or an approval requirement from prose.
- **Severity-ranked automatic promotion.** Ranks by a heuristic the operator
  cannot see or override. Explicit array order plus a pin is legible.
- **LLM confidence score as the auto-apply gate.** Self-reported confidence is
  systematically overconfident and unverifiable at the write boundary.

## Open items for implementation planning

- Deprecation window length for the overlay reader.
- Whether `waived` needs a distinct readiness treatment from `resolved`.
- Whether external dependency resolution can be polled (GitHub state) or stays
  manual in v1. Recommendation: manual in v1, polling as a follow-up.
- Schema version discriminant on the board file so repair diagnostics can tell
  "never had blockers" from "predates the field".

## Research basis

Sage's review grounded the design in these patterns; the ledger below is Sage's,
recorded here for traceability rather than re-verified in this session.

| Pattern | Applied as |
| --- | --- |
| DAG acyclicity validated at write time | I4, multi-parent DFS |
| Expand–contract schema migration | Chart Room migration phases |
| Structured agent action schemas | `TaskNextStep` |
| Human-in-the-loop confidence routing | I7, `requiresApproval` → Decisions |
| Idempotent write-back with audit trail | Promotion idempotency and audit entry |
| Least-privilege tool binding, evidence identity | I5, stable `ref` + evidence |
