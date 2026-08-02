# Maintainer-Authorized Branch Cleanup Design

**Date:** 2026-08-01  
**Status:** Approved for implementation  
**Bead:** `cave-3hpv8`

## Problem

The branch-curator contract currently requires one repository-wide transaction
that excludes writers in Coven, Beads, GitHub, and every local checkout before
it may remove any branch or worktree. The local maintenance lease exists, but
the cross-system transaction does not. As a result, even an explicitly
authorized maintainer cleanup with fresh, exact evidence must stop before a
safe local ref deletion.

This is the wrong boundary for a manual maintenance operation. It conflates:

1. unattended automatic retirement, which must remain disabled unless every
   required exclusion mechanism exists; and
2. a bounded maintainer-authorized cleanup, which can safely use fresh
   observations, fail-closed classification, the existing local maintenance
   lease, and compare-and-delete mutations.

The cleanup block must be removed without weakening protected `main`, allowing
automatic deletion, or converting uncertainty into permission.

## Decision

Define two distinct execution profiles.

### Automatic retirement

Automatic retirement remains fail-closed behind the full repository-wide
maintenance gate. No scheduler, lifecycle classifier, hook, or background
process gains deletion authority from this change. Existing proposal-only and
blocked outcomes remain unchanged.

### Maintainer-authorized cleanup

Branch Curator may perform a bounded manual cleanup when the current maintainer
explicitly authorizes cleanup and the curator proves every candidate safe from
fresh evidence. The authorization substitutes for the unavailable global
cross-system transaction; it does not substitute for candidate safety proof.

The manual path still:

- acquires and retains the existing local maintenance lease;
- runs the worktree guard and never bypasses it;
- queries Beads and GitHub immediately before mutation;
- preserves any live, claimed, recent, unique, protected, dirty, or uncertain
  state;
- uses expected-OID compare-and-delete for local and remote refs; and
- verifies postconditions before moving to the next mutation.

GitHub branch protection, required checks, and the protected-PR path for
`main` are unchanged.

## Authorization contract

Manual cleanup authority must be explicit in the current task. It may not be
inferred from a prior session, a standing maintainer role, a branch label, or
an old Bead comment.

The curator records this evidence before mutation:

- the maintainer's cleanup instruction;
- whether the scope is local refs/worktrees only or also remote branches;
- the exact repository and candidate set;
- the active Bead, session, branch, and worktree; and
- the audited default-branch OID.

Authorization is bounded to the recorded candidate set and expires when the
batch ends, the maintenance lease is lost, any audited OID changes, or the task
context changes. Newly discovered candidates require a new inventory and
explicit inclusion. Remote deletion is not implied by local-cleanup authority.

Authorization never permits:

- direct pushes to `main`;
- deletion or rewriting of a protected/default branch;
- forced worktree removal;
- deletion of unique work;
- bypassing `worktree-guard`;
- overriding an active Bead claim, open PR, workflow, or process owner; or
- continuing after a failed or uncertain mutation.

## Fresh inventory and classification

The curator begins from current `origin/main` and inventories all local refs,
remote refs, and worktrees. It must not use an earlier sweep as deletion proof.
For each candidate it captures the exact local and remote OIDs and classifies
the candidate using current evidence.

The following are always preserved:

- `main`, the remote default branch, protected refs, and the curator's current
  implementation branch/worktree;
- the user's primary checkout and any unrelated dirty checkout;
- dirty, locked, detached-with-unique-state, operation-in-progress, or
  process-owned worktrees;
- branches checked out by another active session;
- candidates with an active Bead claim, active familiar/session owner, open PR,
  queued/running workflow, or other verified writer;
- candidates with activity inside the repository's recency window;
- commits not proven reachable from a retained ref or verified archive; and
- candidates for which any inventory, API, parse, ancestry, reflog, recovery,
  ownership, or postcondition check is incomplete or ambiguous.

Absence of one signal is not proof of inactivity. For example, no live
worktree does not cancel an active Bead claim, and a merged PR does not by
itself prove that a same-named ref still points at the audited commit.

### Merge and deletion are separate operations

If a candidate contains valuable unmerged work, Branch Curator prepares or
uses a protected pull request. It does not push directly to `main` and does not
delete the candidate in the same unverified step.

Deletion becomes eligible only after the merge is live on the remote default
branch, required checks and PR state are verified where applicable, and a new
cleanup inventory proves that the candidate has no unique retained work.

## Exclusion and recheck boundary

The manual path uses the existing local maintenance lease to exclude
cooperating local writers while it rechecks and mutates local state. It records
the lease owner and expiry, renews it as required, and stops immediately if it
cannot prove continued ownership.

The lease is not described as a GitHub or Beads lock. Cross-system safety comes
from fresh fail-closed observations plus exact mutation preconditions:

1. acquire the local maintenance lease;
2. run the full inventory and safety proof;
3. immediately requery Beads ownership, GitHub PR/workflow state, relevant
   processes, worktrees, refs, and remote URLs;
4. require all audited OIDs and owners to be unchanged;
5. run `worktree-guard` for the exact worktree mutation;
6. perform one compare-and-delete mutation;
7. verify its postcondition; and
8. repeat the full recheck before any next mutation.

The complete applicable lease, Beads, GitHub, process, worktree, ref, recency,
archive, and recovery evidence is rerun immediately before each transaction:
worktree removal, local ref deletion, and remote ref deletion. Evidence from a
prior transaction is never reused as authorization for the next one.

Any observation failure, drift, new writer, lease loss, or guard refusal
preserves the candidate. If the guard rejects a state that should be safe, the
guard's proof model must be corrected and verified; the cleanup must not set a
bypass flag.

## Mutation contracts

