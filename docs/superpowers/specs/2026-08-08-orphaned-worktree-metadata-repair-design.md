# Orphaned Worktree Metadata Repair

**Bead:** `cave-525id`

## Problem

Managed worktree creation refuses when a non-closed Bead already has
`metadata.coven.worktree`, even if the recorded local branch and worktree were
destroyed out of band. The documented recovery command,
`pnpm beads:worktrees:apply`, cannot help because the lifecycle inventory is
built from registered worktrees and local branches. A record with neither is
invisible.

The result is a permanent deadlock: creation requires the stale record to be
retired, while retirement cannot observe it. Hand-editing Bead metadata and
creating an unmanaged worktree are both prohibited escape hatches.

## Goals

- Surface stale lifecycle records on non-closed Beads when no corresponding
  local branch or worktree remains.
- Make the existing gated `beads:worktrees:apply` path safely remove those
  records.
- Preserve unrelated Bead metadata and valid sibling worktree records.
- Re-prove every destructive assumption immediately before persistence.
- Allow managed creation to proceed normally after repair.

## Non-goals

- Delete remote branches or remote tags.
- Treat a present but unregistered directory as disposable.
- Rewrite lifecycle metadata on closed Beads, where retained records are
  historical and do not block new work.
- Relax the managed creation exception or admission rules.
- Feed metadata-only records into Git worktree or branch deletion operations.

## Design

### Inventory model

Add a separate `orphanedMetadata` collection to the lifecycle inventory. An
entry identifies the Bead, the exact structured record, whether it is primary
or additional, and the evidence used to classify it.

A record is repairable only when all of these are true:

1. The Bead status is not `closed`.
2. The structured lifecycle metadata is valid and unambiguous.
3. No registered worktree has the record's normalized path.
4. No local branch has the record's exact branch name.
5. The recorded path does not exist on disk.

If the path exists but is unregistered, the inventory reports the condition as
blocked rather than orphaned. The directory may contain the only copy of
uncommitted work and must never be removed or disowned automatically.

Metadata-only records remain distinct from `WorktreeLifecycleItem`. They have
no trustworthy HEAD OID or local ref, so manufacturing either would weaken the
exact-identity guarantees used by Git retirement.

### Reporting

The patrol's JSON output includes `orphanedMetadata` and an
`orphanedMetadataCount`. Human output adds an "Orphaned metadata" section with
the Bead ID, branch, path, record location, and repairability reason.

Dry-run patrol remains read-only. Its output makes the creation refusal's
existing `pnpm beads:worktrees:apply` suggestion actionable and diagnosable.

### Gated repair

`--apply` repairs orphaned metadata within the existing repository maintenance
gate. Before each Bead mutation, the repair path also acquires the same global
and Bead-specific writer intents used by managed creation so creation and
repair cannot persist competing snapshots.

For every selected orphan:

1. Heartbeat and verify the maintenance gate and writer intents.
2. Reread the exact Bead.
3. Parse its current structured metadata.
4. Verify the target record is deeply equal to the inventoried structured
   record.
5. Recheck the local branch inventory, registered worktree paths, and recorded
   filesystem path.
6. Build metadata that removes only the target lifecycle record.
7. Persist only the `coven` metadata subtree with `bd update --metadata`.
8. Reread the Bead and verify the intended lifecycle metadata and all unrelated
   metadata were preserved.

If the primary record is removed while valid additional records remain, promote
the first additional record to `metadata.coven.worktree` and keep the remaining
order. If no records remain, remove `worktree` and `worktrees` from `coven`;
preserve any unrelated `coven` keys, leaving an empty `coven` object when there
are none.

Any changed record, new branch, registered worktree, present path, lost gate,
lost writer intent, malformed reread, failed update, or failed verification
produces a blocked repair. It never reports success-shaped output.

Metadata repairs count against the existing `--max-retire` batch limit so one
apply invocation remains bounded. Git retirement candidates retain their
current ordering; orphan repairs run before Git deletion because they perform
no filesystem or ref deletion and can unblock work immediately.

### Creation behavior

Managed creation keeps its current fail-closed behavior. It does not silently
replace or append around stale primary metadata. After a successful apply, the
next creation sees the repaired Bead snapshot and follows the normal admission,
worktree creation, and metadata persistence path.

## Error handling and concurrency

- Inventory parse failures remain global errors.
- A metadata record is never repairable based on path absence alone; exact
  local branch absence is also required.
- Filesystem probing failures block the record.
- Fresh-state checks happen after locks are acquired and immediately before the
  Bead update.
- Persistence verification distinguishes blocked, partial, and repaired
  outcomes.
- Writer intents are always released, including failure paths.
- Remote state is observational only and is never mutated.

## Tests

Add fixture coverage proving:

- A non-closed Bead whose exact branch and path are absent is reported.
- Closed Bead metadata is not reported as an actionable orphan.
- A registered path, local branch, or present unregistered directory blocks
  repair.
- Dry-run patrol does not mutate Beads.
- Apply removes a sole orphaned primary record while preserving unrelated
  metadata.
- Apply promotes an additional record when the primary is removed.
- Apply removes an orphaned additional record without changing the primary.
- A concurrent metadata, branch, path, or registration change blocks repair.
- Update failures and unverifiable writes are surfaced.
- Batch limits include metadata repairs.
- Managed creation succeeds after the stale record is repaired.

Run the focused lifecycle library, patrol, retirement, and creation tests, then
the repository's relevant type and lint gates.
