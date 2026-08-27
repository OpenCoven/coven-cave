# Research durable local ingestion plan

**Bead:** `cave-6sles.6`
**Program unit:** A5 — Durable local ingestion
**Depends on:** A2 merged in PR #5063, A3 merged in PR #5064, and A4
merged in PR #5065
**Scope:** Cave-local fetch, normalization, main-job, lexical-index, deletion,
and startup-repair state. This unit does not add semantic retrieval, query UI,
backup/restore integration, Context Packs, cloud execution, or portable protocol
fields.

## Goal

Turn an approved local Resource manifest into verified immutable bytes and an
independently useful lexical index without allowing retries, crashes, process
races, refreshes, or deletion to publish stale content. A completed deletion
must remain deleted even when an old worker resumes, and every interrupted
durable transition must converge on restart.

## Authority and rollout

`caveResearchLocalIngestion()` remains the authority for creating or executing
new ingest jobs and defaults off. It requires the existing Resource feature.
Turning it off does not disable A4 compatibility reads, verified A2 snapshot
reads, deletion repair, or derivative lexical rebuild from already-authoritative
snapshots. Disabled execution is reported as disabled; it never claims a job is
running.

A5 exposes server-only lifecycle seams. A7 will add retry/delete/search HTTP
routes and UI. Existing `/api/research/links` behavior remains compatible and
does not automatically fetch every saved URL in A5.

## Persisted layout

Extend the owner-only Research Resource root:

```text
<caveHome>/research-resources/
  manifests/                         # A3 authoritative user state
  snapshots/                         # A2 authoritative immutable records
  blobs/sha256/                      # A2 authoritative immutable CAS
  migration/                         # A4 authoritative compatibility state
  jobs/<job-id>.json                 # authoritative operational state
  failures/<job-id>.json             # bounded operational diagnostics
  fences/<resource-id>.json          # authoritative deletion revision
  deletions/<resource-id>.json       # restartable deletion journal
  tombstones/<resource-id>.json      # authoritative retained deletion proof
  index/research-resources.sqlite     # rebuildable lexical derivative
```

Every JSON directory inherits A2's containment, ownership, stable-identity,
no-symlink, no-hardlink, bounded-scan, exclusive-temporary-write,
file-`fsync`, atomic-rename, and directory-`fsync` rules. Records are parsed
strictly before use. Visible corruption fails closed; it is never treated as a
missing row. The SQLite file and its WAL/SHM siblings are derivative and may be
replaced only after verified-snapshot reconstruction succeeds.

## Deletion revision and journal decision

The manifest contract intentionally has no deletion revision. A5 therefore
persists the current revision separately before a tombstone can exist:

```ts
type ResourceDeletionFenceV1 = {
  version: 1;
  resourceId: string;
  deletionRevision: number; // starts at zero and only increases
  updatedAt: string;
};

type ResourceDeletionJournalV1 = {
  version: 1;
  resourceId: string;
  deletionRevision: number;
  expectedManifestRevision: number;
  phase:
    | "fenced"
    | "manifest_deleting"
    | "jobs_cancelled"
    | "tombstoned"
    | "derivatives_removed"
    | "snapshots_removed"
    | "manifest_removed"
    | "projection_verified";
  deletedAt: string;
  snapshotIds: string[];
  updatedAt: string;
};
```

An absent fence is revision zero. Job creation reads it under the shared
Resource intent lock and copies the value into `ResourceIngestJobV1`. At the
filesystem boundary deletion writes the one-revision-ahead journal first, then
the fence while retaining the exclusive lock. No live caller observes the
intermediate ordering. If the process dies between those writes, the next
operational transaction repairs the fence from the strict journal before it
exposes any state. This write-ahead ordering closes a crash window that two
independent files cannot otherwise close. Every subsequent job, snapshot,
index, and manifest publication rereads the exact fence immediately before
commit. The journal contains identifiers and revisions only: never a title,
URL, excerpt, blob content, local path, prompt, or credential.

The strict A1 tombstone remains exactly:

```ts
{ version: 1, resourceId, deletionRevision, deletedAt }
```

