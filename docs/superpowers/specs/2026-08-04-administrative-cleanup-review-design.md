# Administrative Cleanup Review Design

## Goal

Let maintainers retire clean, landed local branches and worktrees when the only
remaining blockers are lifecycle paperwork: missing structured worktree
metadata and/or a non-closed Bead. Preserve every existing protection against
dirty, active, unique, recent, recovery, or remotely divergent work.

## Classification

Add a `review-needed` lifecycle lane. A unit may enter this lane only when:

- it is not the primary checkout, protected, detached, recovery-named, or WIP-named;
- the worktree has no tracked, untracked, ignored, submodule, or index-flag state;
- no process, Coven claim, Coven session, open pull request, or active workflow owns it;
- all required probes completed successfully;
- its exact HEAD is on the fetched default branch or matches the exact head of a merged
  pull request;
- any same-named remote ref is absent or points to the same commit;
- branch and recovery activity is older than the existing eight-hour cooldown; and
- the only remaining blockers are missing lifecycle metadata and/or one or more
  non-closed Beads.

Malformed, duplicate, or conflicting metadata remains `uncertain`; it is not
equivalent to absent metadata. Unique commits, mismatched merged-PR heads,
divergent remotes, and recovery dispositions remain `recovery`. Dirty or
runtime-owned units remain `active`.

Automatic retirement must never consume `review-needed` units.

## Patrol Output

`pnpm beads:worktrees` reports each `review-needed` unit with:

- the exact local ref and HEAD OID;
- whether a registered worktree exists;
- each administrative blocker;
- the owning Bead IDs, titles, statuses, and update timestamps; and
- the evidence proving the commit landed and remains retained.

The report explains that a current maintainer may authorize one exact local
cleanup candidate. It must not describe the unit as stale, abandoned, or safe
to delete without that approval.

## Review Command

Provide a bounded command for one candidate at a time. Its interface requires:

- one fully qualified local branch ref;
- the expected HEAD OID shown by the patrol;
- a non-closed curation Bead recording current maintainer authorization; and
- an explicit administrative-review confirmation flag.

The command acquires the repository maintenance lease and rebuilds the complete
inventory. It proceeds only if the ref and OID are unchanged and the candidate
still classifies as `review-needed`.

Immediately before mutation it reruns the Beads, process, claim, session,
worktree, GitHub PR, workflow, recency, retention, and recovery checks. It then
runs strict `worktree-guard`, removes a clean worktree without force when one
exists, and compare-deletes the exact local ref. It verifies both postconditions
before reporting success.

The command is local-only. It never deletes a remote ref, closes or edits a
candidate-owning Bead, synthesizes lifecycle metadata, shortens the cooldown,
accepts a wildcard, or approves a batch.

## Failure Handling

Every lookup, parse, lease, guard, and postcondition failure stops the
transaction and preserves the candidate. OID drift, new worktree changes, new
runtime ownership, a new PR or workflow, changed task ownership, or a lost
maintenance lease invalidates the authorization.

If worktree removal succeeds but exact ref deletion refuses because the ref
advanced, the advanced ref remains intact and the command reports the partial
local state explicitly. No force-removal or bypass path is provided.

## Testing

Unit classification tests cover:

- missing metadata alone;
- open, blocked, and deferred Beads;
- missing metadata plus non-closed Beads;
- malformed or duplicate metadata;
- dirty, ignored, submodule, and index-flag state;
- active processes, claims, sessions, PRs, and workflows;
- unique commits, merged-PR head mismatch, and divergent remotes;
- recovery/WIP branches and detached HEADs; and
- cooldown and unavailable recency.

Retirement integration tests cover successful local-only worktree and
branch-only cleanup plus refusal on OID drift, lease loss, guard refusal, newly
active ownership, changed GitHub evidence, and postcondition failure. Existing
automatic-retirement tests must assert that `review-needed` is never selected.

## Non-goals

- Deleting remote branches.
- Relaxing dirty-work, live-writer, recovery, uniqueness, or recency checks.
- Automatically closing stale Beads.
- Backfilling or fabricating lifecycle metadata.
- Increasing automatic retirement batch size.
