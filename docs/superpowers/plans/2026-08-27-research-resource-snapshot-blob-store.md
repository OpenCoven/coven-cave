# Research Resource Snapshot and Blob Store Implementation Plan

**Goal:** Add the Cave-owned store that publishes immutable Research Resource
snapshots over a dedicated content-addressed blob store, verifies every byte at
the trust boundary, and garbage-collects a blob only after proving that no live
snapshot references it.

**Source:**
`docs/superpowers/plans/2026-08-16-externalized-research-desk-program.md`
§§2, 3.1-3.4, 5, 11 A2, and 13, building on
`src/lib/research-resource-contracts.ts` from A1.

**Boundary:** A2 owns the resource CAS, immutable snapshot persistence,
normalization receipt contract, verified reads, and snapshot-to-blob reference
accounting. It does not add manifests, list/detail APIs, legacy saved-link
migration, fetchers, extractors, jobs, indexes, embeddings, Context Packs,
backup integration, UI, or changes to the portable Research Run Protocol.
Those remain A3 and later work.

## Storage layout and ownership

The store is rooted at `<caveHome>/research-resources/` and A2 creates only:

```text
research-resources/
  snapshots/<snapshot-id>.json
  blobs/sha256/<first-two-hex>/<digest>
  locks/intents/<intent-id>.lock
```

The resource CAS is physically and logically separate from
`research-context-packs/`. A later Context Pack build must copy selected bytes
into the pack-owned CAS; it must never retain a resource-CAS path or depend on a
resource snapshot remaining present.

Production code derives the root from `caveHome()`. Tests inject a root through
a store factory/options object; there is no new production environment override
that can redirect authoritative data.

Every directory is owner-only (`0700`) and every file is owner-only (`0600`).
On POSIX, an existing path must be owned by the current uid and already have the
exact private mode; broader permission bits are refused rather than repaired
through a race-prone pathname chmod. Foreign-owned paths are refused. On
Windows, the existing exclusive-path ownership/DACL guard is used for the store
root and the created subtree. No permission policy makes a symlink, junction,
foreign-owned path, or unclassifiable entry acceptable.

## Contract decisions

### The immutable snapshot is the normalization receipt

A2 does not create a second receipt file that could disagree with its snapshot.
Instead it adds this required, typed field to `ResourceSnapshotV1`:

```ts
type ResourceNormalizationReceiptV1 = {
  extractorId: string;
  extractorVersion: string;
};

type ResourceSnapshotV1 = {
  // A1 fields remain unchanged.
  normalizationReceipt: ResourceNormalizationReceiptV1;
};
```

Both receipt strings are non-empty, trimmed identifiers. The containing
snapshot already records the raw digest when one exists, normalized digest,
normalized media type, exact byte count, selector, page-boundary table, source
fetch metadata, and creation time. Keeping extractor identity/version beside
those results makes the immutable snapshot the complete durable normalization
receipt without duplicating integrity fields. A2 updates the parser and focused
contract fixtures so the receipt is validated rather than passing through as an
unknown additive object. No persisted A1 snapshot exists because A1 shipped no
store or writer, so making the receipt required does not require a migration.

Snapshot ids are path segments and therefore have a stricter store grammar than
the general A1 identifier helper: ASCII alphanumeric first, followed by at most
127 ASCII alphanumeric, `_`, or `-` characters. Windows device names are
refused case-insensitively. A caller value is never joined to a filesystem path
until this grammar passes. Digests keep the existing exact lowercase 64-hex
grammar; the first two digest characters select the shard.

### Immutability and idempotence

Snapshot JSON is serialized with the existing RFC 8785-compatible canonical
JSON helper. A snapshot id is write-once:

- publishing an absent id atomically creates it;
- replaying the same canonical snapshot succeeds as an idempotent no-op; and
- replaying the id with any different canonical content returns an immutable
  conflict and changes nothing.

Blobs are keyed by SHA-256 over their exact bytes. Publishing an existing digest
verifies the existing regular file through a stable, no-follow handle. Matching
bytes are deduplicated; a digest mismatch or unsafe entry is corruption, not an
instruction to overwrite the path.

The hard safety ceiling for either one raw or normalized blob is 512 MiB. The
store rejects a larger byte array before creating a temporary file. A2 does not
invent a user-visible total storage quota or provider quota: ingest quota and
`paused_quota` policy belong to A5. Reference scans are nevertheless bounded to
100,000 snapshot entries and fail closed on an unexpected, unreadable, or
unclassifiable entry rather than reporting a partial proof as complete.

## Store API

Add `src/lib/server/research-resource-store.ts` with these server-only seams:

