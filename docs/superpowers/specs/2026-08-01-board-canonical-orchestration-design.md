# Board-Canonical Task Orchestration

**Status:** Approved for implementation planning

**Bead:** `cave-wqzf2`

**Date:** 2026-08-01

## Summary

Cave will move task dependencies from the Chart Room's browser-local, single-parent overlay into the canonical Board card model. Canonical task dependencies will support multiple parents, typed external blockers, one operator-selected primary dependency, an agent-actionable next step, deterministic readiness, and auditable automation.

The Board library is the enforcement boundary. Every mutation path—including API patches, drag/drop, bulk moves, lifecycle transitions, Enhance, and future server callers—must pass the same prospective-board validator inside the existing write lock.

This is an expand-contract migration. The Chart Room overlay remains readable during a two-release compatibility window, but canonical Board data wins all conflicts and becomes the only write target as soon as the new schema ships.

## Problem

The current Chart Room overlay stores `step id -> one upstream id` in browser `localStorage`, scoped by familiar and surface. The server, other familiars, and other browsers cannot observe or honor it. The graph helpers and SVG projection also assume one parent per task. As a result, the overlay can illustrate a local plan but cannot coordinate agents or reliably gate task dispatch.

The current lifecycle model also maps both `failed` and `cancelled` to the Blocked column without recording what is blocking the card. A strict orchestration contract must distinguish an execution failure that requires action from a deliberate cancellation that is merely stopped.

The owning implementation seams are `src/lib/cave-board-types.ts`, the mutators and Board-file loader in `src/lib/cave-board.ts`, the direct Enhance caller in `src/app/api/board/enrich-steps/route.ts`, the Chart Room graph helpers in `src/components/role-surfaces/chart-room-model.ts`, and the familiar/surface-local storage bridge in `src/lib/role-surface-state.ts` and `src/components/role-surfaces/navigator-surface.tsx`.

## Goals

- Make dependency and next-action metadata canonical, shared, and server-validated.
- Support multiple task dependencies plus typed external and execution blockers.
- Preserve a single, explicit operator focus without losing the full dependency graph.
- Prevent task cycles and dangling references on every write.
- Give agents a structured next action without crossing human approval boundaries.
- Preserve human authorship when automation refreshes derived data.
- Migrate local overlays without clobbering canonical data or assuming one browser represents all browsers.
- Keep legacy data readable and repairable throughout rollout.

## Non-goals

- Replacing the Card lifecycle machine or Board columns.
- Building a general-purpose workflow engine.
- Mirroring complete GitHub or Asana objects inside dependencies.
- Letting an LLM self-reported confidence score authorize graph mutations.
- Redesigning unrelated Board, Inbox, Calendar, or Daily Report surfaces.

## Canonical model

### Dependencies

Each dependency has its own stable `id`. `primaryDependencyId` references that dependency record, never the target card or external object directly. This avoids ambiguity when a card has multiple dependencies involving the same target and lets resolution, ordering, provenance, and audit events address one exact record.

```ts
type DependencyState = "unresolved" | "resolved";

type DependencyProvenance = {
  source: "human" | "overlay-migration" | "enhance" | "lifecycle";
  actorId?: string;
  suggestionId?: string;
  importedOverlayVersion?: string;
};

type DependencyBase = {
  id: string;
  label: string;
  state: DependencyState;
  createdAt: string;
  resolvedAt?: string;
  provenance: DependencyProvenance;
};

type TaskDependency = DependencyBase & {
  kind: "task";
  cardId: string;
};

type LinkedExternalDependency = DependencyBase & {
  kind: "github" | "asana";
  linkId: string;
  evidence?: {
    state: string;
    capturedAt: string;
    url: string;
  };
};

type ReferencedExternalDependency = DependencyBase & {
  kind: "human" | "credential" | "service" | "url";
  reference: string;
  evidence?: {
    capturedAt: string;
    url?: string;
    note?: string;
  };
};

type ExecutionDependency = DependencyBase & {
  kind: "execution";
  lifecycle: "failed" | "cancelled";
  reason: string;
  sessionId?: string;
  attempt: number;
};

type CardDependency =
  | TaskDependency
  | LinkedExternalDependency
  | ReferencedExternalDependency
  | ExecutionDependency;
```

