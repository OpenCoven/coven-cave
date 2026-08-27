# Research Resource Catalog and Compatibility Implementation Plan

**Goal:** Add the Cave-owned authoritative Research Resource manifest catalog,
serialize revisioned mutations across processes, expose flag-gated local
list/detail reads, and preserve the landed Resources paper/date/category/
saved-link read shape without starting migration, ingestion, or a new UI.

**Source:**
`docs/superpowers/plans/2026-08-16-externalized-research-desk-program.md`
§§2, 3.1, 3.3, 5, 6, 9, 11 A3, and 13; the approved amendment in
`docs/superpowers/specs/2026-08-15-externalized-research-desk-implementation-design.md`;
the A1 contracts in `src/lib/research-resource-contracts.ts`; the A2 verified
snapshot store in `src/lib/server/research-resource-store.ts`; and the landed
paper Resources behavior from `cave-cbz28`.

**Boundary:** A3 owns mutable authoritative manifest persistence, catalog
identity/revision invariants, snapshot-pointer verification at manifest
publication, GET list/detail APIs, and a pure adapter to the existing saved-link
Resources read model. It does not import or rewrite `research-links.json`, add
a compatibility writer, fetch or normalize content, create ingest jobs, delete
resources, build indexes or embeddings, add backup support, switch the live
Resources hook, or change the portable Research Run Protocol. Those remain A4
and later work.

## Storage layout and authority

A3 adds only the manifest portion of the approved resource root:

```text
<caveHome>/research-resources/
  manifests/<resource-id>.json
  snapshots/<snapshot-id>.json       # A2-owned
  blobs/sha256/<first-two>/<digest>  # A2-owned
  locks/intents/<intent-id>.lock     # shared resource-store mutation fence
```

`manifests/` is authoritative user state. Each visible file is one complete
canonical `ResourceManifestV1`; there is no aggregate catalog file whose
partial rewrite could lose unrelated resources. Production derives the root
from `caveHome()`. Tests inject an absolute root through the catalog factory;
A3 adds no production environment override.

Directories are owner-only (`0700`) and files are owner-only (`0600`). Reads
and mutations reject symlink/junction entries, non-regular files, unexpected
hard links, foreign ownership, broader POSIX modes, containment failures, and
path identity changes. A malformed or unsafe visible manifest is corruption,
not an absent row. Temporary files are unique, exclusive, owner-only,
file-synced, and atomically published; the containing directory is synced where
supported. Create is no-clobber. Update uses a replacement rename only after
the revision check succeeds under the catalog lock because manifests are
intentionally mutable.

Catalog scans are bounded to 100,000 manifest records and individual manifest
JSON to 1 MiB. Unexpected non-temporary entries fail the scan closed. Temporary
residue is ignored only when it matches the catalog's own unambiguous
temporary-name grammar; A3 does not recursively sweep or repair it.

## Catalog API

Add `src/lib/server/research-resource-catalog.ts` with these server-only seams:

```ts
type CreateResourceManifestResult = {
  created: boolean;
  manifest: ResourceManifestV1;
};

type UpdateResourceManifestInput = {
  id: string;
  expectedRevision: number;
  manifest: ResourceManifestV1;
};

type ResearchResourceCatalog = {
  createManifest(
    manifest: ResourceManifestV1,
  ): Promise<CreateResourceManifestResult>;

  getManifest(id: string): Promise<ResourceManifestV1 | null>;

  listManifests(): Promise<ResourceManifestV1[]>;

  updateManifest(
    input: UpdateResourceManifestInput,
  ): Promise<ResourceManifestV1>;
};

createResearchResourceCatalog(options?: {
  root?: string;
}): ResearchResourceCatalog;
```

The catalog is a narrow facade over the A2 `ResearchResourceStore`; the store
owns the shared hardened layout, intent lock, stable-handle reads, and verified
snapshot seam. This avoids duplicating security-sensitive filesystem helpers
or introducing a second writer for the same root.

All inputs and outputs pass through `parseResourceManifestV1`; returned values
are detached from caller-owned or parsed objects. The module exports typed
catalog errors (`missing`, `immutable-conflict`, `revision-conflict`,
`identity-conflict`, `invalid-manifest`, `snapshot-conflict`, `unsafe-path`,
`corrupt`, and `too-large`) but no raw path, unchecked file handle, recursive
delete, or direct manifest overwrite helper.

