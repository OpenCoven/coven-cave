# Externalized Research Desk Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved externalized Research Desk end to end through independently shippable protocol, local resource, Context Pack, discovery, gateway, executor, and optional hosted-cloud units.

**Architecture:** Preserve the approved protocol-first, local-first design while inserting a local Research Resource layer before Context Pack creation. Authoritative resource manifests and immutable resource snapshots remain separate from operational job state; sealed Context Packs copy selected normalized bytes into their own content-addressed store so resource refresh, deletion, restore, and retention cannot mutate pack evidence. The useful local release ships before any cloud repository, account, Vectorize index, or executor is required.

**Tech Stack:** TypeScript 6, Node.js 24, Next.js 16, React 19, `node:sqlite` with FTS5, RFC 8785 canonical JSON, SHA-256 content addressing, Cave JSON/atomic-file stores, Cloudflare Workers/D1/R2/Queues/Workflows/Durable Objects/Vectorize/Workers AI behind a separate decision gate.

**Approved design:** `docs/superpowers/specs/2026-08-15-externalized-research-desk-implementation-design.md`

**First executable plan:** `docs/superpowers/plans/2026-08-15-research-protocol-unit-0.md`

---

## 1. Program boundary

This is an umbrella program, not one implementation branch. Every delivery unit
gets its own Bead, managed worktree, detailed writing-plans document, protected
pull request, focused validation, and merge evidence.

The program has three release boundaries:

1. **Local resource release:** saved resources become durable, versioned,
   ingestible, searchable, backup-safe, and compatible with older Cave builds.
2. **Local discovery release:** sealed Context Packs and grounded topic
   discovery create editable mission drafts without cloud dependencies.
3. **Hosted beta:** Research Cloud public retrieval and Cave Device Executor
   work begin only after an explicit repository/account/operations decision.

Cloud unavailability, a missing local embedding endpoint, or an offline Cave
must never disable lexical local resource search, Context Pack reads, or
existing local Research Missions.

## 2. Non-negotiable trust boundaries

1. Resource text, filenames, metadata, model output, and fetched pages are
   untrusted data and never grant tools or authority.
2. Resource manifests are authoritative user state. Ingest jobs, failure
   records, FTS rows, and embeddings are operational or derivative state.
3. A sealed Context Pack owns immutable selected bytes. It never relies on a
   mutable resource snapshot remaining present.
4. Private content, private embeddings, provider credentials, full prompts,
   local paths, and raw sessions remain local by default.
5. Every displayed evidence excerpt resolves to an exact selector over bytes
   whose digest is verified at read time.
6. Cancellation does not imply deletion. Retention, deletion, artifact
   registration, and artifact-content synchronization remain distinct.
7. Tenant identity comes from authentication and is re-applied at every D1,
   R2, Vectorize, coordinator, event, and artifact boundary.
8. Waiting is not running. Missing executor or quota produces a typed waiting
   state with no false progress.

## 3. Local storage ownership

### 3.1 Resource catalog

Authoritative and operational resource data lives under:

```text
<caveHome>/research-resources/
  manifests/<resource-id>.json
  snapshots/<snapshot-id>.json
  blobs/sha256/<first-two-hex>/<digest>
  jobs/<job-id>.json
  failures/<job-id>.json
  tombstones/<resource-id>.json
  migration/research-links-projection.json
  migration/research-links-journal.json
  index/research-resources.sqlite
```

Ownership:

- `manifests/`, `snapshots/`, `blobs/`, `tombstones/`, and migration projection
  metadata are authoritative and included in Cave backup archives.
- `jobs/` is durable operational intent but excluded from backups. The manifest
  stores enough ingest intent to recreate a queued job after restore.
- `failures/` contains bounded diagnostic records and is excluded from backups.
  The manifest retains only a typed last-failure code and retryability.
- `index/research-resources.sqlite`, `-wal`, and `-shm` are derivative and
  excluded from backups. Restore and corruption recovery rebuild them.

All directories are mode 0700; files are mode 0600. Stores refuse symlinked
roots and entries, verify containment after `realpath`, write through
temp-file-plus-atomic-rename, and verify every content digest on read.

### 3.2 Context Pack store