Every worktree/ref/remote mutation is its own transaction boundary. Partial
success is reported truthfully and never justifies continuing after a later
failure.

Before candidate qualification and again immediately before every destructive
transaction, Branch Curator resolves the live remote default through
`git ls-remote --symref` and executes the normative fully-qualified ref guard
against every applicable local and remote candidate ref. The guard accepts only
`refs/heads/*` candidates and rejects literal `refs/heads/main`, the resolved
default ref, and the exact Beads/Dolt-owned
`refs/heads/__dolt_remote_info__`. Query or parse failure, a malformed ref, or
default-ref drift preserves the candidate. Authorization and matching OIDs
cannot override this guard.

### Worktree removal

A worktree may be removed only when its full safety and recovery proof passes
and Branch Curator receives explicit allow evidence from this direct strict
invocation immediately before removal:

```bash
env -u WT_GUARD_BYPASS -u WT_GUARD_TEST_MODE -u WT_GUARD_TEST_LSOF_BIN node scripts/worktree-guard.mjs --strict-worktree-remove "$worktree_path" --expected-head "$audited_worktree_head_oid"
```

The direct invocation explicitly unsets the bypass and both test-seam
variables. Strict mode is harness-independent and has no bypass. It fails
closed on a malformed target or OID and on any Git, remote, `lsof`, or probe
uncertainty, and emits explicit machine-parseable allow evidence only on
success. The existing no-argument Claude hook and its deliberate bypass
behavior remain unchanged. Removal does not use force. Afterward, both the path
and its worktree registry entry must be absent.

### Local ref deletion

The curator deletes the fully qualified local ref only if it still points at
the audited OID:

```bash
git update-ref --no-deref -d "$local_ref" "$audited_local_oid"
```

It then requires `git show-ref --verify` to report the ref absent. An OID race
causes the compare-and-delete to fail safely.

### Remote ref deletion

Remote deletion requires separately explicit remote-cleanup authority, a
verified `origin` fetch/push destination, an exact audited remote OID, and the
same full candidate proof. It uses an exact lease:

```bash
git push --force-with-lease="$remote_ref:$audited_remote_oid" \
  origin ":$remote_ref"
```

The curator then requires `git ls-remote --exit-code --heads` to return status
2 for the exact ref. If the remote OID or destination changes, deletion stops.
For this manual profile only, the recorded remote-cleanup authorization is the
disposition for GitHub's unavailable server-side ref-update timestamp. It does
not waive the 24-hour local/recovery recency checks or any observable PR,
workflow, commit, ownership, or branch-activity signal. Commit age is never
presented as remote-ref recency proof.

## Documentation and implementation scope

Implementation updates the manual Branch Curator contract, not the automatic
lifecycle authority:

- `.agents/skills/branch-curator/SKILL.md` distinguishes automatic and manual
  profiles and requires explicit bounded authorization for the latter;
- `.agents/skills/branch-curator/references/deletion-proof.md` documents the
  authorization evidence, recheck sequence, exact mutation commands, and
  postconditions;
- `scripts/worktree-guard.mjs` adds the direct, fail-closed strict invocation
  used by Branch Curator without changing the existing no-argument hook; and
- `scripts/worktree-guard.test.mjs` pins strict refusal and exact allow-output
  behavior alongside the unchanged hook tests;
- `.agents/skills/branch-curator/evals/evals.json` preserves the automatic
  lifecycle cases at 43-51 and adds the bounded manual cases at 52-59, covering
  authorization scope, race handling, protected/live preservation, local
  versus remote authority, and the unchanged automatic gate;
- the automatic-retirement design is annotated to point at this manual
  exception without changing its runtime contract; and
- any conflicting operator documentation is updated to say that
  `retire-after-gate` is not deletion authority for automatic retirement, while
  current explicit maintainer authorization may activate the manual proof
  path.

No GitHub protection setting, lifecycle classifier outcome, background cleanup
job, or direct-main workflow changes in this patch.

## Verification

Verification must include:

1. branch-curator evals showing that vague, historical, local-only, and
   automatic requests cannot authorize remote or unattended deletion;
2. evals showing that explicit bounded maintainer authorization reaches the
   manual proof path but still preserves dirty, live, recent, unique,
   protected, or uncertain candidates;
3. evals requiring expected-OID local and remote deletion and stopping on ref
   drift;
4. evals requiring the local lease, strict worktree guard, complete fresh
   evidence before each transaction, and postcondition verification;
5. strict worktree-guard tests covering malformed, dirty, unpushed, live,
   drifted, and probe-failure refusal plus the one exact allow record;
6. existing no-argument worktree-guard hook tests and maintenance-gate tests;
7. repository lint/tests relevant to changed documentation or skill gates; and
8. a real dry-run inventory followed by a bounded cleanup of only candidates
   that pass the new contract.

The current baseline has one load-sensitive maintenance-gate timing test: the
combined maintenance-gate/worktree-guard run failed once at “a gate is active
when acquisition returns after a slow drain,” while the isolated rerun passed.
This implementation must distinguish that existing timing flake from any
regression and report both commands and results.

## Rollout

1. Land the contract and eval changes through a protected PR.
2. Reconcile from clean, current `origin/main` after merge.
3. Run Branch Curator in inventory/dry-run mode and publish the exact preserve,
   merge, local-delete, and remote-delete sets.
4. Under the user's existing cleanup authorization, execute only the approved
   bounded candidates with fresh evidence and exact mutation preconditions.
5. Run `pnpm beads:worktrees`, record every worktree as removed and verified or
   preserved with owner/reason, and update the Bead with proof.

The broader full-gate work remains valid for unattended automatic retirement;
it is no longer a prerequisite for the explicit manual cleanup profile.