```ts
type PublishResourceSnapshotInput = {
  snapshot: ResourceSnapshotV1;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
};

type VerifiedResourceSnapshot = {
  snapshot: ResourceSnapshotV1;
  normalizedBlob: Uint8Array;
  rawBlob?: Uint8Array;
};

createResearchResourceStore(options?: { root?: string }): ResearchResourceStore;

ResearchResourceStore.publishSnapshot(
  input: PublishResourceSnapshotInput,
): Promise<{ created: boolean; snapshot: ResourceSnapshotV1 }>;

ResearchResourceStore.readSnapshot(
  snapshotId: string,
): Promise<VerifiedResourceSnapshot>;

ResearchResourceStore.deleteSnapshot(
  snapshotId: string,
): Promise<{ deleted: boolean; removedBlobDigests: string[] }>;
```

`publishSnapshot` is the only public blob-write seam. It validates and detaches
the snapshot, hashes both supplied byte arrays, requires the normalized hash and
byte length to equal `normalizedBlobDigest` and `normalizedBytes`, and requires
`rawBlob` presence to match `rawBlobDigest` presence and value. It publishes
each unique blob first and makes the snapshot visible last, all under the store
mutation lock. If raw and normalized bytes have the same digest they occupy one
CAS file and count as one snapshot reference.

`readSnapshot` never returns unverified content. It safely opens and parses the
snapshot record, then opens each referenced CAS path with the same no-follow and
identity checks, reads within the hard cap, recomputes SHA-256, and checks the
normalized byte count before returning detached bytes. Missing, malformed,
oversized, unsafe, or digest-mismatched content is a typed integrity error.

The module may keep narrower helpers private for layout validation, immutable
publication, safe open/read, and reference scanning. It must not export a raw
path, unchecked `readFile`, unchecked blob put, or recursive removal primitive.

## Filesystem and CAS invariants

The store root is private to the Cave OS account. A malicious process already
running as that same account is outside A2's enforceable boundary: Node exposes
no `openat`/`linkat`/`unlinkat` API that can bind a namespace mutation to an
already-validated directory handle. A2 rejects pre-existing traversal,
symlink/junction, hard-link, ownership, mode, and identity violations and
rechecks paths around operations, but it does not claim to prevent a hostile
same-user process from swapping a parent in the final pathname-syscall window.
Closing that residual race would require a native directory-relative helper and
is not represented as a guarantee in this JavaScript store.

Every operation establishes and rechecks the following invariants:

1. The root, `snapshots`, `blobs`, `sha256`, shard, and lock directories are real
   directories, not symlinks or junctions, and their `realpath` remains inside
   the canonical root.
2. Directory identity (`dev` and `ino`) is captured after validation and checked
   again around opens and namespace operations. Detected parent swaps are
   integrity failures; the documented same-user final-syscall race remains.
3. POSIX reads add `O_NOFOLLOW`; every platform also compares `lstat` before
   open, handle `stat`, and `lstat` after open, verifies a regular file, and
   checks final `realpath` containment. Windows junction/reparse substitutions
   therefore cannot be admitted solely because `O_NOFOLLOW` is unavailable.
4. Published files have exactly one link after the temporary publication link
   is removed. Reads and deletes refuse a final file with an unexpected hard
   link count so a CAS path cannot alias mutable bytes outside the store.
5. Temporary files are unique, created with exclusive/no-follow flags and mode
   `0600`, checked against the opened handle identity, written completely, and
   file-synced before publication.
6. Immutable publication is no-clobber. After syncing the temporary file, an
   atomic hard link into the final name wins only when that name is absent; an
   `EEXIST` contender verifies the winner. Ordinary replacing `rename` is not
   used for immutable blobs or snapshots.
7. The containing directory is synced where the host supports directory fsync.
   Unsupported-operation errors are tolerated only after the file handle sync
   and atomic namespace operation succeeded; permission errors always fail.
8. A temporary file is removed on every failure. Unexpected non-temporary
   entries are never swept. The store does not follow links during cleanup.
9. Blob identity is always derived from computed bytes. A caller-supplied digest
   is an assertion to verify, never a filename authority by itself.
10. A resource blob is never read from, written to, referenced by, or collected
    through the Context Pack root.

The generic `writeFileAtomic` helper is intentionally not used here: it is a
last-writer-wins replacement helper, does not set the required file mode, and
does not fsync the file or directory. The safe directory/handle identity pattern
in `research-media-store.ts`, the canonical JSON and SHA-256 helpers in
`research-protocol/digest.ts`, and the FIFO cross-process intent lock are the
starting primitives, tightened for immutable no-clobber publication.

## Deletion and reference accounting

All snapshot publication and deletion uses one cross-process store mutation
lock. The lock directory is validated with the same path rules and intent files
remain unique `0600` records. A live lock is never reclaimed by age alone.

Deletion is proof-driven and ordered:

1. Acquire the mutation lock and validate the entire store layout.
2. Enumerate snapshot entries without following links. Every non-temporary
   entry must be a safe `<snapshot-id>.json` regular file whose parsed `id`
   matches its filename. Parse every record before mutating anything.
3. Build a map from each unique raw/normalized digest to the set of remaining
   snapshot ids. Duplicate raw/normalized fields inside one snapshot contribute
   one reference, not two.
