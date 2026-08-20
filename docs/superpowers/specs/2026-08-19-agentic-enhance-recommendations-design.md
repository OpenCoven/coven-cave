# Agentic Enhance and Recommendation Design

## Problem

Coven Cave already has strong but separate primitives:

- shared prompt enhancement in Board, Chat, and Quick Chat;
- orchestration-ready Board task validation;
- evidence-grounded Research mission creation and refinement;
- bounded Chat next-path and reply recommendations.

The current Enhance control primarily rewrites text. It does not yet use the
full task graph, Research evidence, Vault context, or conversation state to
produce ranked, actionable recommendations. The product needs one coherent
agentic model that improves task definitions, recommends optimal Research
topics, and sharpens Chat prompts and next paths without silently overwriting
human work or crossing approval boundaries.

## Goals

1. Make Enhance context-aware and agentic across Board, Research, and Chat.
2. Rank recommendations adaptively against the active outcome rather than a
   fixed global objective.
3. Ground Research recommendations in current missions, findings, saved links,
   and relevant Vault evidence.
4. Auto-apply only deterministic, mechanically verifiable, non-destructive
   normalization.
5. Keep model-authored content, approval-bound actions, and human-authored field
   replacements as explicit proposals.
6. Preserve existing race safety, reversibility, orchestration validation, and
   no-auto-send/no-auto-dispatch boundaries.
7. Cover each surface and shared failure modes with deterministic daemon-less
   Playwright journeys.

## Non-goals

- Live web or X discovery for topic generation.
- A new durable autonomous workflow engine.
- Automatic Chat submission, Board dispatch, task lifecycle transition, or
  Research mission advancement.
- Model confidence as authorization to mutate data.
- Replacing Beads, Cave task orchestration, Research missions, or Chat session
  state with a new shared persistence model.
- Repairing unrelated Familiar Work Queue behavior.

## Chosen approach

Use a **shared typed proposal engine with surface adapters**.

The shared layer defines proposal structure, strict extraction, context
fingerprints, rank semantics, common UI states, and deterministic verification
results. Board, Research, and Chat adapters remain responsible for loading
trusted context, validating surface-specific payloads, choosing persistence,
and applying accepted changes.

This avoids duplicating ranking and approval behavior while preserving the
existing domain boundaries. It also avoids introducing a central autonomous
workflow before the recommendation contract is proven.

## Shared recommendation contract

The shared contract is serializable and intentionally avoids fake numerical
precision:

```ts
type AgenticSurface = "board" | "research" | "chat";

type AgenticRecommendation<TPayload> = {
  id: string;
  surface: AgenticSurface;
  kind: string;
  payload: TPayload;
  rationale: string;
  inferredGoal: string;
  rankReasons: string[];
  evidenceRefs: AgenticEvidenceRef[];
  contextFingerprint: string;
  verification: {
    status: "verified" | "proposal" | "blocked";
    checks: AgenticVerificationCheck[];
  };
  application: {
    mode: "auto-apply" | "review";
    requiresApproval: boolean;
    reversible: boolean;
  };
};
```

`rankReasons` describe why a candidate outranks another using evidence such as
decision value, unresolved uncertainty, expected effort, novelty, and alignment
with the active outcome. The UI may show ordinal position and qualitative
labels, but not an invented percentage score.

Evidence references identify existing Cave records: task IDs, dependency IDs,
mission IDs, saved-link IDs, artifact paths, Vault entry IDs, message IDs, PRs,
or checks. Raw secrets never enter recommendation payloads or logs.

## Shared flow

1. A meaningful context change marks recommendations stale.
2. A bounded debounce coalesces related changes. Keystrokes alone do not trigger
   continuous requests.
3. The surface adapter gathers a bounded trusted context snapshot.
4. The proposal engine requests strict structured output through the familiar
   streaming path.
5. Extraction validates shape, lengths, allowed recommendation kinds, and
   evidence-reference syntax.
6. The adapter resolves evidence references and applies domain validation.
7. The engine ranks valid candidates against the inferred active goal.
8. The response fingerprint must still match the current context.
9. Deterministic, reversible normalization may auto-apply.
10. Model-authored, ambiguous, human-displacing, or approval-bound changes enter
    the recommendation UI.

Malformed model output receives one bounded retry. A second failure becomes a
retryable ErrorState. Stale responses are discarded without changing the
surface.

## Auto-apply boundary

Verified auto-apply is deliberately narrow. Eligible operations include:

- canonicalizing exact URL or source aliases;
- deduplicating identical references;
- resolving a named reference to an exact existing task, PR, check, mission,
  saved link, or Vault entry;
- recomputing derived read-only projections without storing them;
- normalizing exact whitespace, list markers, and canonical identifiers without
  changing authored words.

Model-authored prose, acceptance criteria, research topics, dependencies,
next-step changes, prompt rewrites, and action recommendations remain proposals.
An auto-applied mutation must be announced, auditable, and reversible where the
surface supports reversal.