`listManifests()` parses the complete visible catalog before returning anything
and sorts deterministically by `updatedAt` descending, then `id` ascending.
`getManifest()` returns `null` only for an absent safe id. An existing
unreadable, malformed, misnamed, or unsafe entry throws a typed integrity error
rather than looking missing.

## Identity and revision decisions

Resource ids use the A2 path-segment grammar: ASCII alphanumeric first, at most
128 characters total, then ASCII alphanumeric, `_`, or `-`; Windows device
names are refused case-insensitively. A manifest's parsed `id` must exactly
match its filename.

`canonicalIdentity` is an opaque Cave-owned identity, not a URL parser seam.
The catalog requires a non-empty trimmed value and compares it by exact
case-sensitive string equality. It performs no URL normalization, case folding,
redirect interpretation, or Unicode rewriting. Producers own canonicalization;
A4 will derive saved-link identities with the existing `savedLinkDedupeKey`
rule. Exactly one live manifest may own a canonical identity.

For manifests carrying `legacySavedLink`, the legacy id is also unique across
the live catalog. The catalog does not use the legacy URL as a second dedupe
algorithm; the manifest's canonical identity is authoritative.

Creation rules:

- a new manifest starts at `revision: 1`;
- replaying the exact same canonical revision-1 manifest is idempotent and
  returns `created: false`;
- the same id with different bytes is an immutable create conflict;
- a different id with the same canonical identity is an identity conflict; and
- a different id with the same `legacySavedLink.id` is an identity conflict.

Update rules:

- the caller supplies the exact `expectedRevision` and a complete next
  manifest;
- the stored revision must equal `expectedRevision`;
- the next revision must equal `expectedRevision + 1` and remain a safe
  integer;
- `id`, `canonicalIdentity`, `createdAt`, and the complete `legacySavedLink`
  origin block are immutable;
- `updatedAt` must be strictly later than the stored timestamp;
- title, source metadata, category, published date, paper metadata, subject,
  sensitivity, ingest state, failure summary, and current snapshot pointer may
  change only through that revisioned replacement; and
- a stale writer changes nothing and receives `revision-conflict`.

Every create/update that could conflict on id, canonical identity, legacy id,
or revision acquires the one cross-process resource intent lock and completes a
fail-closed catalog scan before publication. This deliberately favors
correctness over per-id parallelism: create and identity-preserving update need
one complete uniqueness view, and later A4 projection must observe one serial
catalog order.

## Snapshot pointer verification

A manifest is not allowed to claim a snapshot by filename alone. Before
publishing any manifest with `currentSnapshotId`, the shared resource store uses
the A2 verified-read seam and therefore receives only a parsed snapshot whose
normalized/raw blobs, byte length, and digests were verified.

The snapshot must satisfy all of:

```text
snapshot.id               === manifest.currentSnapshotId
snapshot.resourceId       === manifest.id
snapshot.resourceRevision === manifest.revision
```

A missing, corrupt, unsafe, digest-mismatched, or differently bound snapshot
rejects the manifest mutation as `snapshot-conflict`. `ingest.state ===
"ready"` continues to require `currentSnapshotId` through the A1 parser. Any
revision-changing update that does not publish a same-revision snapshot must
clear `currentSnapshotId` and move ingest out of `ready`; an older snapshot may
remain in the A2 store but cannot be advertised as current for the new revision.

Publication order is consequently snapshot first, manifest last. A crash can
leave an unreferenced immutable snapshot, which is recoverable residue; it
cannot leave a visible ready manifest pointing to bytes that never passed A2
verification.

The shared `deleteSnapshot()` primitive scans the authoritative manifest
catalog under the same mutation lock and refuses to delete any snapshot named
by a live `currentSnapshotId`. A later resource-deletion flow must first publish
a manifest revision that clears the pointer and leaves `ready`, then remove the
unreferenced immutable snapshot.

List/detail manifest reads do not reread up to 512 MiB of blobs merely to
display metadata. They prove the manifest record, not continuous blob health.
Every later evidence/content read must still go through A2 `readSnapshot()` and
reverify exact bytes. A3 must not claim that a list response proves current blob
health after publication.

## Compatibility read model

Add `src/lib/research-resource-read-model.ts` as a pure, client-safe adapter. It
contains no filesystem or fetch access.

```ts
resourceManifestToSavedLinkSummary(
  manifest: ResourceManifestV1,
): SavedLinkSummary | null;

resourceManifestsToSavedLinkSummaries(
  manifests: readonly ResourceManifestV1[],
): SavedLinkSummary[];
```