It is authoritative once published and retained indefinitely. The journal is
removed only after the A4 legacy projection is regenerated and byte-verified.
Recreating the same deterministic resource id starts from the retained fence
revision, not zero; a job from before deletion therefore remains permanently
one revision behind. A4 reconciliation consults tombstones before treating a
legacy-only row as a downgrade-era save, so an old projected row cannot
resurrect the deleted revision.

## Main ingest jobs

Persist the approved `ResourceIngestJobV1` plus a private, strict failure row:

```ts
type ResourceIngestFailureV1 = {
  version: 1;
  jobId: string;
  resourceId: string;
  resourceRevision: number;
  deletionRevision: number;
  stage: ResourceIngestJobStageV1;
  code: string;
  retryable: boolean;
  occurredAt: string;
};
```

Failure codes are a reviewed bounded vocabulary. They contain no provider
response body or raw exception message. The manifest exposes only
`lastFailureCode` and `retryable`.

Exactly one nonterminal job may exist for one resource revision and deletion
revision. Creation is idempotent. All state changes and claims run under the
shared cross-process Resource intent lock:

```text
queued -> claimed(fetch) -> claimed(snapshot) -> claimed(extract)
       -> claimed(publish_lexical) -> completed
```

`claimed` always has one unexpired lease. Claim, renew, advance, pause, retry,
complete, fail, and cancel compare the entire expected job record. An expired
or superseded owner cannot commit. A5 strengthens the not-yet-persisted A1
lease shape with a required 128-bit random `token`; owner names are diagnostic,
while the unique token is the actual fencing generation. Reclaim always rotates
the token, including when the same named worker reacquires the job.

`paused_quota` has no lease and does not increase `attempt`. A retryable failure
increments the attempt once and enters `retry_wait` with deterministic bounded
backoff. Retry exhaustion and nonretryable failures enter `failed`. A terminal
job is retained for diagnosis but never blocks creation for a newer manifest or
deletion revision. Successful publication removes the bounded failure row and
clears the manifest failure summary.

The maximum is five consumed attempts. Backoff is derived only from the job id
and attempt, uses capped windows of 5 seconds, 30 seconds, 2 minutes, 10 minutes,
and 1 hour, and is persisted in `availableAt`; restart never recomputes an
earlier time. A bounded `Retry-After` may move quota availability later but does
not consume an attempt. The default quota-policy seam imposes no invented local
quota; only typed upstream/account evidence pauses a job.

## Public URL fetch boundary

A5 fetches only manifest `sourceUri` values that are absolute HTTP(S) URLs,
contain no username/password, and resolve exclusively to public unicast
addresses. Reject loopback, private, link-local, multicast, unspecified,
carrier-grade NAT, documentation/test ranges where appropriate, and cloud
metadata destinations for IPv4 and IPv6.

Use manual redirects with at most five hops. Resolve and revalidate every hop;
never reuse the safety decision for the original hostname. The connection seam
receives the validated address set so tests can prove a DNS-rebinding change is
rejected. Response headers, declared length, streamed bytes, and elapsed time
are bounded. Abort the body immediately on a limit. Raw credentials, cookies,
ambient proxy authentication, and local-file access are never forwarded.

The initial release permits only default HTTP port 80 and HTTPS port 443,
allows at most 64 KiB of response headers, 64 MiB of compressed/raw response
bytes, and 64 MiB of normalized bytes, and uses a 10 second connect/header
deadline plus a 30 second whole-response deadline. Text/HTML/JSON inputs are
further limited to 16 MiB raw. PDF extraction is limited to 2,000 pages and
2 MiB normalized UTF-8 per page. Decompression and parser output are counted
independently so a small compressed body cannot expand past the normalized cap.

Fetch results are typed as success, retryable transport/server failure,
nonretryable input/media failure, or quota/account pause. HTTP `429` and a
bounded reviewed set of provider quota responses enter `paused_quota`; they do
not spend an attempt. Fetched bytes are untrusted data, never instructions or
authority.

## Deterministic extraction adapters

The supported A5 matrix is:

| Input | Normalized media type | Adapter |
| --- | --- | --- |
| `text/plain` | `text/plain; charset=utf-8` | strict UTF-8, newline normalization |
| Markdown | `text/markdown; charset=utf-8` | strict UTF-8, newline normalization |
| HTML/XHTML | `text/markdown; charset=utf-8` | deterministic title/body/link extraction |
| JSON | `application/json` | strict parse plus canonical JSON |
| PDF | `text/plain; charset=utf-8` | pinned `pdfjs-dist`, one page at a time |

