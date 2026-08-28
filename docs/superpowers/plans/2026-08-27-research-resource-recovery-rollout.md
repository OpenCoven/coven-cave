# Research Resource recovery and rollout plan

**Bead:** `cave-6sles.9`
**Program unit:** A8 — Resource backup, restore, deletion repair, and rollout
**Depends on:** A4 merged in PR #5065 and A5 merged in PR #5067
**Scope:** archive-v1 inclusion, post-restore Research reconciliation, tombstone
repair, and reversible local-resource rollout. Context Packs, semantic retrieval,
hosted execution, and new archive envelope versions are out of scope.

## Goal

Make the Cave-owned Research Resource catalog recoverable without treating
operational or derivative state as authority. A backup must preserve every byte
needed to prove current manifests and immutable snapshots, while a restore must
reject the complete archive before writing anything when any path or digest is
invalid. After authoritative files land, deterministic repair must finish the
saved-link projection, preserve deletion fences, recreate only manifest-intent
jobs, and rebuild lexical data only from verified current snapshots.

The feature flags remain reversible rollout controls, not data-lifecycle
switches. Disabling a flag stops new feature work but never deletes Resource
state, weakens compatibility reads, suppresses deletion repair, or makes an
older pre-A4 build a valid rollback target.

## Archive-v1 authority boundary

Keep `BACKUP_ARCHIVE_VERSION === 1` and the existing encrypted envelope. Add
these Cave-root paths to the allowlist:

```text
research-resources/manifests/
research-resources/snapshots/
research-resources/blobs/
research-resources/tombstones/
research-resources/migration/
```

They are authoritative for user intent, immutable snapshot receipts and CAS
bytes, retained deletion proof, and the backward-compatible saved-link
projection epoch/journal. Files retain their existing archive `secret` policy;
the encrypted envelope protects private fetched content at rest in transit.

Explicitly exclude every reconstructible or process-owned path, even if a
future broad candidate would otherwise admit it:

```text
research-resources/jobs/
research-resources/failures/
research-resources/fences/
research-resources/deletions/
research-resources/locks/
research-resources/index/
research-resources/index/research-resources.sqlite{-wal,-shm}
```

The generic `.tmp`, `.lock`, and socket/log exclusions remain in force. Backup
collection continues to ignore symlinks and non-regular files. Tests pin both
positive and negative membership so an allowlist broadening cannot silently
export private plaintext derivative or live lease state.

## Restore phases and crash contract

`restoreBackupArchive` keeps the existing decrypt-and-validate boundary. No
filesystem mutation may occur until AES-GCM authentication, tar parsing,
allowlisted normalized paths, one-to-one manifest membership, byte counts,
per-file SHA-256 digests, and totals have all passed.

After validation, recovery runs in these phases:

The complete Research portion of restore holds the same cross-process intent
lock as catalog and operational mutations. Nested recovery transactions reuse
that held lease, while unrelated processes remain queued until authoritative
writes, reconciliation, and derivative replacement have all completed.

1. Mark the canonical lexical derivative unavailable and remove its stale
   database and residual siblings before the first authoritative write. Write
   every archive file with the existing unique-temp atomic replacement.
   Owner-private Research directories and records are revalidated by the
   Research stores before use.
2. Prune authoritative Research files absent from the validated archive, so a
   restore into a non-empty Cave cannot retain newer/stale manifests, snapshots,
   tombstones, migration records, or private CAS bytes. The archive manifest's
   Research exclusions mark even an empty Research namespace as A8-aware.
3. Remove local-only jobs, failures, and deletion journals that did not come
   from the archive; no restored lease is trusted. Preserve any higher local
   deletion fence so restore cannot lower deletion authority. Replace the
   lexical SQLite database and purge rebuild/quarantine siblings in phase 7.
   Cleanup is bounded to the restored `research-resources` root.
4. Reconcile saved-link migration state through the A4 compatibility owner.
   A prepared/committed journal is completed; divergence uses A4's deterministic
   three-way merge and tombstoned ids remain filtered.
5. Repair deletion authority from retained tombstones. A missing deletion
   fence is reconstructed at the tombstone revision; no repair may lower an
   existing revision. A manifest at the same retained fence is a valid same-id
   recreation only when its `createdAt` is strictly later than the tombstone's
   `deletedAt`. An older or equal manifest is interrupted deletion residue and
   must be removed before publication or enqueue.
6. Recreate desired ingest jobs from current manifest intent. Ready manifests
   are first verified against their immutable snapshot and blob digests. A
   missing/corrupt current snapshot becomes refresh intent; non-ready desired
   manifests receive exactly one deterministic job. No restored lease is
   trusted.
7. Rebuild the lexical derivative from verified, ready, current snapshots and
   the exact `(resourceId, resourceRevision, deletionRevision, snapshotId,
   snapshotDigest)` authority tuple. The old database remains unavailable until
   the replacement has been fsynced and atomically swapped.

