# Codex-automations facade deprecation plan

**Status: plan only.** No facade route is retired, renamed or deprecated at runtime. This page records which typed Coven path serves each compatibility route, the evidence for it, and the gates that must clear before any version may retire one. Parent: OpenCoven/coven-cave#5217, criterion 7. Qualification: #6265.

## Successor mapping

Every route below already talks to Coven through typed server modules. None reads or writes `~/.codex` except the explicit legacy import path. `src/lib/automations/facade-inventory.test.ts` pins this table to the source. A new route, method or browser caller fails that test until it is added here with a successor and a canary marker.

| Facade route | Methods | Typed successor | Released-daemon canary marker |
| --- | --- | --- | --- |
| `/api/codex-automations` | GET, POST | `automation-consumer-reads`, `automation-consumer-commands` | `facadeReadsListGetRunsLastRunsLogImport`, `createPaused` |
| `/api/codex-automations/[id]` | GET, PATCH, DELETE | `automation-consumer-reads`, `automation-consumer-commands` | `facadeReadsListGetRunsLastRunsLogImport`, `staleSave`, `journalTypedCreateReplayEditMetadataConflictDeleteOffline` |
| `/api/codex-automations/[id]/definition` | GET | `automation-consumer-reads` | `conflictRebase` |
| `/api/codex-automations/[id]/run` | POST | `coven-automations-client` | `runNowFailure` |
| `/api/codex-automations/[id]/runs` | GET | `automation-consumer-reads` | `facadeReadsListGetRunsLastRunsLogImport` |
| `/api/codex-automations/[id]/runs/[runId]/log` | GET | `automation-consumer-reads` | `facadeReadsListGetRunsLastRunsLogImport` |
| `/api/codex-automations/import` | POST | `coven-automations-client` (explicit legacy import) | `facadeReadsListGetRunsLastRunsLogImport` |
| `/api/codex-automation-last-runs` | GET | `automation-consumer-reads` | `facadeReadsListGetRunsLastRunsLogImport` |

With the daemon stopped, every route answers `503` with `degraded: true` (`facadeOffline=degraded`); there is no fallback to Codex files or direct runtime launch.

## Known callers

In-repo callers that address the facade by URL: `automations-view`, `cron-detail-panel`, `create-intent`, `revision-rebase`, `research-mission-client` and `surface-warmup-registry`. The shared `schedules:automations` list also feeds `calendar-view`. No Swift, Rust or iOS caller references these routes.

Out-of-repo callers are **unknown**: scripts, bookmarks, other OpenCoven clients and third-party integrations may call these local endpoints. Absence from this repository is not evidence that none exist.

## Versioned schedule

Each stage needs a Cave release in which its entry gate held at that release's exact commit. A stage never starts from a source-only or canary-only result.

1. **Announce (no behaviour change).** Publish this mapping in release notes, and name the typed successor for each route. Facade responses stay identical.
2. **Signal.** Add a `Deprecation` response header and a successor `Link` header to each facade route, and log local use counts without request bodies. Responses otherwise stay identical. This stage needs at least one Cave release cycle with no unmapped in-repo caller.
3. **Migrate callers.** Move each in-repo caller to its successor API, one surface per PR. Preserve deep links by redirecting or translating old URLs, never by dropping them. Keep `POST /api/codex-automations/import` as the explicit, source-preserving legacy import, renamed only under a compatibility alias.
4. **Retire.** Remove a route only after its local use count is zero across a full release cycle, its successor canary passes on an exact Coven release, and its removal is recorded on #5217. Import-only legacy access remains.

## Gates that block stage 2 and later

- Every supported client has migrated, as shown by the inventory test and canary markers above.
- Upstream contracts are released and pinned: coven#857 (Runtime Authority), coven#858 (certification) and sdk#80 (SDK client seam). Until they are, typed successors cannot carry authority, approval or receipt semantics that the facade does not already have.
- The external-caller question has an owner decision: either a documented support policy for local API consumers, or explicit acceptance that out-of-repo callers break at retirement.

Concept renaming from "Codex automation" to "Coven automation" or "routine" follows stage 3. It is user-visible copy work, tracked separately.
