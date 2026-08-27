# Research saved-link migration and reverse projection plan

**Bead:** `cave-6sles.5`
**Program unit:** A4 — Saved-link migration and reverse projection
**Depends on:** A3 merged in PR #5064
**Scope:** Cave-local compatibility state only. This unit does not start A5
ingestion, lexical indexing, snapshot refresh, general resource deletion,
backup expansion, or UI work.

## Goal

Make the Research Resource catalog authoritative for saved links without
breaking current readers, writers, downgrade, or rollback. Every successful
compatibility mutation must leave a complete, byte-verified
`research-links.json` that an older Cave can read. Every interrupted mutation
must be recoverable before a compatibility read is served.

## Existing contracts

The legacy file remains:

```ts
type ResearchLinksFile = {
  version: 1;
  links: SavedLink[];
};
```

The A1 migration records remain the public persisted contracts:

```ts
type ResearchLinksProjectionV1 = {
  version: 1;
  catalogRevision: number;
  projectedDigest: string;
  generatedAt: string;
};

type ResearchLinksMigrationJournalV1 = {
  version: 1;
  catalogRevision: number;
  intendedProjectionDigest: string;
  startedAt: string;
};
```

A4 uses additive, parser-compatible fields on those records. The journal adds
`phase`, `mutationTimestamp`, and the complete strictly parsed `desiredLinks`
write-ahead payload. Projection metadata adds strictly validated row
fingerprints. No portable Research schema changes.

## Authority and feature flags

After this unit, the compatibility coordinator is the only in-process owner of
saved-link reads and writes. Existing exports from
`src/lib/server/research-links.ts` retain their signatures, so Chat, Research
tabs, recommendations, mission materialization, and
`/api/research/links` keep their current contracts.

The compatibility coordinator runs regardless of
`NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES`. The flag hides new Resource surfaces; it
does not create a split-brain saved-link store. An older binary may still write
the projected legacy file during downgrade. The next A4-capable process imports
that delta before rewriting the projection.

Generic Resource list/detail routes remain local-only and default-off.

## One serialized transaction

Extend the A3 store with a server-only locked catalog transaction. It holds the
existing cross-process Resource intent lock across:

1. strict legacy and migration-state reads;
2. downgrade delta calculation;
3. compatible manifest creates, replacements, and fenced deletes;
4. catalog revision selection;
5. journal publication;
6. complete legacy projection replacement;
7. exact-byte read-back and digest verification;
8. projection-metadata publication; and
9. journal removal.

The transaction exposes only a catalog snapshot plus reviewed compatibility
mutators. It must not call the public store methods while holding the lock,
because those methods would try to acquire the same lock again.

Both `listManifests` and `readManifest` acquire the same intent lock. Current A3
read-only APIs therefore observe either the state before the transaction or the
state after its verified projection, never a partially mutated catalog.

## Strict legacy input

Migration does not use the current forgiving loader, because that loader may
invent random ids and current timestamps. Add a strict raw-byte parser for the
migration boundary:

- the top-level object contains only `version` and `links`, and a row contains
  only the reviewed `SavedLink` fields;
- `links` is an array of at most `MAX_SAVED_LINKS` rows;
- the complete file is at most 256 MiB;
- ids are 1–128 characters;
- URLs are absolute HTTP(S) and at most 8,192 characters;
- titles are 1–8,192 characters;
- categories are exact current `LinkCategory` values, timestamps are canonical
  UTC instants, and sources are `chat` or `desk`;
- paper blocks contain only reviewed fields, use a valid arXiv id, have at most
  1,024 authors of at most 512 characters each, and an abstract of at most
  1 MiB;
- X Article blocks pass the existing URL identity, author, timestamp, size,
  and body-digest checks;
- duplicate legacy ids and duplicate `savedLinkDedupeKey(url)` identities are
  rejected; and
- the input has a bounded byte size.

Missing `research-links.json` means a canonical empty file. Malformed,
oversized, unsafe, or conflicting input fails closed: preserve its bytes, do
not mutate the catalog, and do not overwrite the file.

## Deterministic manifest mapping

Each legacy row maps to one manifest:

```text
id                saved-link-<first 32 hex of SHA-256(legacy id)>
revision          1 on import
kind              paper when a complete paper block exists; saved-resource otherwise
canonicalIdentity savedLinkDedupeKey(url)
title             exact legacy title
sourceUri         exact legacy URL
sourceType         saved-link
category           exact legacy category
publishedAt        paper.publishedAt when present
legacySavedLink    exact id, URL, addedAt, and source
paper              exact arXiv id, authors, abstract, and publishedAt
subject            {}
sensitivity        public
ingest              { desired: false, state: metadata_only }
createdAt           legacy addedAt
updatedAt           legacy addedAt on import
```

The deterministic id makes an interrupted first import idempotent. A
pre-existing different manifest at that id, canonical identity, or legacy id is
an integrity conflict; migration never silently adopts it.

## X Article preservation