Sniffing is limited to resolving missing/generic text content types; it never
turns arbitrary binary data into text. Unsupported or malformed media fails
nonretryably. Strict UTF-8 rejects replacement decoding. HTML drops active,
hidden, and metadata content and emits stable Markdown from a reviewed subset;
it does not execute scripts or load subresources. PDF extraction produces a
single UTF-8 blob plus one-based, ordered, contiguous half-open byte boundaries
for every page. Adapter ids and versions are constants.

For identical raw digest plus adapter id/version, normalized bytes and page
boundaries are byte-identical. Snapshot ids derive from the resource id,
resource revision, raw digest, normalized digest, and receipt so retry is
idempotent. Snapshot publication uses A2 `publishSnapshot` and its digest/size
verification. `sourceSelector` is `whole-resource`; later subset selectors are
an A7/Context Pack concern.

## Lexical derivative

Use Node's built-in SQLite with a dedicated database. The schema contains
resource publication metadata, snapshot bindings, deterministic chunks, and an
FTS5 external-content table. Chunk ids and ordering derive from UTF-8 byte
boundaries, never JavaScript character offsets. One transaction replaces all
rows for a resource and commits the exact resource revision, snapshot id,
snapshot digest, lexical schema version, and chunker version.

Before commit, recheck the job lease, manifest revision, and deletion fence.
Only after the lexical transaction commits may the manifest advance to
`ingest.state: "ready"` with `currentSnapshotId`. Embeddings are neither read
nor required. A server-only lexical probe proves exact snapshot-scoped FTS is
usable; A7 owns the public query contract and ranking.

Missing, corrupt, stale, or revision-mismatched lexical rows are rebuilt only
from `readSnapshot()` verified bytes. Reconstruction first builds a complete
replacement and then swaps it under the Resource lock. Derivative corruption
never changes authoritative manifests, snapshots, jobs, fences, or tombstones.
The swap fsyncs its directory wherever the host supports directory fsync.
General deletion also removes interrupted-rebuild and corrupt-database
residues, because those derivative files may retain recoverable plaintext even
after the active index row is gone.

## Ingest orchestration and publication fences

The runner performs one durable boundary per stage so a crash can replay the
same job:

1. Claim a due queued/retry job and capture manifest and fence revisions.
2. Fetch, then recheck lease/manifest/fence.
3. Persist the claimed job's fetch-stage checkpoint and renewed lease. Raw
   bytes remain bounded in process until immutable snapshot publication.
4. Extract deterministically, then recheck lease/manifest/fence.
5. Publish the immutable A2 snapshot, then recheck all fences.
6. Publish lexical rows transactionally, then recheck all fences.
7. Revision-update the manifest to `ready` with the exact snapshot pointer.
8. Mark the job completed and remove its bounded failure row.

Fetch and extraction bytes remain bounded in process and are not copied into a
second mutable staging store. Their durable job stage records the current
operation; a crash before immutable snapshot publication requeues at `fetch`
and deterministically refetches/reextracts. After snapshot publication, its
digests, receipt, and bytes are the durable work result. A crash may leave an
unreferenced CAS blob, immutable snapshot, or stale derivative transaction;
startup repair can remove/rebuild those. It may never leave a ready manifest
pointing at unverified bytes.

Refresh first revision-updates the manifest to `queued` and clears the current
pointer, then creates a job for that new revision. Older snapshots remain
immutable until explicit deletion or later retention policy.

## Ordered general deletion and A4 integration

General deletion is distinct from A4's narrow metadata-only compatibility
delete. It must not weaken or reuse that precondition. Under the Resource lock:

1. Increment and persist the deletion fence, then publish the `fenced` journal.
2. Revision-update the manifest to `deleting` and clear its snapshot pointer.
3. Cancel/fence all main jobs and any future semantic-task records.
4. Publish the strict minimal tombstone.
5. Delete lexical and semantic derivative rows.
6. Delete every recorded immutable snapshot for the resource through A2
   reference-counted deletion, preserving shared blobs.
