# Automatic local branch and worktree retirement

**Date:** 2026-07-31
**Status:** Approved for implementation
**Bead:** `cave-ox3ky`
**Depends on:** `cave-wqa0b`

## Goal

Prevent local branch and worktree buildup, then automatically retire only
proven-safe local state through the repository's normal completion and patrol
workflows.

The result must preserve the branch curator's fail-closed safety model:

- `pnpm beads:worktrees` remains read-only;
- automatic mutation is limited to the explicit apply workflow;
- local worktrees and local branch refs may be retired;
- remote branch deletion is proposal-only;
- active, dirty, recent, recovery, protected, or uncertain state is preserved;
  and
- no apply-mode mutation is enabled until the repository-wide maintenance gate
  excludes every supported local and remote writer.

## Current state

The repository already has three relevant pieces:

1. `src/lib/worktree-lifecycle.ts` classifies registered worktrees into active,
   recovery, cooldown, retire-after-gate, uncertain, and protected lanes.
2. `scripts/worktree-lifecycle-patrol.ts` correlates worktrees with Git status,
   index flags, process CWDs, Coven claims, Beads, pull requests, workflow runs,
   default-branch containment, and recency. It is intentionally read-only.
3. `scripts/maintenance-gate.mjs` provides the local fenced gate core: atomic
   acquisition, writer-intent draining, generation fencing, ownership
   verification, bounded leases, and an audit log.

The maintenance-gate core explicitly covers repository-local cooperating
writers only. Full exclusion also requires the remaining `cave-wqa0b` planes:
Coven session and claim enforcement, a Beads pre-write enforcement point, and
the GitHub-side ref, pull-request, workflow, and settings transaction.
Automatic retirement must not treat the local core as sufficient on its own.

The current patrol also inventories registered worktrees rather than every
local branch. A complete cleanup workflow must include local branches that no
longer have a worktree.

## Chosen architecture

Extend the existing lifecycle patrol and classifier rather than creating a
second cleanup engine.

### Inventory and classification

Build one normalized inventory from:

- every registered worktree;
- every direct local ref under `refs/heads`;
- protected and tool-owned refs;
- the freshly fetched default branch and exact same-named remote refs;
- Coven claims and sessions;
- Beads ownership and lifecycle metadata;
- live process CWDs;
- pull requests associated with each exact candidate OID, including outbound
  pull requests;
- active workflow runs matched by exact branch and OID; and
- branch, worktree, commit, merge, and reflog recency.

A checked-out branch and its worktree form one retirement unit. A local branch
without a worktree is a branch-only unit. Detached worktrees remain recovery
units and are never automatic-retirement candidates.

Keep the existing lifecycle lane names for compatibility. In human output,
`retire-after-gate` is presented as **cleanup-ready** while retaining the
machine value.

### Commands

- `pnpm beads:worktrees` remains read-only.
- `pnpm beads:worktrees:json` remains read-only.
- Add `pnpm beads:worktrees:create` for fail-closed managed creation.
- Add `pnpm beads:worktrees:apply` for bounded local retirement.
- Update `pnpm beads:patrol:apply` to run PR reconciliation followed by the
  worktree apply command.

Apply mode uses the same inventory and classifier as report mode. It does not
accept branch names supplied by display output and does not maintain a separate
candidate list.

The default apply batch is three retirement units. An explicit
`--max-retire` may select one through ten. Remaining eligible units stay
cleanup-ready for the next patrol. This keeps gate holds and failure domains
bounded.

## Lifecycle metadata and creation policy

Managed worktree creation records structured metadata on its active Bead:

```json
{
  "coven": {
    "worktree": {
      "branch": "fix/cave-123-example",
      "path": "/absolute/repository/path/.worktrees/cave-123-example",
      "owner": "familiar-or-human-id",
      "purpose": "Short scoped purpose",
      "disposition": "active",
      "createdAt": "2026-07-31T16:00:00.000Z"
    },
    "worktrees": [
      {
        "branch": "fix/cave-123-parallel",
        "path": "/absolute/repository/path/.worktrees/cave-123-parallel",
        "owner": "familiar-or-human-id",
        "purpose": "Explicit coordinated parallel scope",
        "disposition": "active",
        "createdAt": "2026-07-31T16:05:00.000Z",
        "exception": {
          "owner": "familiar-or-human-id",
          "reason": "Bounded parallel implementation",
          "expiresAt": "2026-08-01T16:05:00.000Z",
          "additionalPaths": [
            "/absolute/repository/path/.worktrees/cave-123-parallel"
          ]
        }
      }
    ]
  }
}
```

`coven.worktree` is the primary full record. When a current bounded exception
authorizes parallel work, `coven.worktrees` stores each additional full record;
it is invalid without a primary record. Branches and normalized paths must be
unique across both fields.