Sealed pack data remains physically separate:

```text
<caveHome>/research-context-packs/
  manifests/<pack-id>.json
  blobs/sha256/<first-two-hex>/<digest>
  redactions/<redaction-map-digest>.json
  topic-jobs/<job-id>.json
  topic-proposals/<proposal-id>.json
```

Do not share the resource CAS with the pack CAS. Sharing would couple resource
refresh/deletion, pack retention, backup repair, and corruption domains.
Copying selected normalized bytes costs disk space but guarantees that a sealed
pack remains readable after its source resource is refreshed or deleted.

Pack deletion garbage-collects only pack-owned blobs. Resource deletion
garbage-collects only resource-owned blobs.

### 3.3 Authoritative resource contracts

Local resource contracts are Cave-owned and are not added to the portable
Research Run Protocol:

```ts
type ResourceManifestV1 = {
  version: 1;
  id: string;
  revision: number;
  kind:
    | "saved-resource"
    | "paper"
    | "attachment"
    | "mission-artifact"
    | "session"
    | "thread-self-report"
    | "local-file";
  canonicalIdentity: string;
  title: string;
  sourceUri?: string;
  sourceType: string;
  category?: "github" | "docs" | "paper" | "video" | "social" | "article" | "other";
  publishedAt?: string;
  legacySavedLink?: {
    id: string;
    url: string;
    addedAt: string;
    source: "chat" | "desk";
  };
  paper?: {
    arxivId: string;
    authors: string[];
    abstract?: string;
    publishedAt?: string;
  };
  subject: {
    familiarId?: string;
    projectId?: string;
  };
  sensitivity: "public" | "private" | "restricted";
  ingest: {
    desired: boolean;
    state:
      | "metadata_only"
      | "queued"
      | "ingesting"
      | "ready"
      | "partial"
      | "failed"
      | "deleting";
    lastFailureCode?: string;
    retryable?: boolean;
  };
  currentSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
};

type ResourceSnapshotV1 = {
  version: 1;
  id: string;
  resourceId: string;
  resourceRevision: number;
  rawBlobDigest?: string;
  normalizedBlobDigest: string;
  normalizedMediaType: string;
  normalizedBytes: number;
  sourceSelector: ContextSelectorV1;
  pageBoundaries?: Array<{
    page: number;
    start: number;
    end: number;
  }>;
  fetchedAt?: string;
  finalUrl?: string;
  etag?: string;
  lastModified?: string;
  createdAt: string;
};
```

`legacySavedLink`, `category`, `paper`, and `publishedAt` preserve landed
Research Resources behavior, including `cave-cbz28`. They are local migration
fields, not portable protocol fields.

### 3.4 Selector coordinate contract

Define selector coordinates before Protocol Unit 0 writes schemas:

- `turn-range`: zero-based turn indexes, `start` inclusive, `end` exclusive,
  and `start < end`.
- `json-pointer`: RFC 6901 pointer evaluated against the exact normalized JSON
  blob.
- `text-span`: zero-based UTF-8 byte offsets over the exact normalized blob,
  `start` inclusive, `end` exclusive, and `start < end`.
- `markdown-section`: non-empty heading path evaluated against the exact
  normalized Markdown blob.
- `pdf-page-span`: one-based page number plus zero-based UTF-8 byte offsets
  within that page's normalized text, `start` inclusive, `end` exclusive, and
  `start < end`.
- `whole-resource`: the complete exact normalized blob.

PDF normalization persists a page-boundary table mapping each one-based page to
its half-open range in the whole normalized blob. Rebuilds must reproduce the
same normalized bytes and boundaries for the same extractor version.

`ResourceSnapshotV1.sourceSelector` resolves against the immutable catalog
snapshot. When a user selects a subset for a Context Pack, Cave copies the
selected normalized bytes into a new pack-owned blob and writes the portable
pack resource selector as `whole-resource`. The local pack build receipt keeps
the original resource id, snapshot id, and `sourceSelector` for audit, but those
local fields do not enter `ContextPackV1`.

Topic Proposal evidence always points to the pack-owned selector. It never
requires a catalog snapshot to remain present.

## 4. Operational job state

### 4.1 Main ingest job