Only a manifest with `legacySavedLink` enters this compatibility projection.
Mapping is exact:

| Existing `SavedLinkSummary` field | Manifest source |
| --- | --- |
| `id` | `legacySavedLink.id` |
| `url` | `legacySavedLink.url` |
| `title` | `manifest.title` |
| `category` | `manifest.category`, or existing pure `categorizeLink(url)` when absent |
| `addedAt` | `legacySavedLink.addedAt` |
| `source` | `legacySavedLink.source` |
| `paper.arxivId` | `manifest.paper.arxivId` |
| `paper.authors` | detached `manifest.paper.authors` |
| `paper.abstract` | `manifest.paper.abstract` |
| `paper.publishedAt` | `manifest.paper.publishedAt ?? manifest.publishedAt` |

The existing saved-link `paper` block requires both `abstract` and
`publishedAt`. The adapter emits `paper` only when the approved manifest
contains all fields needed by that existing type. It never invents an abstract
or date and never substitutes the manifest creation/update time. A partial
approved paper block remains available through the generic resource API but
does not masquerade as a complete legacy paper reader record.

Projected saved links sort by `addedAt` descending, then legacy id ascending,
preserving the existing Resources ordering independently of generic catalog
order. Adapter outputs are detached.

A3 does not change `use-research-links.ts`, `research-tab-resources.tsx`,
`/api/research/links`, chat `/save`, or any writer. Switching reads before A4
imports every legacy row and provides reverse projection would make existing
resources disappear or split reads from writes. The adapter is the tested
handoff A4 will use once migration and the compatibility writer exist.

## X Article boundary

The current `SavedLinkSummary` may contain a typed `xArticle` summary and the
legacy store may contain an X Article body. The approved `ResourceManifestV1`
has no typed `xArticle` field. A3 therefore:

- does not add an undocumented X Article field to the manifest contract;
- does not interpret an unknown additive field as trusted X Article metadata;
- does not return an X Article body or summary from the compatibility adapter;
- does not modify or migrate the existing legacy file; and
- preserves the A1 parser's general safe unknown-field round-trip behavior
  without claiming that this is an approved X Article schema.

A4 must explicitly decide how legacy X Article metadata/body is preserved
across import, reverse projection, downgrade, and re-upgrade before migrating
those rows. That decision cannot be smuggled into A3 as an incidental type
assertion. Because A3 performs no migration or legacy rewrite, current X
Article behavior remains unchanged and no data is lost in this unit.

## Local list and detail APIs

Add two local, read-only routes:

```text
GET /api/research/resources
GET /api/research/resources/[id]
```

Responses are:

```ts
{ ok: true, resources: ResourceManifestV1[] }
{ ok: true, resource: ResourceManifestV1 }
```

The list is the catalog's deterministic order. Detail returns `404` only for a
missing safe id. The routes use the Node runtime, `force-dynamic`, dependency-
injected handler factories, and `rejectNonLocalRequest`. Callers use ordinary
`no-store` fetch semantics. The routes return no blob bytes, normalized text,
raw content, filesystem path, storage root, or unchecked snapshot metadata.

`caveResearchResources()` remains the only rollout authority. When it is false,
both routes return a stable `404` disabled response and do not initialize or
scan the catalog. Local-request rejection runs before feature evaluation.
Catalog corruption maps to a bounded `500` message with no path or raw parser
error. Unsafe ids map to `400`; missing safe ids map to `404`; successful
responses are `200`.

A3 exposes no POST, PUT, PATCH, or DELETE HTTP route. Catalog writers are
server-only seams for A4/A5; a browser cannot manufacture authoritative
manifests or bypass revision checks.

## Focused test matrix

Add catalog tests covering:

- revision-1 create, get, complete list, canonical JSON, owner-only modes,
  deterministic ordering, and detached outputs;
- byte-identical idempotent create versus changed same-id conflict;
- duplicate canonical identity and duplicate legacy saved-link id across
  different resources;
- stale expected revision, skipped revision, changed id/identity/createdAt/
  legacy origin, non-monotonic updatedAt, and safe-integer overflow;
- two concurrent writers at one revision producing exactly one winner and no
  lost update;
- concurrent creates with the same canonical identity producing exactly one
  winner;
- a present verified snapshot with matching id/resource/revision, plus missing,
  corrupt, digest-mismatched, wrong-resource, and wrong-revision rejection;
