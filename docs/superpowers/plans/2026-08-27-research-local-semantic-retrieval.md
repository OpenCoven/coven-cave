# Research local semantic retrieval plan

**Bead:** `cave-6sles.7`
**Program unit:** A6 — Optional local semantic retrieval
**Depends on:** A5 merged in PR #5067
**Scope:** Cave-local loopback embedding configuration, bounded embedding
adapters, durable best-effort embedding tasks, vector persistence, model
revision compatibility, deletion/startup repair, and truthful semantic
availability. This unit does not add a public query route, Resources UI,
exact/lexical/hybrid rank fusion, Context Packs, backup/restore, cloud
retrieval, or portable protocol fields.

## Goal

Add semantic candidates as an optional derivative of already-published A5
lexical chunks. A missing, disabled, invalid, offline, changed, or failing
embedding provider must never hide a lexically ready Resource, delay main
ingestion, or make semantic evidence claim readiness. Only vectors for the
authoritative current snapshot and the exact configured model revision are
eligible for a later A7 query.

## Authority and rollout

`caveResearchSemantic()` remains the sole rollout authority. It defaults off
and requires the existing Resource and local-ingestion gates. When disabled,
A6 neither creates nor executes semantic work and reports `disabled`; A5
ingestion, lexical publication, deletion repair, and snapshot verification
remain available. Turning the flag off preserves task and vector files for a
future compatible re-enable, but no preserved row may be reported as active or
ready while the flag is off.

Provider configuration is server-only and explicit. A6 accepts no ambient
OpenAI key, proxy, cookie, authorization header, or remote fallback. An absent
or invalid configuration reports `unavailable`; it does not silently choose a
model or endpoint. Provider response bodies and raw exceptions never enter
durable tasks or user-visible status.

## Provider configuration and loopback boundary

The first adapter is a strict tagged configuration:

```ts
type ResearchEmbeddingProviderConfig = {
  providerId: string;
  protocol: "openai" | "ollama";
  endpoint: string;
  modelId: string;
  dimensions: number;
};
```

`endpoint` is an absolute credential-free HTTP(S) URL whose host is a literal
IPv4 loopback address in `127.0.0.0/8` or the IPv6 loopback address `::1`.
Hostnames, non-loopback addresses, fragments, and query strings are rejected,
including `localhost`, so DNS cannot widen the authority. The exact configured
path is used: OpenAI-compatible deployments normally configure
`/v1/embeddings`; Ollama deployments normally configure `/api/embed`.

Requests use `POST` JSON and `accept: application/json`, follow no redirects,
send no credentials, and are bounded to 64 inputs, 16 MiB aggregate UTF-8 input,
32 MiB response bytes, and a 30-second deadline. The adapter checks a 2xx
status, JSON media type, exact result count, unique OpenAI indexes when present,
the configured model when the response names one, exact configured dimensions,
finite numeric values, and the response byte bound before returning detached
vectors. OpenAI-compatible responses use `data[].embedding`; Ollama responses
use `embeddings[]`. Error results are a bounded vocabulary with a truthful
`unavailable` versus `failed` disposition and contain no response body.

## Compatible model revision

The compatible model revision is a SHA-256 digest over a canonical tuple:

```text
provider adapter version
protocol
provider id
canonical loopback endpoint origin and path
model id
dimensions
vector encoding version
A5 lexical chunker version
```

Changing any tuple member produces a new revision. Provider-reported model
labels do not override the configured model. Existing vectors from another
revision are stale and ineligible immediately; they may be removed after the
new revision is fully published. Reverting to an exactly matching revision may
reuse only rows whose snapshot, lexical revision, digest, chunk ids, and vector
dimensions still verify.

## Durable task state

Persist the approved `ResourceEmbeddingTaskV1` under the owner-only Resource
root:

```text
<caveHome>/research-resources/
  embedding-tasks/<task-id>.json
  index/research-resources-semantic.sqlite
```

Each Resource has at most one current task file, named deterministically by its
resource id. The approved task fields bind that file to snapshot id, lexical
revision, provider id, model id, and dimensions. A6 uses A1's explicitly
additive persisted-record compatibility to add one Cave-private
`modelRevision` SHA-256 field; it is required by the A6 store and verified
against the vector publication's `provider_state` before a task can be ready.
This durable field ensures even a terminal failed task becomes stale when only
the endpoint, protocol, adapter, encoding, or chunker revision changes. Because
the A1 task contract intentionally has no lease, every task
transition runs under A5's existing cross-process Resource intent lock. Only
one process can move a task from `queued` to `building` and perform its bounded
request; a crashed `building` task is returned to `queued` by startup
reconciliation. Task files
use the A2/A5 private-directory, stable-identity, no-link, bounded-scan,
exclusive-temporary-write, file-fsync, atomic-rename, and directory-fsync
rules. Unknown additive fields remain parseable, while A6 writes only the A1
fields plus the reviewed `modelRevision` extension.

Task transitions are:

```text
queued -> building -> ready
                   -> failed
                   -> unavailable
```

`failed` means the configured provider answered incompatibly or rejected the
specific work. `unavailable` means semantic execution cannot currently run,
including an absent/offline provider. Reconciliation may replace
`unavailable` with `queued` when the same configuration becomes available;
`failed` remains visible until an explicit reconcile/rebuild or a new compatible
revision makes a fresh task. No semantic status changes an A5 manifest.

## Vector derivative

Use a dedicated SQLite derivative with tables `provider_state`,
`embedding_state`, and `chunk_embeddings`. One transaction replaces all vectors
for one resource/snapshot/model revision and records:

- resource id, snapshot id, lexical revision, deletion revision, and normalized
  blob digest;