```ts
type ResourceIngestJobV1 = {
  version: 1;
  id: string;
  resourceId: string;
  resourceRevision: number;
  deletionRevision: number;
  status:
    | "queued"
    | "claimed"
    | "paused_quota"
    | "retry_wait"
    | "completed"
    | "failed"
    | "cancelled";
  stage: "fetch" | "snapshot" | "extract" | "publish_lexical";
  attempt: number;
  availableAt: string;
  lease?: {
    owner: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
};
```

`paused_quota` is resumable and does not consume a retry attempt. A claimed job
may publish only when its resource manifest still exists, its resource revision
matches, and its deletion revision equals the current tombstone/fence revision.

### 4.2 Semantic task

Embedding is a separate best-effort task, not a required main ingest stage:

```ts
type ResourceEmbeddingTaskV1 = {
  version: 1;
  resourceId: string;
  snapshotId: string;
  lexicalRevision: number;
  providerId: string;
  modelId: string;
  dimensions: number;
  status: "queued" | "building" | "ready" | "failed" | "unavailable";
  updatedAt: string;
};
```

Lexical publication makes a resource searchable. Missing, rebuilding, stale,
or failed embeddings never hide lexical results.

### 4.3 Crash recovery

Startup reconciliation:

1. Expires abandoned leases.
2. Requeues `claimed` jobs whose manifest and revisions remain current.
3. Recreates jobs for manifests with `ingest.desired: true` and no usable
   snapshot or active job.
4. Leaves non-retryable failures visible instead of silently requeueing.
5. Rebuilds derivative lexical/vector rows from verified snapshots.
6. Completes interrupted deletion before accepting new jobs for that id.

## 5. Deletion fencing and tombstones

Deletion is ordered:

1. Acquire the resource lock.
2. Increment and persist the deletion revision.
3. Mark the manifest `deleting`.
4. Cancel or fence all main and semantic jobs.
5. Persist a minimal tombstone containing resource id, deletion revision,
   deleted timestamp, and no title, URL, excerpt, or local path.
6. Remove derivative lexical and semantic rows.
7. Remove snapshot records.
8. Garbage-collect unreferenced resource blobs.
9. Remove the resource manifest last.
10. Regenerate the legacy saved-link projection.

Every publication step checks the tombstone/deletion revision immediately
before commit. Startup repair resumes any interrupted deletion and never
recreates a manifest from stale job output.

Tombstones are authoritative, included in backup archives, and retained until a
future explicit compaction design proves no supported archive or job can
resurrect the deleted revision.

## 6. Saved-link compatibility and downgrade safety

`research-links.json` remains a complete reverse projection during migration:

1. On first upgrade, lock and import every valid legacy row into the catalog.
2. Preserve legacy id, URL, category, title, paper metadata, `addedAt`, and
   `source`.
3. Commit the catalog mutation.
4. Write a migration journal naming the catalog revision and intended
   projection digest.
5. Regenerate the complete `research-links.json` from live compatible catalog
   rows.
6. Read the projection back and verify its digest before clearing the journal.
7. On startup, finish any journaled projection before serving reads.
8. Before regeneration after a downgrade/re-upgrade, compare the legacy file
   digest with the last projected digest. If it changed, import legitimate
   downgrade-era saves/deletes first instead of overwriting them.

The compatibility API remains until all current writers and readers migrate.
Older Cave builds see post-cutover saves/deletes through the projected file.
Rollback disables new resource features but does not lose catalog-era link
changes.

## 7. Local retrieval

Use a dedicated derivative database rather than coupling correctness to global
search:

```text
resources
snapshots
chunks
chunks_fts
provider_state
embedding_state
chunk_embeddings
```

The request path:

1. Validate a versioned Research retrieval query.
2. Apply project, familiar, kind, sensitivity, status, date, and pack filters
   before ranking.
3. Produce exact-identity/title candidates.
4. Query FTS5 for lexical candidates.
5. Query compatible local embeddings when available.
6. Fuse ranks deterministically, dedupe by resource/snapshot, and apply MMR.
7. Re-resolve each result through the authoritative snapshot and verify the
   blob digest before returning an excerpt.