- revision change requiring a same-revision current snapshot or a cleared
  pointer/non-ready state;
- traversal, slash, backslash, Unicode, overlong, untrimmed, and Windows-device
  resource ids rejected before path construction;
- symlinked root/manifests directory/final manifest, hard-linked manifest,
  foreign ownership, broader POSIX mode, and parent identity changes refused;
- malformed JSON, parser-invalid manifest, filename/id mismatch, unexpected
  entry, and malformed sibling making complete list/uniqueness scans fail
  closed;
- record and catalog scan bounds; and
- no raw path or unchecked read/write primitive exported.

Add read-model tests covering:

- exact id/url/title/category/addedAt/source mapping;
- absent category using the existing pure categorizer;
- complete paper metadata preserving authors, abstract, and paper/top-level
  publication date precedence;
- incomplete paper metadata omitted rather than fabricated;
- non-legacy manifests excluded from the saved-link projection;
- X Article unknown fields not interpreted or returned;
- deterministic legacy ordering and detached arrays/objects; and
- no blob, local path, snapshot bytes, prompt, or credential field entering the
  legacy view.

Add route tests covering:

- default-off behavior without store initialization;
- non-local rejection;
- successful list and detail responses;
- safe missing id, unsafe id, and typed catalog corruption mappings;
- dependency injection rather than real Cave-home state; and
- GET-only exports with no mutation route.

The full A3 verification also reruns A1 contract tests and A2 snapshot-store
tests so catalog integration cannot weaken the underlying parser or verified-
read boundary.

## Implementation sequence and expected files

1. Author this detailed A3 plan.
2. Add the hardened catalog with complete scans, global cross-process mutation
   locking, exact identity uniqueness, optimistic revision checks, canonical
   atomic persistence, and verified A2 snapshot binding.
3. Add the pure legacy saved-link read-model adapter with the approved paper/
   date/category/legacy mapping and explicit X Article boundary.
4. Add flag-gated local GET list/detail handlers.
5. Add focused adversarial catalog, adapter, and route tests; register every new
   test with the app test runner.

Expected paths are:

```text
docs/superpowers/plans/2026-08-27-research-resource-catalog-and-compatibility.md
src/lib/server/research-resource-catalog.ts
src/lib/server/research-resource-catalog.test.ts
src/lib/server/research-resource-store.ts
src/lib/research-resource-read-model.ts
src/lib/research-resource-read-model.test.ts
src/app/api/research/resources/route.ts
src/app/api/research/resources/route.test.ts
src/app/api/research/resources/[id]/route.ts
src/app/api/research/resources/[id]/route.test.ts
src/app/api/api-contracts.test.ts
scripts/run-tests.mjs
```

`src/lib/research-resource-contracts.ts` and its tests change only if
implementation proves a missing approved invariant that cannot be enforced at
the catalog boundary; such a change must be called out separately in the diff.
No file under `schemas/research/v1/` or `src/lib/research-protocol/` belongs in
A3.

## Verification

Run focused tests first:

```bash
node --experimental-strip-types src/lib/server/research-resource-catalog.test.ts
node --experimental-strip-types src/lib/research-resource-read-model.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  src/app/api/research/resources/route.test.ts
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  'src/app/api/research/resources/[id]/route.test.ts'
node --experimental-strip-types src/lib/server/research-resource-store.test.ts
node --experimental-strip-types src/lib/research-resource-contracts.test.ts
```

Then run:

```bash
pnpm test:app
pnpm test:api
pnpm test:conformance
pnpm typecheck
pnpm lint
pnpm check:tests-wired
git diff --check
```

Review must confirm that every mutation is globally serialized and revision-
checked; uniqueness is proven from a complete fail-closed catalog; current
snapshots were verified through A2 before manifest publication; list/detail
routes return metadata only and stay default-off/local-only; the legacy adapter
preserves approved fields without inventing paper or X Article data; and no A4
migration/projection, A5 ingest, A7 retrieval/UI, A8 backup, portable protocol,
or cloud work entered the diff.

## Rollback

`NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES` remains default-off, and A3 does not
switch an existing reader or writer. Before A4 migration, reverting A3 removes
APIs and catalog code while leaving any test or manually created
`research-resources/manifests/` data opaque and untouched. After any manifest
writer is enabled, rollback may disable APIs and new writes but must preserve
the entire `research-resources/` tree; an older build may ignore it but must not
delete, rewrite, or project it. Snapshot and Context Pack CAS roots remain
separate under every rollback.