A3 intentionally left X Articles unresolved. A4 stores a strictly validated
and normalized full X Article snapshot in a private additive field beneath
`legacySavedLink`, named `caveXArticleV1`. The A1 parser already preserves
unknown JSON fields, and A3 makes the complete legacy origin block immutable.

Rules:

- import applies the existing X validator's reconstruction rules once, then
  stores that canonical result; noncanonical input is accepted only when it
  normalizes to a valid block whose body digest still matches;
- complete reverse projection restores the exact stored canonical block,
  including body;
- list summaries remove only `body` as they do today;
- detail reads and mission materialization retain the body;
- the generic Resource API continues to allowlist fields and never returns the
  private extension; and
- invalid unknown fields are not interpreted as X Article data.

Changing a legacy row's immutable identity or X Article origin during a
downgrade is represented as a fenced delete followed by a deterministic create,
not an A3 update that bypasses immutability.

## Projection bytes and metadata

The complete projection is serialized exactly as the existing store writes it:

```ts
JSON.stringify({ version: 1, links }, null, 2)
```

There is no terminal newline. SHA-256 covers those exact UTF-8 bytes. The same
serializer produces the intended digest and the final file. Verification reads
the final file bytes back from disk and hashes them without reparsing or
reserializing.

Only live manifests carrying `legacySavedLink` enter the projection. Mapping
and ordering use the landed A3 adapter: `addedAt` descending, then legacy id
ascending; complete paper fields only; category fallback only when absent.
The X extension is restored after the allowlisted A3 mapping. Catalog-only
fields never enter the legacy file.

Projection refuses more than `MAX_SAVED_LINKS`; it never truncates an
authoritative catalog.

Projection metadata adds a `rows` array with at most `MAX_SAVED_LINKS` entries:

```ts
type ProjectedRowFingerprint = {
  id: string;
  canonicalIdentity: string;
  digest: string; // canonical digest of this complete legacy row
};
```

The A4 metadata parser requires this array, sorts it by id, rejects duplicate
ids and duplicate canonical identities, applies the same id/identity bounds as
legacy input, and requires lowercase SHA-256. Each digest is SHA-256 over the
UTF-8 `canonicalJson` encoding of the complete normalized legacy row. Unknown
row-fingerprint fields are rejected.

This is the last verified three-way merge base. It contains no X body or other
row content. `catalogRevision` is a compatibility-catalog epoch, not the
maximum per-manifest revision. It starts at zero and advances exactly once for
each transaction that changes the compatible manifest set or content. It never
decreases and must remain a safe integer.

## First upgrade

Under the shared lock:

1. Strictly parse the legacy file.
2. If no verified projection metadata exists, treat those rows as the initial
   desired compatibility state.
3. Import them deterministically while leaving catalog-only manifests alone.
4. Generate the complete desired projection and choose the next catalog
   revision.
5. Persist a `prepared` migration journal containing that revision, intended
   digest, one durable mutation timestamp, and the complete normalized desired
   links. This write-ahead phase closes the otherwise unrecoverable crash window
   between individual manifest publications.
6. Apply every catalog create/update/fenced delete idempotently.
7. Replace the journal with phase `committed` after the complete catalog
   mutation is verified.
8. Atomically replace `research-links.json` with the complete projection.
9. Read back and verify the exact digest.
10. Write projection metadata with row fingerprints.
11. Remove the journal.

The umbrella's catalog-commit journal remains the `committed` phase. The
additional `prepared` phase is an A4 write-ahead safety extension required by
the existing per-manifest file store. Journal presence blocks every compatible
read in both phases.

An empty first upgrade writes a verified empty projection and revision-0
metadata without advancing the epoch. Repeating it is a zero-write read path.

## Crash recovery

Journal presence is a hard read barrier. Startup repair completes it before
returning any saved-link list or detail. A `prepared` journal replays its full
desired set, including any suffix not published before a crash; a `committed`
journal verifies the catalog and finishes projection.

For homes created before A4, or a failure predating prepared-journal support,
the catalog and last projection may already differ without a journal. A4 also
repairs that state without weakening the public journal contract:

- projection metadata contains the last verified row fingerprints;
- startup generates fingerprints from the current compatible catalog;
- if catalog fingerprints differ while the legacy file still matches the last
  projected digest, the catalog is an unprojected committed mutation and wins;
- if the legacy digest differs while catalog fingerprints equal the base, the
  legacy file contains a downgrade delta and is reconciled first; and
- if both differ, use the fingerprint base for a deterministic three-way merge.

After a journal exists, the catalog state named by that journal is
authoritative. A stale or partially replaced legacy file is regenerated; it is
not re-imported as a downgrade delta.

Failure after every individual manifest publication and every later durable
boundary leaves either the previous verified projection or the prepared
journal's complete desired set. Recovery is idempotent. Corrupt, oversized, or
semantically invalid journal/projection metadata fails closed and does not erase
the last legacy file.

## Downgrade and re-upgrade reconciliation

When the current legacy digest differs from the last projected digest and no
journal exists, compare legacy rows and current catalog rows against the saved
row fingerprints:

- a legacy row absent from the base is a downgrade-era save and is imported;
- a base row absent from legacy is a downgrade-era delete;
- a legacy row whose digest changed is a downgrade-era replacement;
- a catalog row absent from the base is an unprojected current-era save and is
  preserved;
- a base row absent from catalog is an unprojected current-era delete and is
  preserved; and
- disjoint deltas are unioned.

For the same base row changed on both sides, legacy compatibility identity and
presentation fields win only when the catalog row remains A4 metadata-only and
unreferenced. Otherwise reconciliation fails closed for A5 deletion handling;
it never discards snapshots, jobs, or ingested content.

Process removals before additions so “delete old id, save the same canonical
URL under a new id” does not trip uniqueness. Catalog-only manifests are never
deleted or rewritten.

A4 supports sequential downgrade and re-upgrade, not two different Cave binary
versions writing the same home concurrently. An older process does not know the
Resource intent lock, so concurrent old/new writers cannot be made serial
without changing that older binary. Startup and request-time reconciliation
still detect any older write completed before the A4 transaction begins.

Metadata-only presentation updates increment the manifest revision exactly
once. The prepared journal persists one `mutationTimestamp`; the replacement's
`updatedAt` is the later of that instant and exactly one millisecond after the
stored `updatedAt`. Replay first compares desired compatible content and treats
an already-equal manifest as a no-op, so it never increments revision or time a
second time. Immutable origin or X changes use fenced delete/create.

## Narrow compatibility deletion

Add a locked delete operation only for a manifest that:

- carries `legacySavedLink`;
- has no `currentSnapshotId`;
- has `ingest.desired === false` and `ingest.state === "metadata_only"`;
- has no snapshot record referencing its resource id; and
- still matches the transaction's exact expected canonical bytes.

Anything else returns a typed conflict and remains untouched. This is not A5's
general deletion pipeline: it creates no tombstone, cancels no job, removes no
blob, and cannot delete an ingested resource.

## Compatibility API behavior

Keep local-origin rejection before migration or storage access. Then:

- `GET` repairs/reconciles and returns the current summary list;
- `GET ?id=` repairs/reconciles and returns the full saved link;
- `POST` keeps paper and X enrichment, reservation release, caps, dedupe,
  invalid and failed reporting, then commits catalog plus verified projection;
- `DELETE` removes by legacy id through the narrow fenced operation and returns
  the existing 404/200 shapes; and
- any catalog, journal, projection, or verification failure returns the
  existing bounded 500 response without paths or content.

Success is not reported before projection verification completes.

The 10,000-row cap preserves current behavior: successful new saves are
prepended in request order and evict the oldest tail rows. Those evictions are
part of the same prepared desired set and use the narrow fenced delete. If an
eviction candidate is no longer metadata-only/unreferenced, preflight rejects
the whole mutation before the first manifest write; A4 never exceeds the cap or
reports a partial save.

## Filesystem requirements

Create `research-resources/migration/` as a real owner-only directory. Journal
and projection metadata are real regular owner-only files. Reuse A2's
containment, ownership, path-identity, symlink, atomic-write, and read-size
patterns. Refuse symlinks, junction-like replacements, non-regular files,
unsafe modes where enforced, unexpected entries, and path identity changes.

The legacy file is never derived into a filesystem path. URLs remain data and
must be HTTP(S).

## Implementation sequence

1. Refactor strict legacy parsing, deterministic serialization, and X validation
   into a server-only legacy-store seam without changing public exports.
2. Add locked catalog transaction primitives, aggregate compatibility revision,
   and narrowly fenced metadata-only deletion to the Resource store.
3. Add the migration/compatibility coordinator with first import, journal
   recovery, projection verification, row fingerprints, and three-way downgrade
   reconciliation.
4. Route all `research-links.ts` public reads/writes through the coordinator;
   retain API and caller signatures.
5. Add focused strict-input, import, projection, X round-trip, deletion,
   downgrade, crash-injection, and child-process concurrency tests.
6. Extend route tests for repair barriers and unchanged response/security
   contracts.
7. Register each new test exactly once in `scripts/run-tests.mjs`, including
   alias-loader/TS-strip sets when required.

## Verification

- Focused legacy-store and compatibility-coordinator suites.
- Existing Research Links store and route suites.
- Existing A1 contract, A2 store, A3 catalog/read-model/API suites.
- Crash injection after prepared-journal publication, after every individual
  manifest mutation, committed-journal publication, projection rename,
  read-back verification, metadata write, and journal removal.
- Child-process races for first import, save/save, and save/delete.
- `pnpm check:tests-wired`.
- `pnpm typecheck`.
- `pnpm lint`.
- `git diff --check`.
- Full app and API suites, with any untouched-main failure reproduced on the
  exact clean base before it is classified as baseline.

## Rollback

Every successful A4 mutation leaves a complete verified legacy file. Reverting
to an older Cave therefore preserves catalog-era saves and deletes through that
file. Reinstalling A4 compares the file to its last verified fingerprint base,
imports legitimate downgrade changes, and resumes projection. Disabling the
Resource UI flag does not disable compatibility correctness.