The first embedding adapter supports an explicitly configured loopback
OpenAI-compatible/Ollama endpoint. It validates loopback origin, model id,
dimensions, count, and response bounds. No local content is sent to a remote
embedding service by this adapter.

## 8. Backup and restore

Backup archive v1 remains readable and writable. Add the authoritative Research
directories to `src/lib/server/backup-manifest.ts` without changing the archive
envelope version.

Restore order:

1. Validate every archive path and digest using existing archive-v1 rules.
2. Restore authoritative files atomically.
3. Reconcile tombstones and finish saved-link projection journals.
4. Recreate missing ingest jobs from manifest intent.
5. Rebuild derivative indexes.
6. When Context Pack Unit 1 exists, validate every pack manifest against its
   pack-owned blobs before exposing it.

Resource backup support lands before Context Pack Unit 1. Pack manifests,
pack-owned blobs, and redaction maps join backup only with Unit 1, so no plan
references directories that do not exist yet.

## 9. Feature-flag authority

`src/lib/feature-flags.ts` is the single feature-flag authority. Add:

```ts
export function caveResearchResources(): boolean;
export function caveResearchLocalIngestion(): boolean;
export function caveResearchSemantic(): boolean;
export function caveResearchContextPacks(): boolean;
export function caveResearchTopicDiscovery(): boolean;
export function caveResearchHostedRuns(): boolean;
```

Flags default off. Read and write migrations remain compatible while a flag is
off. `caveResearchSemantic` controls only semantic work and UI; lexical search
remains available. Hosted flags cannot enable without configured cloud account,
repository, bindings, and auth policy.

## 10. Cloud visibility and revision contract

Cloud work is optional and begins only after Gate C0 in §12.

For each cloud snapshot:

```ts
type CloudIndexPublicationV1 = {
  tenantId: string;
  resourceId: string;
  snapshotId: string;
  buildRevision: number;
  lexicalState: "pending" | "ready" | "failed";
  semanticState: "pending" | "ready" | "failed" | "disabled";
  visibleRevision: number | null;
  vectorRevision: number | null;
};
```

Rules:

- The D1 transaction that writes chunks and FTS rows sets
  `lexicalState: "ready"` and advances `visibleRevision`.
- `visibleRevision` is the only revision eligible for cloud lexical reads.
- Vectorize lag or failure never hides lexically ready content.
- Semantic candidates are eligible only when `semanticState: "ready"` and
  `vectorRevision === visibleRevision`.
- Stale vectors are ignored and may not resolve passages.
- Vectorize stores a tenant-scoped D1 chunk id and bounded filter metadata, not
  raw content or an externally usable R2 key.
- Passage resolution rechecks tenant and revision through D1 before reading R2.

## 11. Delivery graph

### Approved portable protocol

**A0 / Approved Unit 0 — Research Protocol v1**

- Schemas, parsers, canonical digests, fixtures, and conformance.
- Includes final selector coordinate semantics and `pdf-page-span`.
- Detailed plan:
  `docs/superpowers/plans/2026-08-15-research-protocol-unit-0.md`.

### Local resource release

**A1 — Local resource contracts and feature flags**

- Cave-only manifest, snapshot, job, embedding-task, tombstone, migration, and
  query contracts.
- Depends on A0 selector types but does not alter portable schemas.

**A2 — Resource snapshot and blob store**

- Separate resource CAS, immutable snapshot records, digest verification,
  normalization receipts, and deletion reference accounting.
- Depends on A1.

**A3 — Resource catalog and compatibility fields**

- Authoritative manifests, revision locks, paper/date/category/legacy fields,
  list/detail APIs, and existing Resources read model.
- Depends on A1 and A2.

**A4 — Saved-link migration and reverse projection**

- First-run import, crash journal, complete reverse projection, downgrade-era
  reconciliation, and compatibility API.
- Depends on A3.

**A5 — Durable local ingestion**

- Public URL fetch, extraction adapters, main jobs, quota pause, retries,
  lexical publication, deletion fencing, and startup repair.
- Depends on A2, A3, and A4.

**A6 — Optional local semantic retrieval**

- Loopback embedding provider, embedding tasks, vector persistence, compatible
  model revisions, and truthful unavailability.