Array order is the operator-controlled priority order. Users may reorder dependencies or explicitly select any unresolved entry as primary. An automatically added dependency does not displace an existing valid primary. When no valid primary exists, or when the primary dependency resolves, the first remaining unresolved entry becomes primary.

Only `kind: "task"` edges participate in cycle detection, ancestry, and graph depth. All other kinds are terminal blockers. GitHub and Asana dependencies reference an existing `card.github[].id` or `card.asana[].id`; they do not introduce a parallel copy of external identity.

### Next action

`nextStep` is the current action contract for progressing a blocked card. It does not replace the card's checklist, assignee, or lifecycle.

```ts
type NextStepProvenance = {
  source: "human" | "derived" | "enhance" | "lifecycle";
  actorId?: string;
  suggestionId?: string;
};

type CardNextStep = {
  id: string;
  summary: string;
  familiarId?: string;
  capabilityId?: string;
  target?: string;
  inputs?: Record<string, string | number | boolean | null>;
  requiresApproval: boolean;
  sourceDependencyId?: string;
  provenance: NextStepProvenance;
  updatedAt: string;
};
```

The bounded scalar `inputs` shape keeps the card JSON inspectable and avoids embedding arbitrary tool payloads. `capabilityId` references the canonical capability system when present; labels remain presentation metadata.

Human-authored next steps are authoritative. Automation may replace a next step only when its provenance is not `human`, or when a human explicitly accepts a proposed replacement.

### Card and board additions

```ts
type Card = {
  // existing fields
  dependencies: CardDependency[];
  primaryDependencyId: string | null;
  nextStep: CardNextStep | null;
};

type BoardFile = {
  version: 2;
  cards: Card[];
  orchestrationEvents: CardOrchestrationEvent[];
};
```

The Board file contains the orchestration event log so a card mutation and its event can be committed by the same atomic Board write. Events are append-only through library APIs and include the card, operation, actor/source, timestamp, idempotency key, and before/after orchestration values. The implementation must not cap or silently rewrite this audit history.

### Derived readiness

Readiness is computed, not persisted:

- `ready`: no unresolved dependencies and no structural error prevents dispatch.
- `blocked`: unresolved dependencies exist and the strict Blocked contract is valid.
- `incomplete`: a legacy or proposed state lacks a valid primary dependency, actionable next step, or resolvable external reference.
- `cyclic`: task dependencies contain a cycle. New writes cannot create this state; it remains observable for legacy or hand-edited data so repair is possible.

Readiness is independent of execution lifecycle. It describes whether orchestration metadata is structurally actionable.

## Invariants

Once canonical enforcement is active, the prospective whole Board must satisfy these rules before a mutation commits:

1. Every card in `status: "blocked"` has at least one unresolved dependency, a `primaryDependencyId` referencing one of those unresolved entries, and a non-empty `nextStep.summary`.
2. A non-null `primaryDependencyId` references a dependency on the same card. Resolved dependencies cannot be primary.
3. Dependency IDs and next-step IDs are stable and unique within their card.
4. A task dependency references an existing, different card. The complete task graph is acyclic.
5. A GitHub or Asana dependency references a structured link on the same card. Other external dependencies have a non-empty stable reference; evidence is retained when resolution is automated.
6. `nextStep.sourceDependencyId`, when present, references a dependency on the same card.
7. `nextStep.requiresApproval === true` implies `needsHuman === true`. The reverse is not required, and a false `requiresApproval` value never clears a separately established human gate.
8. An approval-required next step cannot auto-dispatch.
9. Automation cannot overwrite a human-authored next step without explicit human acceptance.
10. Dependency mutation, primary promotion, derived next-step refresh, approval-gate change, and audit append commit atomically.

Legacy cards that violate these rules remain readable. During the expand/flag-only phase, the same validator reports legacy violations but rejects only newly introduced cycles, dangling references, and new or worsened Blocked-contract violations. A mutation touching such a blocked card must either preserve its orchestration state during that phase or submit one atomic repair patch once canonical enforcement is active.

## Mutation boundary

Validation belongs in `src/lib/cave-board.ts`, not in route handlers. `createCard`, `updateCard`, `transitionCard`, dependency-resolution helpers, and deletion all construct a prospective Board under the existing serialized write lock, normalize it, validate it, append required audit events, and then save once.

Route handlers may reject malformed transport values early for clearer errors, but library validation is authoritative. Enhance already calls `updateCard` directly and therefore receives the same invariant enforcement without route-specific duplication.

