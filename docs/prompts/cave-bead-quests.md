# Cave Bead Quests Prompt

Use this prompt to design and implement explicit Bead mirroring for personal
Cave Board items and Coven-themed familiar progression.

---

Design and implement a Cave feature called “Bead Quests” that mirrors selected
Beads into my personal Board and rewards familiars for verified delivery.

Start by reading:

- `docs/workflows/beads-familiars.md`
- `docs/orchestration-ready-tasks.md`
- `docs/superpowers/specs/2026-08-01-board-canonical-orchestration-design.md`
- `docs/superpowers/specs/2026-08-09-beads-delivery-accounting-design.md`
- `src/lib/cave-board-types.ts`
- `src/lib/familiar-renown.ts`
- `src/lib/role-manifest.ts`
- `src/components/board-reward-flare.test.ts`
- `docs/coven-design-language.md`

First produce a design for approval; do not implement until it is approved.

## Objective

Give each personal Cave Board item an explicit, durable link to one canonical
Bead. Make its goal, dependencies, readiness, ownership lane, evidence, and next
action immediately understandable. Add Coven-themed progression that rewards
familiars for verified outcomes, collaboration, and role-appropriate work—not
claims, status churn, session volume, or self-reported success.

## Tracking model

Preserve the existing authority boundaries:

- Beads is authoritative for repository work, dependency state, claim state,
  delivery evidence, and closure.
- Cave Board is authoritative for personal scheduling, checklist steps,
  familiar assignment, personal notes, and orchestration.
- GitHub remains authoritative for PRs, reviews, checks, and merges.
- Never infer a Bead link from titles, labels, notes, branches, or PR text. Use
  the existing explicit `CardBeadRef { id, projectId }` contract.

Design these flows:

1. “Mirror to Board” from an active Bead, with idempotent
   one-Bead/one-card behavior.
2. Link or unlink an existing personal card after validating the Bead and
   trusted project.
3. Refresh all linked cards in bounded batches without exposing repository
   paths, emails, secrets, comments, or unrelated Beads.
4. Show Bead-owned data separately from Board-owned data so synchronization
   never overwrites personal intent.
5. Detect drift such as Board Done while the Bead remains open, a closed Bead
   with unfinished personal steps, stale `in_progress`, missing Beads, and
   unresolved blockers.
6. Require explicit reconciliation; never silently close a Bead, mark a card
   Done, resolve dependencies, or bypass a human gate.

The linked-card delivery panel should show:

- Bead ID and title
- status, priority, type, and ownership surface
- ready/waiting state
- dependency and primary-blocker summary
- imperative next step
- familiar owner/claim when safely available
- linked PR/check/review state
- last update and staleness
- verification and close evidence

## Familiar roles and lanes

Use familiar role manifests, capabilities, ownership labels, and current
workload to recommend suitable Beads. Treat affinity as guidance, not permission
or exclusivity.

Support:

- primary lane matches;
- secondary-capability matches;
- “stretch quests” outside a familiar’s normal lane;
- collaboration when multiple roles are genuinely required;
- human-only and approval-required work that cannot be claimed or dispatched
  automatically;
- workload/WIP limits so the system does not reward hoarding.

Explain every recommendation: “Suggested for Kitty because this Bead requires X
and Y, matches lane Z, and Kitty has capacity.” Allow the operator to override
it.

## Gamification direction

Build on the existing Renown tiers (`kindling`, `adept`, `magus`, `archon`,
`luminary`) and ritual-streak philosophy instead of inventing several competing
currencies.

Model each linked Bead as a “Quest” with a visible Renown bounty. Award it
exactly once from an append-only reward ledger only after independently
verifiable evidence satisfies the Bead’s acceptance criteria.

Reward signals may include:

- verified Bead completion;
- passing required checks and merge evidence;
- resolving a real blocker;
- high-quality review or verification work;
- useful collaboration across familiar roles;
- creating durable documentation or grimoire memory;
- completing a declared stretch quest safely.

Do not reward:

- claiming or opening work;
- number of sessions, comments, commits, or status changes by themselves;
- duplicate mirrors;
- reopening/reclosing the same Bead;
- self-reported completion without evidence;
- priority inflation or manufactured dependencies.

Prefer small bonuses over large multipliers. Priority should represent urgency,
not automatically determine reward. If complexity affects bounty, derive it
from explicit estimates, dependency depth, verification burden, or a human-set
bounty with an audit trail.

Explore Coven-themed presentation such as:

- Quest bounty: Renown available for verified completion
- Role affinity: “Aligned”, “Supporting”, or “Stretch”
- Proof Seal: verification evidence accepted
- Coven Assist: credited collaboration without stealing ownership
- Ritual Chain: a non-punitive streak of verified contribution days
- Constellations: collections of related Beads/epics
- Completion flare: existing one-shot, preference-gated, reduced-motion-safe
  celebration

Avoid leaderboards that rank familiars against each other. Prefer personal
growth, role mastery, coven-wide milestones, and visible contribution history.

## Required architecture

Propose isolated components for:

- Bead discovery and sanitized DTOs;
- explicit mirror/link mutation;
- source-vs-personal field ownership;
- drift reconciliation;
- role/lane affinity scoring;
- immutable reward events and idempotency keys;
- Renown projection from verified events;
- UI presentation and accessibility;
- audit, privacy, and abuse prevention.

Reward events should include the Bead, familiar, reason, evidence reference,
points, timestamp, rule version, and idempotency key. Recomputing Renown from
the ledger must produce the same result.

## Design alternatives

Compare at least these approaches:

1. Manual linking plus read-only delivery snapshots.
2. Opt-in one-to-one mirroring with controlled reconciliation. This is the
   recommended baseline.
3. Full automatic Beads-to-Board synchronization.

Explain why full automatic synchronization risks clutter, authority conflicts,
and accidental mutation. Recommend the smallest model that still gives complete
personal clarity.

## Validation and acceptance

The design and implementation must prove:

- every mirrored card has exactly one valid explicit Bead reference;
- repeated import/refresh is idempotent and creates no duplicate cards or
  rewards;
- Bead and Board statuses remain visibly distinct;
- blocked cards retain dependencies, a primary blocker, and an imperative next
  step;
- human approval gates remain non-dispatchable;
- private data and credentials never enter Board/mobile DTOs or reward events;
- reward totals can be rebuilt exactly from the ledger;
- no reward occurs before verifiable completion evidence;
- role matching is explainable and operator-overridable;
- motion is preference-gated and reduced-motion-safe;
- failures are per-project/per-card and never erase last-known-good state;
- tests cover duplicate linking, stale state, missing Beads, dependency drift,
  reward replay, fraudulent evidence, collaboration credit, WIP limits, and
  accessibility.

End the design with a phased rollout: read-only linked clarity first, opt-in
mirroring second, verified Renown rewards third, and coven-wide constellations
only after the ledger has proven trustworthy.

## Recommended game loop

Discover a ready Quest → suggest familiars by role/lane and capacity →
explicitly bind one familiar → work through canonical blockers and next step →
verify evidence → apply one Proof Seal → award Renown once → optionally credit
Coven Assists → update personal mastery and shared constellation progress.