## Board adapter

### Context

The Board adapter loads the card, project context, dependencies, readiness,
authorship metadata, relevant task graph, and exact referenced GitHub state.

### Recommendation kinds

- clearer task title or outcome;
- missing or improved acceptance criteria;
- task decomposition;
- dependency proposals;
- primary-blocker proposal;
- imperative next-step proposal;
- verification plan;
- readiness repair for legacy incomplete blocked tasks.

### Safety

All writes pass through `cave-board` mutators and the shared orchestration
validator. Route-level validation is not sufficient because Board callers can
invoke mutators directly.

The adapter must:

- reject dangling references and task cycles;
- preserve human-authored dependencies and next steps;
- propose replacements rather than overwrite human-authored fields;
- set `needsHuman` whenever `nextStep.requiresApproval` is true;
- never dispatch or transition a task automatically;
- retain rejected proposals with the exact validation blocker.

Board recommendations are persisted with their task because they participate in
orchestration governance and should survive navigation or another client. Their
audit record includes generation context, evidence resolution, validation
results, dismissal/application state, and applying actor.

## Research adapter

### Context

The Research adapter loads a bounded snapshot of:

- active and recent non-archived missions;
- mission intent, findings, artifacts, source ledger, and unresolved questions;
- saved links and durable X Article snapshots;
- relevant Vault entries retrieved by existing local relevance mechanisms.

Vault retrieval returns bounded excerpts and metadata, never credentials or
secret values. If Vault retrieval fails, the adapter continues with Desk
evidence and labels the result as reduced-context.

### Recommendation kinds

- next research topic;
- narrower or broader topic variant;
- evidence-gap investigation;
- comparison or validation topic;
- mission refine direction;
- suggested mission mode and bounded deliverable.

Each recommendation names:

- the uncertainty or outcome it advances;
- supporting mission/source/Vault evidence;
- novelty relative to existing missions;
- expected effort and decision value;
- recommended action: add to prompt, start mission, or review refine direction.

No evidence means no generated fallback topic. Similar existing missions are
deduplicated or offered as refine candidates rather than duplicated.

Research recommendations are ephemeral and recomputed when evidence changes.
Starting or refining a mission remains an explicit user action through the
existing Research APIs and runner validation.

## Chat adapter

### Context

The Chat adapter uses the current draft, conversation window, familiar, selected
model scope, active task/project context, and bounded recent tool outcomes.

### Recommendation kinds

- enhanced current draft;
- missing-context prompt improvement;
- clarification question;
- next reply;
- bounded task or navigation action already supported by next-path contracts.

Enhancement remains composer-local and uses the existing race-safe behavior:

- if the draft is unchanged, the recommendation may be offered as a direct
  replacement;
- if the draft changed during generation, the result becomes a suggestion;
- Apply, Edit, Dismiss, and Revert remain explicit;
- applying never submits;
- action recommendations never execute until activated by the Chat surface.

Contextual next paths refresh after meaningful assistant replies, task changes,
or tool outcomes, not while the user types each character.

## UX

All surfaces use the same recommendation language:

- ranked cards;
- concise proposed outcome;
- inferred optimization goal;
- "Why this?" rationale;
- evidence chips;
- qualitative impact/effort labels;
- verification or approval state;
- Apply/Review, Edit, Dismiss, and Revert where applicable.

### Board

Enhance opens a review panel showing a structured diff of task prose and
orchestration proposals. Deterministic normalization may already be marked
applied. Human-authored conflicts are called out explicitly.

### Research

The Prompt surface shows a contextual "Suggested next topics" region with a
small ranked set. Actions are Start mission, Add to prompt, and Why this.
Resources and mission changes invalidate and refresh the set.

### Chat

Enhance continues to operate beside the composer. The strip expands to explain
context used and why the rewrite is better. Follow-up cards use the same
rationale/evidence language and can populate, but never send, the next message.

All loading, empty, and failure states use existing UI primitives. Mutations use
`useAnnouncer()`. Interactive controls retain `.focus-ring`, focus return, and
reduced-motion behavior. No new hardcoded colors, spacing, or radii are added.

## Error handling

- **No grounded candidates:** show a calm empty state explaining what evidence
  would make recommendations possible.
- **Partial context:** return valid recommendations with a visible
  reduced-context label.
- **Malformed output:** retry once, then preserve existing content and show a
  retry action.
- **Stale output:** discard silently except for development diagnostics.
- **Reference resolution failure:** keep the proposal blocked and name the
  unresolved reference.
- **Validation failure:** keep the proposal reviewable with the exact cycle,
  dangling, authorship, or approval reason.
- **Apply failure:** preserve the proposal and surface the repository-standard
  error; never return a success-shaped fallback.
- **Cancellation:** stop the active familiar run by run ID and preserve the
  current draft/task/mission.

## Testing

### Unit and contract tests