Validation failures return typed errors suitable for HTTP mapping:

- `400` for malformed dependency or next-step values.
- `409` for cycles, dangling references, stale idempotency conflicts, or deletion of a card with dependants.
- `422` for a structurally parseable card that violates the Blocked contract.

Deleting a card referenced by unresolved task dependencies is rejected with the dependant card IDs. Cave must not silently remove the edges or unblock downstream work. The operator resolves, replaces, or explicitly converts those dependencies before deletion.

## Lifecycle behavior

### Failed execution

A transition to `failed` creates or reuses an idempotent unresolved `execution` dependency for that run attempt, moves the card to Blocked, selects it if no valid unresolved primary already exists, and produces a derived retry/recovery next step.

If retries remain, the next step may recommend retrying without human approval. Retrying resolves the corresponding execution dependency before the card returns to queued/running. When retries are exhausted, the next step requires approval and the card sets `needsHuman: true`.

Repeated delivery of the same failure event is a no-op after the first atomic mutation and does not duplicate the dependency, event, or `updatedAt` churn.

### Cancelled execution

A deliberate cancellation does not automatically mean dependency-blocked. By default it records `lifecycle: "cancelled"` and returns the card to Backlog without creating an execution dependency.

A caller may explicitly classify a cancellation as blocked only by supplying a concrete dependency and next step in the same mutation. This covers cancellations caused by revoked credentials, unavailable services, or required human decisions without treating every operator stop as a blocker.

### Resolution

Resolving a dependency records its evidence and timestamp. If it was primary, the first remaining unresolved dependency becomes primary. A derived next step may refresh to address the promoted dependency; a human-authored next step remains unchanged and yields a review recommendation instead.

When no unresolved dependency remains, `primaryDependencyId` clears. The system recommends or performs the explicit transition out of Blocked according to approval and dispatch policy; it does not infer permission to dispatch merely from resolution.

## Graph semantics and Chart Room projection

The canonical task graph is multi-parent. Server validation uses a complete O(V+E) topological scan over task edges and reports the concrete cycle members when validation fails. Client projections use full multi-parent traversal with visited and recursion-stack sets; they do not retain the old fixed traversal guard.

Chart Room derives its view from canonical dependencies:

- Every unresolved task edge can render.
- The primary task dependency is the visually emphasized hot edge.
- Depth is one plus the maximum depth across task parents.
- External and execution dependencies render as terminal blocker chips and do not affect task depth.
- A primary external dependency has no upstream task bar; its chip anchors the next-step treatment instead.
- Legacy cycles render as repair states even though server writes reject new cycles.

All Chart Room helpers that currently follow a single `needs` pointer must be generalized or replaced. The overlay becomes a migration input only, not a second graph authority.

## Enhance policy

Enhance separates low-risk metadata enrichment from graph mutation.

An orchestration suggestion may auto-apply only when all of the following are true:

- Every task or external reference resolves to an existing canonical object.
- The prospective Board passes all structural and cycle validation.
- The suggestion does not replace a human-authored next step.
- The suggestion does not introduce or clear a human approval gate without explicit policy authorization.
- The same suggestion idempotency key has not already been applied.
- Deterministic evidence supports the relationship; an LLM's self-reported confidence is not evidence.

Novel, ambiguous, or ungrounded blocker assertions remain recommendations for familiar or human review. Acceptance then uses the same canonical mutator and audit path as a manual edit.

## Migration and compatibility

### Phase 1: Expand

- Introduce Board version 2 and an explicit `migrateBoard` upcaster.
- Backfill `dependencies: []`, `primaryDependencyId: null`, `nextStep: null`, and `orchestrationEvents: []` without changing card meaning.
- Keep incomplete legacy blocked cards readable and show deterministic repair diagnostics.
- Retain the local overlay reader, but stop adding new overlay writes once canonical writes are available.

### Phase 2: Per-browser overlay import

The Navigator client reads its own familiar/surface overlay and submits an idempotent import request:

1. Normalize existing edges and calculate a stable hash from the familiar ID, surface ID, normalized edges, and importer schema version.
2. Convert each valid edge into a task dependency with `source: "overlay-migration"` and a stable ID derived from the import identity and edge.
3. Preserve every existing canonical dependency. Add only non-conflicting imported edges; canonical data wins conflicts.
4. Validate the prospective graph and return per-edge imported, skipped, and repair-required results.
5. Persist the import hash and audit events in the same Board write.
6. Clear that browser's overlay only after the server acknowledges the exact hash as committed or previously committed.