Allowed dispositions are `active`, `pr`, `recovery`, and `archive`.
`recovery` and `archive` additionally require:

- `reason`;
- `reviewAfter`, as an ISO date; and
- the owner responsible for disposition.

One registered worktree per non-closed Bead is the default invariant. A
coordinated multi-worktree task requires an explicit exception containing the
additional paths, owner, reason, and expiry.

Legacy text references in Bead titles, descriptions, notes, and external refs
remain ownership signals. They do not become deletion authorization. Existing
worktrees without structured metadata are reported for backfill and cannot be
automatically retired.

An overdue recovery review date produces a follow-up signal. It never changes
the unit from recovery to cleanup-ready and never authorizes deletion.

### Local budgets

The repository warns at:

- 12 registered worktrees, including the primary checkout; and
- 30 local refs under `refs/heads`, including protected and tool-owned refs.

Crossing either threshold does not delete anything. Managed worktree creation
refuses a new worktree unless it can retire a safe candidate first or the
owning Bead records a bounded exception with owner, reason, and expiry.

This policy applies to repository-managed creation paths and agent workflow
guidance. Raw `git worktree add` cannot be intercepted reliably by repository
code, so the implementation must not claim universal enforcement. The existing
40-branch GitHub cap remains a separate remote repository policy.

## Automatic local retirement eligibility

Only a `retire-after-gate` unit may enter apply mode. Immediately before
mutation, it must satisfy all of the following under the fully enforced
maintenance transaction:

1. The branch is a direct commit ref and is not protected or tool-owned.
2. The path and ref still match the inventory's exact values.
3. The local ref still resolves to the captured OID.
4. The worktree, when present, has no staged, unstaged, untracked, dirty
   submodule, assume-unchanged, skip-worktree, or non-disposable ignored state.
5. No live process, Coven session, claim, non-closed Bead, open or draft pull
   request, or active workflow owns the path, branch, or exact OID.
6. Every liveness query is complete and schema-valid.
7. The latest commit, branch reflog, worktree HEAD reflog, and exact merge are
   outside the mandatory 8-hour cooldown.
8. The exact local OID is on the freshly fetched default branch or exactly
   matches the recorded head of a pull request merged into that default branch.
9. Structured lifecycle metadata exists and no unexpired exception or recovery
   disposition applies.
10. The normative local-retirement profile in the branch-curator deletion
    proof succeeds.

The same-named remote branch may exist. Its existence is retained as durable
recovery rather than treated as permission to mutate it. Local retirement
requires its exact OID and pull-request state to be known; divergence,
incomplete lookup, or any live association preserves the local unit.

## Maintenance transaction

Apply mode acquires the `cave-wqa0b` repository-wide maintenance transaction
before final eligibility checks. Activation is fail-closed:

- if any maintenance-gate enforcement plane is absent, apply mode reports
  `gate-incomplete` and changes nothing;
- if writer intent cannot drain, it reports the exact blockers and changes
  nothing;
- if gate ownership expires or its generation/token changes, the current unit
  stops immediately;
- every destructive step is preceded and followed by exact fenced-owner
  verification; and
- the gate is held through all local postconditions for the bounded batch.

The local `maintenance-gate.mjs` lease is necessary but not sufficient.
Apply-mode mutation ships disabled until Coven, Beads, and GitHub writers all
honor the same maintenance transaction. Advisory claims, PID snapshots, or a
new standalone lock file are not substitutes.

## Per-unit retirement transaction

Each unit is processed independently while the maintenance transaction is held:

1. Capture the literal worktree path, full local ref, local OID, remote ref and
   OID, merged pull-request evidence, and gate generation/token.
2. Repeat every eligibility and drift check against those exact values.
3. If only allowlisted disposable ignored roots are present, preview and remove
   exactly those roots, then repeat the configuration-independent status and
   index checks. Any path outside the existing disposable policy blocks the
   unit.
4. Remove the worktree with `git worktree remove` and no `--force`. A refusal
   preserves the branch.
5. Delete the local branch atomically with
   `git update-ref -d <full-ref> <expected-oid>`. Do not use `git branch -D`.
6. Verify the worktree registration and local ref are absent, the remote ref is
   unchanged, and the exact fenced gate owner is still held.
7. Record the successful local retirement and any remote-deletion proposal.

If worktree removal succeeds but ref deletion fails, the local ref remains the
recovery point and the unit is reported as a partial failure. If ref deletion
succeeds but a later local postcondition fails, restore the ref with an
expected-absence compare only while the same gate owner is still valid. Never
perform compensating mutation after gate ownership is lost. A lost-gate partial
failure is reported with the captured OID and requires curator review.