- strict recommendation extraction and bounds;
- context fingerprint stability and invalidation;
- deterministic rank ordering and tie behavior;
- no fake fallback recommendations;
- evidence resolution and secret exclusion;
- auto-apply allowlist;
- one-retry malformed-output behavior;
- stale-response rejection.

### Board integration

- proposals route through Board mutators;
- human-authored dependencies and next steps are preserved;
- cycles and dangling references are blocked;
- `requiresApproval` remains non-dispatchable and marks human need;
- verified normalization auto-applies and records audit;
- persisted proposals survive reload.

### Research integration

- recommendations use mission, saved-link, X Article, and Vault fixtures;
- Vault failure degrades without failing the whole request;
- no evidence produces no topic;
- duplicate topics become refine suggestions;
- Start mission and Refine remain explicit and validated;
- source changes invalidate prior recommendations.

### Chat integration

- unchanged draft can receive a replacement proposal;
- mid-flight draft edits convert output to a suggestion;
- Apply/Edit/Dismiss/Revert preserve expected text;
- recommendations never send messages automatically;
- contextual next paths refresh after meaningful replies;
- unsupported actions are rejected.

### Playwright E2E

Add daemon-less, API-mocked journeys for:

1. Board Enhance producing a structured proposal, auto-applying one verified
   normalization, preserving human orchestration, and blocking approval-bound
   execution.
2. Research Prompt ranking grounded topics from mission, saved-link, X Article,
   and Vault fixtures; degrading when Vault fails; creating a mission only after
   explicit activation.
3. Chat Enhance handling a mid-stream edit, applying and reverting a suggestion,
   then populating—but not sending—a contextual next-path message.
4. Shared keyboard navigation, focus behavior, announcer messages, loading,
   error, empty, cancellation, and stale-response states.

E2E fixtures dismiss onboarding and intercept APIs with `page.route(...)`.
Tests assert observable behavior and persisted state, not internal implementation
details.

## Rollout, diagnostics, and rollback

`NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS` is the rollout capability. It is
**disabled by default**; only `1`, `true`, `yes`, or `on` enable it. Because it
is a `NEXT_PUBLIC_*` value, it is selected when the client bundle is built, not
by changing a running browser session. Board and Research recommendation UI
must remain hidden while it is off.

Legacy Chat Enhance remains available when this capability is off. The gate
does not remove the existing Chat rewrite path, and neither legacy nor agentic
Chat may auto-send a message. Applying a suggestion only changes the composer;
the familiar receives nothing until the person explicitly submits it.

1. Land shared contracts, extraction, ranking, verification, and focused tests
   with the capability off.
2. Exercise Chat's legacy and shared recommendation paths without changing its
   explicit apply/send boundary.
3. Exercise Research's bounded, read-only evidence route against missions,
   saved links, durable X snapshots, and relevant Vault entries. Its
   context fingerprint/revision is rechecked before a client acts, so an
   evidence revision makes the prior proposal stale rather than starting or
   refining a mission.
4. Exercise Board generation and persistence through `cave-board` mutators.
   Generation records proposals and any verified normalizations under the Board
   lock; the batch validates, applies, and persists atomically. Proposal
   records, audits, and explicit errors survive unchanged.
5. Enable the capability in a controlled build only after cross-surface E2E and
   contract tests pass. Keep it gated until diagnostics show no unexpected
   mutation, stale apply, or evidence-grounding failures.

Auto-apply remains narrower than the capability: the allowlist is only
canonical reference, duplicate reference, identifier, and derived read-only
projection normalization. A fresh, in-process, code-owned verification stamp
and trusted adapter checks are required; a serialized recommendation or its
stored verification status is never authority to write. All prose, dependencies,
next steps, topics, and approval-bound work stay review-only.

The process-local agentic diagnostics ring is bounded and content-free. It may
record only surface, event code/status, bounded counts, and timestamp. It never
retains recommendation, model, request, run, or other external identifiers —
including hashes or transformed variants — because those are untrusted content.
It covers stale discard, blocked verification, reduced Vault context, apply
failure, cancellation, and generation validation failure. It never retains or
emits prompts, sources, excerpts, payloads, validation reasons, or console
noise. Board and Research route factories and the shared client lifecycle accept
an injectable sink for operational consumers without making a diagnostic failure
affect the user response.

To roll back, build/deploy with
`NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS` unset or false. This hides the Board
and Research recommendation capability without deleting Board proposal/audit
records or changing existing explicit errors. Do not force-revert already
applied, verified normalizations as part of rollback; use their ordinary,
explicit reversible action where available. Chat's legacy Enhance remains
available throughout.

## Success criteria

- Enhance produces context-aware, actionable proposals on all three surfaces.
- Every recommendation explains its inferred goal and cites resolvable evidence.
- Research never invents a topic without Desk or Vault support.
- No human-authored orchestration field is silently replaced.
- No approval-bound step dispatches.
- Chat never auto-sends and Research never auto-advances.
- Only allowlisted deterministic normalization auto-applies.
- All new unit, integration, and daemon-less E2E coverage passes.