Import retries are no-ops. One browser's acknowledgement never implies that another familiar, browser profile, or device has migrated.

### Phase 3: Contract

- Switch all Chart Room reads and projections to canonical Board fields.
- Let the first release containing canonical writes be release N. Retain the overlay reader/importer in N, N+1, and N+2.
- During that window, never write new overlay state and continue accepting unseen per-browser hashes.
- Remove the overlay reader, importer UI, and compatibility code in N+3.
- Do not infer migration completion from server card state or one browser's success.

After canonical enforcement activates, any mutation of an incomplete blocked card must include a valid atomic repair. Cycles, dangling primary references, ambiguous external references, and unresolved task targets are rejected.

## UI behavior

Board card editing exposes:

- An ordered dependency list with add, resolve, reorder, and select-primary actions.
- Typed task, linked external, referenced external, and execution dependency treatments.
- A structured next-step editor with clear author/provenance and approval state.
- Readiness and repair diagnostics that explain the exact invalid field or reference.
- Review affordances for Enhance recommendations and automation conflicts.

Drag-to-Blocked and bulk move cannot fabricate context silently. If required orchestration data is absent, the UI opens the same repair/editor flow or rejects the move with actionable diagnostics. Moving out of Blocked does not silently resolve dependencies; the operator must resolve or retain them explicitly.

## Audit and idempotency

Every structural operation appends a `CardOrchestrationEvent`, including dependency add/remove/resolve/reorder, primary selection/promotion, next-step replacement, approval-gate implication, overlay import, Enhance acceptance, execution failure blocking, retry resolution, and repair.

Events contain an idempotency key derived from the initiating operation's stable identity. Replaying an acknowledged operation returns the current card without adding an event or changing timestamps. Human edits record the authenticated actor when available; lifecycle and migration events record their system source.

## Acceptance tests

1. A failed run creates one execution dependency, a valid primary reference, and a derived recovery next step; replaying the event creates no duplicate or timestamp churn.
2. Retry exhaustion sets `needsHuman` and requires approval. A retry with attempts remaining resolves the execution blocker and returns to execution normally.
3. Deliberate cancellation returns the card to Backlog without a dependency. An explicitly blocker-caused cancellation succeeds only with a valid dependency and next step.
4. Creating or moving a card to Blocked without the strict triple is rejected. A single atomic repair patch is accepted.
5. Enhance direct `updateCard` calls and HTTP PATCH calls receive identical orchestration validation.
6. A multi-parent cycle is rejected with its members. A diamond graph is accepted and uses maximum-parent depth.
7. External and execution dependencies never enter task cycle/depth math and render as terminal blockers.
8. `requiresApproval: true` sets `needsHuman`; `requiresApproval: false` does not clear an independently set human gate; approval-required work never auto-dispatches.
9. Resolving a primary dependency promotes the first unresolved dependency and refreshes only a derived next step. A human-authored next step remains intact and produces a review recommendation.
10. Repeated resolution, failure, Enhance, and import operations are idempotent and append one audit event each.
11. Deleting a referenced task card is rejected with dependant IDs and leaves the Board unchanged.
12. Legacy blocked cards load as `incomplete`, remain readable, and expose exact repair guidance.
13. Overlay migration merges without overwriting canonical edges, rejects cycles per edge, and clears local state only after exact-hash acknowledgement.
14. Two browsers with different overlays can each import once; either order yields the same canonical union for non-conflicting edges.
15. Canonical Chart Room projections render all task parents, emphasize the primary task edge, and handle a primary external blocker without layout failure.

## Rollout order

1. Schema, upcaster, pure validators, audit model, and mutation-boundary tests.
2. Lifecycle failure/cancellation semantics and idempotent resolution.
3. Board API and card editor support, including repair behavior.
4. Chart Room multi-parent projection and terminal blockers.
5. Enhance recommendation and grounded auto-apply policy.
6. Per-browser overlay import, compatibility telemetry, and two-release deprecation.
7. Removal of the overlay reader in release N+3.

Each phase must leave the Board readable and preserve unrelated card fields. The implementation plan should keep these seams independently reviewable while maintaining the single canonical contract.