No guard bypass is allowed. A worktree-guard rejection is a blocked candidate,
not a reason to retry with `WT_GUARD_BYPASS`.

## Remote deletion proposals

Apply mode never calls a remote ref deletion command or GitHub ref mutation.

When a retained same-named remote branch appears removable, output a proposal
containing:

- repository and full remote ref;
- exact remote OID;
- matching local-retirement OID;
- merged pull-request number and base;
- default-branch containment result;
- open/draft pull-request and workflow results;
- recency limitations; and
- the reason human or separately authorized automation must decide.

The proposal is evidence, not authorization. It must not render as completed
work and must not be fed automatically into `gh api`, `git push --delete`, or
another mutating command.

## Reporting contract

Human output separates:

- locally retired;
- cleanup-ready but not processed;
- blocked during apply;
- active;
- recovery;
- cooldown;
- uncertain;
- protected; and
- remote-deletion proposals.

JSON output includes:

- inventory and summary counts;
- budget counts, thresholds, and exception state;
- unit kind, path, branch, full ref, and captured OID;
- lifecycle metadata and matched ownership evidence;
- lane and reasons;
- attempted action and postcondition result;
- exact blocker or partial-failure reason; and
- remote proposal evidence.

No unit is described as retired until both worktree and local-ref
postconditions pass. Report-only output continues to state that no local state
was changed.

## Workflow integration

Normal branch completion records verification and PR state in the owning Bead.
After merge, the completion workflow leaves the remote branch decision to
GitHub or a human and invokes `pnpm beads:patrol:apply` from a different,
retained checkout. The just-finished worktree may remain active until its
processes and sessions exit; a later patrol retires it after the cooldown.

Periodic maintenance invokes the same apply command. There is no Git hook,
daemon, cron-specific classifier, or alternate deletion procedure.

Update the project `branch-curator` skill so it:

- treats the lifecycle patrol as the routine machine-readable inventory;
- uses apply mode for eligible local retirement only;
- retains its exhaustive ad hoc audit for PR creation, recovery, and uncertain
  state;
- distinguishes the automatic local-retirement profile from remote deletion;
- requires the normative deletion proof and maintenance transaction; and
- emits remote deletion proposals rather than executing them.

## Testing

Extend the lifecycle classifier and integration fixtures to cover:

- registered and branch-only inventory units;
- successful clean local retirement;
- exact-OID mismatch before worktree removal and before ref deletion;
- worktree removal refusal without force;
- local-ref compare-and-delete failure;
- successful compensating ref restoration;
- gate expiry, takeover, generation drift, and incomplete gate capabilities;
- active process, Coven session, claim, Bead, PR, and workflow blockers;
- malformed, partial, capped, or unavailable external inventories;
- recent commit, branch reflog, worktree reflog, and merge cooldown;
- default-branch containment and exact merged-PR-head proof;
- remote divergence and remote proposal-only behavior;
- disposable and non-disposable ignored paths;
- missing metadata, duplicate Bead ownership, valid exceptions, and overdue
  recovery reviews;
- 12-worktree and 30-local-branch budget boundaries;
- default three-unit batches and explicit one-through-ten bounds;
- inventory drift during report and apply modes;
- postcondition failures and lost-gate partial failures; and
- unchanged refs and registrations in every report-only and fail-closed case.

Extend `branch-curator` evals with prevention and lifecycle scenarios:

- one worktree per active Bead;
- budget admission and bounded exceptions;
- post-merge local retirement;
- periodic cleanup;
- recovery review expiry;
- branch-only cleanup;
- incomplete maintenance enforcement;
- candidate drift; and
- remote proposal-only behavior.

Run the revised skill against the existing adversarial eval set and the new
lifecycle cases. Existing safety cases must not regress.

## Rollout

1. Extend read-only inventory to all local branches and add lifecycle metadata
   and budget reporting.
2. Add apply-mode transaction code and tests, but keep mutation disabled behind
   the full maintenance-capability check.
3. Complete and verify every `cave-wqa0b` enforcement plane.
4. Enable bounded local retirement in `beads:worktrees:apply` and
   `beads:patrol:apply`.
5. Update branch-curator guidance, deletion-proof profiles, agent completion
   guidance, and evals.
6. Dogfood report-only and apply workflows before relying on periodic cleanup.

## Exclusions

- No automatic remote branch deletion.
- No stash deletion or recovery snapshot disposal.
- No forced worktree removal.
- No bypass of worktree guard or maintenance fencing.
- No age-only or name-only stale inference.
- No automatic cleanup of unstructured legacy state before metadata backfill.
- No claim that raw Git worktree creation is universally blocked.
- No weakening of the 8-hour cooldown or existing recovery guarantees.
