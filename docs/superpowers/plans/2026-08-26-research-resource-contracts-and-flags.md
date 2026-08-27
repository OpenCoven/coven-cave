# Research Resource Contracts and Feature Flags Implementation Plan

**Goal:** Define the Cave-owned Research Resource records and retrieval boundary needed by the local resource release, plus truthful rollout gates, without changing the portable Research Run Protocol.

**Source:** `docs/superpowers/plans/2026-08-16-externalized-research-desk-program.md` §§3-7, 9, and 11 A1, building on the approved selector contract in `src/lib/research-protocol/context-pack.ts`.

**Boundary:** This unit adds types, parsers, tests, and feature-flag getters only. It does not add stores, APIs, UI, backup behavior, ingestion workers, indexes, embeddings, migrations, or changes under `schemas/research/v1/` and `src/lib/research-protocol/`.

## Contract decisions

All persisted mutable records use `version: 1`, accept only canonical JSON values, preserve safe unknown additive fields, and validate their known fields before returning detached data. The deletion tombstone is the persisted-record exception: it is a strict allowlist so a title, URL, excerpt, local path, or future unreviewed field cannot enter authoritative backup state. Query responses and their hits are also strict allowlists because they are non-persisted disclosure boundaries; an additive path, URI, URL, credential, or object key must not pass through accidentally.

The exact contracts are:

- `ResourceManifestV1` and `ResourceSnapshotV1`: the exact fields and enums approved in umbrella §3.3. Snapshot selectors reuse `ContextSelectorV1` and `parseContextSelectorV1`; local resource types do not join the portable protocol dispatcher.
- `ResourceIngestJobV1` and `ResourceEmbeddingTaskV1`: the exact fields and states approved in umbrella §4. A lease is present exactly for a claimed job. `paused_quota` is represented without changing `attempt`. Semantic state remains independent from lexical publication.
- `ResourceTombstoneV1`: exactly `{ version: 1, resourceId, deletionRevision, deletedAt }`. No additive fields are accepted.
- `ResearchLinksProjectionV1`: `{ version: 1, catalogRevision, projectedDigest, generatedAt }`. The digest is the complete generated `research-links.json` projection.
- `ResearchLinksMigrationJournalV1`: `{ version: 1, catalogRevision, intendedProjectionDigest, startedAt }`. Its presence means projection verification/repair must finish before reads.
- `ResourceQueryV1`: `{ version: 1, text, filters?, ranking, limit }`. `text` is non-empty. Filters are optional arrays `projectIds`, `familiarIds`, `kinds`, `sensitivities`, and `ingestStates`, plus `publishedFrom` (inclusive), `publishedBefore` (exclusive), and `contextPackId`. `ranking` is `exact | lexical | hybrid`; `limit` is an integer from 1 through 100. Empty filter arrays are rejected rather than ambiguously meaning either all or none.
- `ResourceQueryResponseV1`: `{ version: 1, ranking, hits }`. Each `ResourceQueryHitV1` carries `resourceId`, `snapshotId`, `resourceRevision`, `normalizedBlobDigest`, the exact `selector`, `excerpt`, `excerptDigest`, and truthful `retrieval` evidence. Exact matching is boolean; lexical matching carries an optional positive rank only when matched; semantic state is `disabled | unavailable | ready`, may report a match only when ready, and carries an optional positive rank only when matched. The response, hit, and nested retrieval evidence are strict allowlists and deliberately have no path, URI, URL, provider credential, or remote object key.

Digests are lowercase SHA-256. Timestamps are UTC RFC 3339. Revisions and deletion fences are non-negative safe integers; manifest revisions and snapshot resource revisions are positive. Page boundaries use one-based consecutive page numbers and ordered, non-overlapping half-open byte ranges within `normalizedBytes`. Snapshot validation cross-checks selectors against those bytes: a `text-span` ends within `normalizedBytes`, while a `pdf-page-span` requires the page table, names an existing page, and uses page-relative offsets no larger than that page's boundary length. Published date filters must form a non-empty half-open interval when both are present.

## Feature-flag decisions

`src/lib/feature-flags.ts` remains the only flag authority. New raw environment gates use the existing truthy grammar and default off:

- `NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES`
- `NEXT_PUBLIC_CAVE_RESEARCH_LOCAL_INGESTION`
- `NEXT_PUBLIC_CAVE_RESEARCH_SEMANTIC`
- `NEXT_PUBLIC_CAVE_RESEARCH_CONTEXT_PACKS`
- `NEXT_PUBLIC_CAVE_RESEARCH_TOPIC_DISCOVERY`
- `NEXT_PUBLIC_CAVE_RESEARCH_HOSTED_RUNS`

Effective gates are hierarchical: resources is the root; local ingestion requires resources; semantic requires local ingestion; Context Packs require resources; Topic Discovery requires Context Packs. `caveResearchHostedRuns()` keeps its required no-argument signature and returns false throughout A1, including when the public environment flag is true, because no Gate C0 server authority exists yet. A later C0 server-only integration must replace this fail-closed implementation only after it can prove the approved account, repository, bindings, and authentication policy; the client flag alone can never claim readiness.

## Implementation

1. Add `src/lib/research-resource-contracts.ts` with local types and hand-written parsers.
2. Add focused valid, invalid, compatibility, privacy, and semantic-invariant coverage in `src/lib/research-resource-contracts.test.ts`.
3. Add the six hierarchical getters to `src/lib/feature-flags.ts` and extend its test with default-off, truthy grammar, hierarchy, and hosted-readiness cases.
4. Register the local contract test in the app test suite. Keep portable conformance wiring unchanged.

## Verification

Run the two focused tests, `pnpm test:app`, `pnpm test:conformance`, `pnpm typecheck`, `pnpm lint`, and `pnpm check:tests-wired`. Confirm the final diff contains no file under `schemas/research/v1/` or `src/lib/research-protocol/`.

## Rollback

All feature gates default off. Reverting this unit removes unused types and getters without migrating persisted data because no store or writer ships in A1. Later units must keep their read/migration paths compatible while their effective flag is off.
