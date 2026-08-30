# Local Research Retrieval UX Implementation Plan

**Bead:** `cave-6sles.8` (A7)
**Branch:** `feat/cave-6sles-8-local-research-retrieval-ux`
**Base:** `origin/main` at `65267fe0f5c0794863e2d23d690b4958a80a0e08`

## Outcome

Make locally ingested Research resources searchable and operable from the existing Resources tab. A result must identify the exact authoritative resource revision, snapshot, normalized digest, byte selector, excerpt, excerpt digest, and retrieval evidence. Exact and FTS5 retrieval work with no embedding provider. Hybrid mode remains truthful when semantic retrieval is unavailable. Failed ingestion can be retried and any resource can be deleted through the durable A5 coordinator.

## Visual thesis

A calm evidence ledger: dense, cardless search results put the matched passage and its authority ahead of decoration, while muted status and provenance make the local system legible at a glance.

## Content plan

1. Keep the existing `Resources` header and link intake as the primary collection workflow.
2. Turn the existing search control into a deliberate local-content search affordance without hiding the current title/URL filtering behavior.
3. Show a compact result header with query mode, hit count, and truthful semantic availability.
4. Render each evidence hit as one bordered row: resource title and kind; ingest/provenance line; excerpt; matched-method labels; and a single `View resource` action.
5. Surface ingestion state on saved-resource rows and in the detail dialog. Failed resources show the safe failure category and `Retry ingestion` only when retryable.
6. Put destructive deletion behind explicit confirmation in the existing focused dialog, retaining the current compatibility wording for saved links.
7. Cover loading, unavailable, empty-catalog, no-match, filtered-empty, failed-ingest, and semantic-unavailable states with factual utility copy.

## Interaction thesis

- Search is debounced and request-versioned so results settle without keystroke churn and stale responses cannot replace newer evidence.
- Selecting a hit opens the existing resource detail treatment and brings the exact excerpt into view; focus is trapped and returned using the established dialog behavior.
- Retry and delete announce completion or failure through the shared live-region primitive; no ambient animation is added, so reduced-motion behavior remains unchanged.

## Contract and security decisions

- Add `POST /api/research/resources/search` accepting only `ResourceQueryV1`. Read a bounded JSON body, reject non-local requests, respect `CAVE_RESEARCH_RESOURCES`, and return only `ResourceQueryResponseV1` or stable safe error codes.
- Add retry and delete mutations to `/api/research/resources/[id]` with the same local-only and feature gates. Route IDs continue through `isSafeResearchResourceRouteId`.
- Search reads manifests and verified snapshots under the resource store lock. Candidates from the derivative SQLite index are re-resolved against current manifest revision, deletion fence, snapshot identity, and normalized digest before excerpt publication.
- Apply manifest filters before ranking. `contextPackId` is rejected as unsupported until Unit 1 owns pack membership; silently ignoring it would widen the query.
- Exact ranking considers normalized query matches in title, canonical identity, and source URI. Lexical ranking uses FTS5 BM25 with deterministic resource/snapshot/chunk tie-breaks. Fusion uses deterministic reciprocal-rank fusion and deduplicates to the best passage per resource/snapshot.
- Hybrid never fabricates semantic evidence. Without a compatible ready A6 provider, it fuses exact and lexical lanes and marks semantic evidence `unavailable`; with a future injected semantic lane it may include only authority-compatible results.
- Excerpts are decoded from verified normalized snapshot bytes, bounded around the matched byte span, returned with a `text-span` selector, and hashed from the exact response string.
- Search responses never expose filesystem paths, raw operational failures, blob locations, or unreviewed manifest extension fields.

## Implementation sequence

### 1. Lexical query primitive

- Extend `research-resource-lexical-index.ts` with a bounded cross-resource query that joins FTS chunks to publication authority.
- Convert free text into a safe FTS expression from Unicode word tokens; never interpolate SQL or accept raw FTS operators.
- Return resource authority, chunk byte bounds, text, and BM25 score in a deterministic order.
- Add focused tests for multi-resource ranking, punctuation/operator input, bounds, authority, and tie ordering.