4. If the requested id is absent, return `deleted: false` without mutation. If
   any live record is malformed, unreadable, unsafe, or changes identity during
   the scan, fail closed: absence of a complete reference graph is not proof of
   zero references.
5. Unlink the requested snapshot record first and sync `snapshots/`. A crash at
   this point can leave an orphan blob but cannot leave a visible snapshot that
   points to a blob A2 removed.
6. Consider only the unique digests formerly referenced by that snapshot.
   Remove a candidate only when its remaining reference set is empty and its
   exact CAS entry is a contained, single-link regular file. Never recurse.
7. Return the sorted digests actually removed. Failure after snapshot unlink is
   recoverable orphan residue; it is never repaired by restoring the deleted
   snapshot or guessing at references.

This A2 operation deletes one immutable snapshot record. Resource deletion,
tombstone fencing, manifest-last ordering, and startup resumption remain A3/A5
orchestration. Those callers must use this proof-preserving operation rather
than unlinking CAS paths themselves.

## Focused test matrix

Add `src/lib/server/research-resource-store.test.ts` and extend
`src/lib/research-resource-contracts.test.ts`. Automated A2 coverage includes:

- a raw and normalized blob round trip with exact digests, media type, byte
  count, receipt, selector, and owner-only modes;
- raw and normalized bytes sharing one digest and one physical CAS entry;
- concurrent publication of the same bytes deduplicating without a partial
  file, and concurrent different content for one snapshot id producing exactly
  one winner and one immutable conflict;
- idempotent replay of byte-identical canonical snapshot JSON, including
  different input object key order;
- mismatched raw digest, normalized digest, normalized byte count, missing raw
  bytes, and unexpected raw bytes rejected before snapshot visibility;
- untrimmed, traversal, slash, backslash, overlong, Unicode, and Windows device
  snapshot ids rejected before path construction;
- symlinked roots, snapshot directories, final snapshot records, and final blobs
  refused on POSIX;
- a hard-linked final blob or snapshot refused on read and deletion;
- a corrupted existing CAS winner causing a typed integrity error rather than
  replacement, quarantine, or silent deduplication;
- malformed, missing, or digest-mismatched referenced blobs causing
  `readSnapshot` to fail without returning metadata or partial bytes;
- deletion of one of two snapshots sharing a blob preserving the blob, followed
  by deletion of the last reference removing it;
- raw and normalized duplicate digest counted once during deletion;
- a malformed sibling snapshot making reference accounting fail closed before
  any unlink, and POSIX broader-mode refusal without pathname repair; and
- parser coverage for a valid receipt, missing receipt, empty/untrimmed
  extractor fields, unknown receipt fields, and detached returned data.

The 512 MiB ceiling is a direct pre-I/O guard but is not exercised by allocating
a half-gigabyte test fixture. Windows DACL/junction behavior is covered by the
shared ownership guard's platform suite; POSIX link tests skip on Windows where
unprivileged link creation is not reliable. A future native directory-relative
filesystem seam must add deterministic parent-swap and unlink-failure injection
tests before claiming protection against hostile same-user namespace races.

## Implementation sequence

1. Extend the A1 snapshot type/parser and its fixtures with the required strict
   normalization receipt.
2. Add the server-only store with typed errors, safe id/digest paths, exclusive
   ownership enforcement, stable directory/open-handle checks, canonical JSON,
   verified hashing, and immutable no-clobber publication.
3. Add snapshot-first deletion and complete reference accounting under the
   cross-process mutation lock.
4. Add the focused adversarial test suite and register it with the app test
   runner. Keep portable conformance wiring unchanged.

Expected implementation paths are:

- `src/lib/research-resource-contracts.ts`
- `src/lib/research-resource-contracts.test.ts`
- `src/lib/server/research-resource-store.ts`
- `src/lib/server/research-resource-store.test.ts`
- `scripts/run-tests.mjs`

No file under `schemas/research/v1/`, `src/lib/research-protocol/`, the Context
Pack store, or a UI surface belongs in A2.

## Verification

Run the focused contract and store tests first, followed by:

```bash
pnpm test:app
pnpm test:conformance
pnpm typecheck
pnpm lint
pnpm check:tests-wired
git diff --check
```

The review must also confirm that the exact diff contains no portable protocol,
Context Pack, API, manifest, migration, index, job, embedding, backup, or UI
change; every snapshot read returns digest-verified bytes; snapshot publication
is blob-first; and deletion is snapshot-first with a complete fail-closed
reference proof.

## Rollback

Research Resource feature flags remain default-off. Before any A3 manifest can
point at these snapshots, reverting A2 removes an unreachable store and contract
field with no migration. After A3, rollback must preserve the
`research-resources/` directory as opaque authoritative data; an older build may
ignore it but must not delete or rewrite it. No rollback path may merge the
resource CAS into the Context Pack CAS or discard a snapshot merely because its
blob cannot be verified.