- provider id, model id, configured dimensions, and compatible model revision;
- lexical chunk id, ordinal, UTF-8 byte start/end, and a fixed little-endian
  float32 vector encoding version.

Before vector commit, re-read the manifest, deletion fence/journal/tombstone,
verified snapshot, lexical publication, task identity, and every lexical chunk
id/boundary. The exact checks run again before marking the task `ready`. A
resource is semantically eligible only when the task is `ready`, the vector
publication matches the effective model revision, the manifest is lexically
ready with that exact snapshot, the snapshot digest verifies, and the lexical
publication/chunks still match. A server-only probe accepts an already-embedded
query vector and returns deterministic cosine-ranked chunk candidates for A7;
A6 adds no public query or fusion contract.

NaN, infinities, wrong dimensions, zero vectors, malformed blobs, duplicate
ordinals, corrupt schema, and revision mismatches fail closed. Database rebuild
starts from verified current snapshots plus successful re-embedding; vectors
are never authority and cannot reconstruct snapshots, manifests, or lexical
rows.

## Publication and replay

Lexical publication remains the completion boundary for A5. A6 reconciliation
discovers every current lexically ready manifest, verifies its snapshot and A5
lexical publication, and creates exactly one compatible task. The semantic
runner embeds the deterministic A5 chunks in bounded batches, then publishes
all vectors atomically. A provider failure cannot roll back or alter lexical
state.

Startup reconciliation is serialized and repeatable:

1. Finish A5 deletion journals before semantic scheduling.
2. Cancel/remove tasks and vector publications for deleted resources.
3. Requeue interrupted `building` tasks only when snapshot, lexical revision,
   deletion fence, and configured model revision remain current.
4. Mark stale tasks ineligible and create one current task for every verified
   lexically ready manifest when the feature and provider are available.
5. Report `disabled` when the feature is off and `unavailable` when provider
   configuration or reachability is absent, without touching lexical state.
6. Ignore or rebuild corrupt/stale derivative rows only from verified A5 state.

Concurrent reconcilers and runners converge through the shared intent lock and
deterministic task identity. Network work is performed outside the lock after a
`building` transition, then publication reacquires the lock and rechecks every
authority fence; a delete/refresh/provider change that wins in between makes
the old result ineligible and prevents commit.

## Deletion integration

A5 general deletion remains ordered. At `manifest_deleting`, remove all
semantic tasks for the resource. At `tombstoned`/derivative removal,
delete its semantic publication and purge recoverable SQLite WAL/SHM/rebuild
residue before snapshots or the manifest are removed. Every vector publication
checks the deletion journal, fence, and tombstone immediately before commit, so
an old provider response cannot resurrect deleted content. The retained strict
tombstone contains no title, URL, excerpt, vector, provider, or model data.

## Truthful availability seam

A6 exposes a server-only status with exactly:

```ts
type ResearchSemanticAvailability =
  | { state: "disabled" }
  | { state: "unavailable"; code: boundedCode }
  | { state: "ready"; providerId: string; modelId: string;
      dimensions: number; modelRevision: string };
```

`ready` describes a validated effective provider configuration, not proof that
every Resource has vectors. Per-resource readiness is separately derived from
the exact compatible task/publication checks. A7 can therefore emit the A1
semantic evidence states without guessing, while lexical-only operation stays
complete.

## Crash, race, and security verification

Focused suites cover:

- literal-loopback-only URL validation, credentials, hostnames, redirects,
  timeouts, response limits, invalid media/JSON, count/index/model/dimension
  mismatch, finite-number checks, and secret-free failures for both protocols;
- deterministic compatible-revision derivation and invalidation on every tuple
  member;
- strict private task persistence, bounded scans, atomic replacement, path and
  link attacks, idempotent creation, and corrupt-record fail-closed behavior;
- claim/claim, reconcile/reconcile, publish/delete, publish/refresh, and
  provider-revision-change races, including child-process coverage where the
  filesystem boundary matters;
- exact vector encoding, transactional all-or-nothing replacement,
  deterministic cosine order, zero-vector rejection, corruption handling, and
  stale-model/snapshot/lexical-revision exclusion;
- crash replay from `building`, committed-vectors-before-ready repair, deletion
  cancellation/removal, tombstone privacy, and stale-worker non-resurrection;
- feature off/on/restart behavior, absent/offline provider truth, and proof that
  A5 ingestion plus lexical probes remain usable without semantic work; and
- exact-once registration of every new test in `scripts/run-tests.mjs`.

## Implementation sequence

1. Add this detailed plan.
2. Add strict provider configuration, compatible-revision derivation, bounded
   OpenAI-compatible/Ollama adapters, and focused adversarial tests.
3. Extend the A5 operational store with durable embedding-task operations and
   persistence/security tests.
4. Add the semantic SQLite derivative, compatible publication/probe checks,
   corruption handling, and deterministic vector tests.
5. Add the serialized semantic reconciler/runner with snapshot, lexical,
   deletion, and model-revision fences plus crash/race tests.
6. Integrate task cancellation and vector removal into A5 general deletion
   without making main ingestion wait for embeddings.
7. Register tests and run focused suites, A1-A5 regressions,
   `pnpm check:tests-wired`, `pnpm typecheck`, `pnpm lint`,
   `git diff --check`, and the relevant app/API suites.

## Rollback

The semantic feature defaults off. Rollback stops new task creation and
execution while preserving authoritative manifests, snapshots, jobs, fences,
tombstones, and the complete lexical derivative. Task JSON and the semantic
SQLite database may be retained for a compatible re-enable or deleted as
derivative state; neither is needed to read or search Resources lexically. An
older A5 build ignores A6 files, continues deletion/startup repair, and never
needs an embedding endpoint. Reinstalling A6 revalidates the effective model
revision and rebuilds only from verified current A5 snapshots and chunks.