### 2. Authoritative retrieval coordinator

- Add `research-resource-retrieval.ts` with dependency injection for store/index and one public `query` operation.
- Validate the versioned query; filter manifests before either retrieval lane; build exact candidates; query lexical candidates; fuse deterministically; revalidate/read snapshots; construct bounded excerpts and digests; close owned index handles.
- Fail closed for unsupported context-pack membership and corrupt/stale derivative entries. Treat an unavailable/corrupt lexical index as a safe service error, not an empty successful search.
- Add tests for exact-only, lexical-only, hybrid-with-semantic-unavailable, filters-before-rank, stale index authority, digest/selector correctness, deterministic ordering, result limit, and unsupported filters.

### 3. Local API boundary

- Add the search route and tests for local-request enforcement, flag-off 404, bounded/malformed body, schema errors, safe service errors, and no-store success.
- Extend the resource detail route with retry/delete handlers backed by `createResearchResourceIngestion`; preserve stable 404/400/409/500 categories.
- Add route tests proving retryability enforcement, refresh enqueue, durable deletion, and safe error projection.
- Wire each new test file exactly once in `scripts/run-tests.mjs`.

### 4. Client model and Resources UX

- Add a small client hook that loads manifest metadata, submits versioned searches, and performs retry/delete with abort/request-generation protection.
- Reconcile manifests to legacy saved links by stable resource/legacy IDs so current link readers remain intact.
- Enhance `research-tab-resources.tsx` with ingest state, evidence results, exact/lexical mode controls if useful, retry, delete, and the detail evidence preview. Reuse `SearchInput`, `Button`, live-region, focus trap, relative time, icons, and existing overlay.
- Add only token-based styles to `surface-research-resources.css`; use container queries for narrow widths and keep primary actions to three or fewer.
- Add component/hook tests for loading, success, no-match, semantic-unavailable, failed/retryable, delete confirmation, announcements, and stale-response suppression.

### 5. Global-search compatibility seam

- Add a live `SearchProvider` adapter for Research resources without registering it globally yet. It emits normalized, permission-scoped documents and delegates ranking to the existing global coordinator contract.
- Test provider fingerprinting, filter applicability, permissions, safe diagnostics, and action payloads. Registration remains a later global-search integration decision rather than coupling A7 to unrelated startup code.

### 6. Verification

- Run focused contract, lexical, retrieval, route, hook, and Resources component tests.
- Run the app test suite, typecheck, lint/design gates, and production build in proportion to touched paths.
- Launch the real web app with the `run-cave-app` workflow and seeded local resources. Verify default and non-default themes, light and dark modes, keyboard-only search/result/detail/retry/delete, 200% zoom, and narrow container widths.
- Capture and inspect screenshots for populated search, no-match/semantic-unavailable, failed-ingest retry, and deletion confirmation. Record exact artifact paths in the Bead handoff.

## Rollback and compatibility

- Feature flag off preserves the current 404 boundary and existing saved-link UI.
- The lexical index is derivative and rebuildable; no query path mutates manifests or snapshots.
- Existing `/api/research/links` compatibility routes and saved-link projection remain unchanged.
- Retry/delete delegate to A5 durable operations, so rollback removes only the new public route/UI integration and not stored resources.

## Acceptance checklist

- [ ] Exact and lexical retrieval return authoritative, digest-bound evidence.
- [ ] Hybrid is useful without A6 and explicitly reports semantic unavailability.
- [ ] Filters run before ranking and unsupported filters fail closed.
- [ ] Stale/corrupt derivative rows cannot escape snapshot revalidation.
- [ ] Ingest states are visible; retry and delete use durable A5 operations.
- [ ] Existing saved-link add/read workflows still work.
- [ ] UI uses existing primitives/tokens and passes accessibility/design gates.
- [ ] Real-browser screenshots verify the vertical slice.