7. Remove the exact expected deleting manifest last.
8. Ask A4's coordinator to regenerate and byte-verify the complete legacy
   projection from remaining compatible manifests.
9. Advance the journal after every boundary and remove it after projection
   verification.

A5 adds one reviewed transaction operation for deleting an exact manifest in
`deleting` state after all resource snapshots are gone. It does not broaden
`deleteCompatibilityManifest`. A4 exposes a projection-only regeneration seam
that runs within the caller's serialized transaction without importing stale
legacy rows or recursively acquiring the lock.

Each phase is idempotent. Startup resumes journals before creating or claiming
jobs. If a crash happened after manifest removal but before projection, the
tombstone and journal still prevent resurrection and projection repair
continues from the remaining catalog.

## Startup reconciliation

One serialized pass:

1. Strictly load all fences, journals, tombstones, jobs, and manifests.
2. Finish every deletion journal in deterministic resource-id order.
3. Expire abandoned leases. Requeue only jobs whose manifest, resource
   revision, and deletion revision are still current; cancel stale jobs.
4. Leave nonretryable failures visible.
5. For each `ingest.desired` manifest, verify its advertised snapshot. If no
   usable snapshot and no active current job exists, create exactly one queued
   job.
6. Verify/rebuild lexical rows for every usable current snapshot.
7. Remove or ignore stale derivative rows; never infer authoritative state from
   SQLite.

Concurrent startup reconcilers converge through the same process-intent lock.
The pass is safe to repeat after every durable boundary.

## Crash, race, and security verification

Focused suites cover:

- strict job/failure/fence/journal/tombstone persistence, owner-only modes,
  bounded scans, atomic replacement, and path attacks;
- claim/claim, retry/retry, startup/startup, publish/delete, and refresh/delete
  child-process races;
- lease expiry, stage replay, quota pause without attempt consumption,
  deterministic backoff, terminal failure visibility, and successful clearing;
- redirect loops, SSRF/private-address and per-hop DNS rejection, timeout,
  oversized headers/body, misleading length, invalid UTF-8, unsupported media,
  and bounded failure disclosure;
- byte-deterministic text/Markdown/HTML/JSON/PDF normalization and exact PDF
  page boundaries;
- immutable snapshot idempotence and fence checks after fetch, extraction,
  snapshot, lexical, and manifest publication;
- FTS5 transaction atomicity, exact snapshot scoping, embedding-free operation,
  corrupt/missing/WAL rebuild, and stable UTF-8 chunk coordinates;
- crash/restart recovery at every externally observable job transition and
  every deletion phase;
- deletion tombstone privacy, shared-CAS retention, A4 projection repair, and
  stale-worker non-resurrection; and
- feature-off/on/restart truth.

Every new test is registered exactly once in `scripts/run-tests.mjs`. A1
contract, A2 store, A3 catalog/API, and A4 migration/compatibility/crash/route
suites remain green.

## Implementation sequence

1. Add this detailed plan.
2. Add hardened operational persistence for jobs, failures, fences, deletion
   journals, tombstones, and exact locked transitions.
3. Add public-address validation, bounded manual-redirect fetch, and typed
   failure classification.
4. Add deterministic text/Markdown/HTML/JSON/PDF adapters.
5. Add the SQLite FTS5 derivative and verified-snapshot rebuild seam.
6. Add the staged ingest runner with repeated lease/revision/deletion fences.
7. Add restartable general deletion plus the narrow A4 projection-regeneration
   integration.
8. Add startup reconciliation and adversarial/crash/concurrency integration
   tests.
9. Run focused suites, A1-A4 regressions, `pnpm check:tests-wired`,
   `pnpm typecheck`, `pnpm lint`, `git diff --check`, and full app/API suites.

## Rollback

The feature defaults off. Rollback stops new job creation and execution but
must preserve the whole `research-resources/` tree, including jobs, fences,
deletion journals, tombstones, snapshots, and manifests. It may discard and
rebuild only the SQLite derivative. An older build continues to see A4's
verified legacy projection. Reinstalling A5 completes deletion journals before
accepting work, expires leases, and resumes only revision-current retryable
jobs; it never compacts tombstones or lowers deletion revisions.