Each phase is idempotent. A crash after authoritative writes but before repair
leaves only valid archive files plus disposable residue; rerunning restore or
startup recovery converges. A crash during compatibility repair follows A4's
journal. Job ids remain deterministic across replay. A crash during lexical
rebuild follows A5's quarantine/rebuild behavior. The restore response reports
reconciliation only after every phase completes; a repair failure is returned
as failure and never as a successful partial recovery.

## Recovery API

Add a server-only coordinator with an injectable test seam:

```ts
type ResearchResourceRecoveryResult = {
  projectionReconciled: boolean;
  tombstoneFencesRepaired: number;
  jobsRecreated: number;
  lexicalRebuilt: boolean;
};

reconcileRestoredResearchResources(options):
  Promise<ResearchResourceRecoveryResult>;
```

The coordinator receives an explicit Research root in tests and otherwise
derives `<caveHome>/research-resources`. It owns ordering, while A4 compatibility,
A5 store, ingestion, and lexical modules continue to own their persistence
invariants. `restoreBackupArchive` invokes it only when the validated archive
contains a `research-resources/` authoritative entry, preventing ordinary
legacy archives from creating a new Resource tree as a side effect.

The archive restore path gains an injectable post-restore callback/failpoint
for crash-order tests, but production callers use the default coordinator.
Injection must not bypass archive validation or path checks.

## Tombstone and migration rollback rules

Tombstones are retained authority, not garbage. Recovery computes each
resource's deletion revision as the maximum valid retained tombstone/fence
revision and never resets it to zero. It rejects inconsistent lower-revision
state rather than guessing. Exact deletion-revision equality is intentionally
allowed only for a same-id recreation whose `createdAt` is strictly after the
retained deletion; publication still binds both resource and deletion revision.

The A4 legacy projection remains writable and readable while Resource UI or
ingestion flags are off. Rollback uses expand/enable/contract:

- **expand:** dual legacy/catalog reads and archive-v1 Research support ship
  while all Research flags default off;
- **enable:** promote `caveResearchResources`, then
  `caveResearchLocalIngestion`, only after focused recovery and restart evidence;
- **contract:** no contraction is part of A8. The migration journal,
  tombstones, Resource files, and dual reader remain supported.

An operational rollback disables local ingestion first, then Resources UI. It
does not remove the Resource root or downgrade archive-v1 readability. A build
from before A4/A5 is not an acceptable rollback once Resource-backed writes
exist.

## Feature-gate behavior

`src/lib/feature-flags.ts` remains the sole authority:

- all Research flags default off;
- local ingestion requires Resources;
- semantic work requires local ingestion but never gates lexical recovery;
- Context Packs require Resources, not ingestion;
- Topic Discovery requires Context Packs;
- hosted runs remain fail-closed until a server-only Gate C0 authority exists.

Restore validation, tombstone repair, compatibility reconciliation, and
derivative rebuild are maintenance operations and remain available with rollout
flags off. The flags gate new user-visible work, not recovery of already-owned
data.

## Test matrix

Focused tests must prove:

1. Archive-v1 includes each authoritative Research directory and exact bytes.
2. Jobs, failures, fences, deletion journals, locks, SQLite, WAL/SHM, rebuild
   temps, and quarantine files are excluded.
3. Invalid path, digest, totals, or payload membership rejects before the first
   restore write or recovery callback.
4. Restore completes a saved-link compatibility journal and preserves its
   monotonic catalog revision.
5. Tombstone-only restore repairs a deletion fence; rerun is idempotent; a
   higher fence is never lowered; a post-tombstone same-id recreation at the
   retained fence survives; a pre-/equal-tombstone manifest is deleted.
6. Desired queued/failed-retryable manifests recreate one deterministic job,
   terminal failures do not silently retry, and flags-off maintenance still
   repairs authority without executing network fetches.
7. Ready manifests rebuild lexical data only after snapshot and blob digest
   verification; stale/deleted resources and pre-restore SQLite plaintext never
   appear.
8. Failpoints after authoritative restore, projection repair, job recreation,
   and before lexical swap converge on the next recovery without duplicate
   jobs or resource resurrection.
9. The existing archive-v1, A4 compatibility/crash, A5 ingest/deletion/crash,
   feature-flag, and route local-origin suites remain green.

## Implementation sequence

1. Land this detailed plan before implementation edits.
2. Extend the backup manifest with the narrow Research authority allowlist and
   explicit derivative/operational exclusions.
3. Add the recovery coordinator and the minimum store repair seam required for
   monotonic tombstone-derived fences.
4. Integrate post-restore reconciliation without changing archive-v1.
5. Add membership, validation barrier, tombstone, restart/failpoint, lexical,
   and flags-off recovery tests; wire every new test exactly once.
6. Run focused suites, A4/A5 regressions, `pnpm check:tests-wired`,
   `pnpm typecheck`, `pnpm lint`, and `git diff --check`.

## Stop conditions

Stop rather than report success if any archive validation can occur after a
write, any excluded derivative can enter the encrypted payload, recovery can
lower deletion authority, a stale worker/job can survive restore, compatibility
repair can resurrect a tombstoned id, or the feature-off path makes existing
Resource data unreadable.