- Depends on A5. Nothing else requires A6.

**A7 — Local Research retrieval and Resources UX**

- Versioned search API, exact/FTS/hybrid ranking, evidence preview, ingest
  status, retry/delete, and later global-search compatibility provider.
- Depends on A5 and may consume A6 when available.

**A8 — Resource backup, restore, deletion repair, and rollout**

- Archive-v1 compatibility, authoritative inclusion/derivative exclusion,
  restore reconciliation, tombstone repair, feature flags, and migration
  rollback.
- Depends on A4 and A5. A6 is optional.

### Approved local discovery

**Unit 1 — Local Context Packs**

- Depends on A0, A5, A7, and A8.
- Adds pack CAS backup/restore with the pack store itself.
- A6 remains optional.

**Unit 2 — Local Topic Discovery**

- Depends on Unit 1.
- Does not perform web search or writes and cannot create missions.

**Unit 3 — Mission v2 and Research Run Gateway**

- Depends on A0 and Unit 2.
- Lands the dual v1/v2 parser before v2 writes.

### Hosted path

**Gate C0 — Cloud repository/account decision**

- Depends on A7 and Unit 3.

Required written decisions:

- hosted repository and ownership;
- Cloudflare account/environment;
- authentication and tenant authority;
- D1/R2/Queue/Workflow/Durable Object/Vectorize/Workers AI bindings;
- budgets, quotas, retention, alerting, and operator responsibility;
- staging and deletion-test tenants.

No cloud resource is provisioned and no hosted endpoint is enabled before C0.

**Unit 4 — Cave Device Executor**

- Depends on Unit 3 and C0.
- Uses the Unit 3 fake hosted adapter until Unit 5 staging is available.

**Unit 5 — Hosted Research Cloud**

- Depends on A0, A7, Unit 3, Unit 4, and C0.
- D1 FTS5 lexical retrieval is independently useful.
- Workers AI/Vectorize semantic retrieval is optional and revision-gated.

## 12. Beads and pull-request structure

Create one parent program Bead and one child Bead per A0-A8, Unit 1-5, and Gate
C0. Dependencies must mirror §11 exactly. Each child records:

- detailed plan path;
- branch/worktree owner;
- exact implementation boundary;
- focused and full validation evidence;
- PR and merge reference;
- rollback/flag state;
- next newly-ready child.

Never mark multiple unrelated children `in_progress`. A child is
`in_progress` only while actively worked.

## 13. Program acceptance

- [ ] Protocol schemas and TypeScript parsers pass the same valid/invalid
      fixtures across supported runtimes.
- [ ] Saved links, paper metadata, dates, categories, ids, and origins survive
      migration, downgrade, re-upgrade, backup, and restore.
- [ ] Resource refresh or deletion cannot mutate or break a sealed Context Pack.
- [ ] Every evidence excerpt resolves to verified immutable bytes with exact
      selector coordinates.
- [ ] Job replay, quota pause, crash recovery, deletion fencing, and tombstone
      repair do not duplicate or resurrect resources.
- [ ] FTS-only local operation is complete and truthful without embeddings.
- [ ] Context Pack and Topic Discovery releases require no cloud resource.
- [ ] Existing v1 Research Missions remain readable and executable.
- [ ] Hosted runs never accept provider credentials or private pack blobs by
      default.
- [ ] Cloud lexical results remain available during Vectorize lag or failure.
- [ ] Cross-tenant tests produce zero unauthorized reads or writes.
- [ ] Cancellation, retention, deletion, and artifact sync remain independent.
- [ ] Backup archive v1 restores authoritative Research state and rebuilds
      derivative state.
- [ ] Relevance, selector-resolution, latency, recovery, and end-to-end
      evaluation evidence is recorded before each feature flag is promoted.

## 14. Immediate execution sequence

- [ ] Land this umbrella plan, the amended approved design, and the corrected
      Protocol Unit 0 plan through a docs-only PR.
- [ ] Create the program/child Beads and dependency edges from §11.
- [ ] Execute A0 in a fresh managed worktree from current `origin/main`.
- [ ] Review A0 against this program and the approved design before merge.
- [ ] Update `.copilot/goals.md` after merge with progress and the next ready
      child.
