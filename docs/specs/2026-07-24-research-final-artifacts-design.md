# Research Desk — clearly produce and save the final research artifact(s)

Date: 2026-07-24
Status: Approved (design)
Parent: `2026-07-12-research-mission-desk-design.md`

## Problem

A research mission's agents write real working files under
`<caveHome>/research-missions/<id>/` — `artifacts/primary.md`, `findings.md`,
`sources.json`, `research-log.md` — but only `artifacts/primary.md` is ever
saved durably, and only when a run ends with a `complete` decision (published
to the Grimoire Knowledge Vault by the mission runner). Everything else is
invisible:

- Checkpointed or stopped missions save nothing user-visible; their drafts
  have no open path in the UI at all.
- `findings.md`, `sources.json`, and `research-log.md` never become durable
  artifacts, even though `RESEARCH_ARTIFACT_KINDS` already defines `findings`,
  `source-ledger`, and `research-log` and the parent design promised
  "Publish valid Markdown artifacts into Knowledge Vault" (plural).
- The Library tab deliberately omitted file export because "artifacts expose
  no real file bytes in this phase" (`research-tab-library.tsx` header).
- A Vault publish failure is not retryable; nothing tells the user what was
  or wasn't saved.

## Decisions (user-confirmed)

1. **Final artifacts** are all four files: primary deliverable, findings,
   source ledger, research log.
2. **"Save" means both**: reliable Grimoire Vault publishing *and* real file
   access/export from the UI.
3. **Vault granularity**: one Vault entry per artifact — 4 entries per
   mission, all tagged `mission:<id>`; `sources.json` is rendered to a
   Markdown source ledger for its entry.
4. **Checkpoint drafts**: files are always viewable/exportable; Vault
   auto-publish happens on `complete` only, plus a manual per-artifact
   "Publish to Grimoire" action to bless a checkpoint draft.

## Design

### 1. Artifact refs — model all four files (Approach A)

`createMissionRecord` (`src/lib/server/research-mission-lifecycle.ts`)
registers four refs up front, all `state: "working"`, `iteration: 1`:

| key             | kind                   | relativePath           |
| --------------- | ---------------------- | ---------------------- |
| `primary`       | by mode (as today)     | `artifacts/primary.md` |
| `findings`      | `findings`             | `findings.md`          |
| `source-ledger` | `source-ledger`        | `sources.json`         |
| `research-log`  | `research-log`         | `research-log.md`      |

`primary` stays first in `mission.artifacts` (the runner's primary-artifact
logic keys off it); new code looks refs up by `key`, not index.

**Legacy backfill:** missions stored with only the `primary` ref gain the
missing standard refs at store-read time (`ensureStandardArtifactRefs`,
additive and keyed by `key`; never overwrites an existing ref). No disk
migration — the backfilled refs persist whenever the mission is next written.

### 2. Runner finish path — publish every final artifact

In `finishIteration` (`src/lib/server/research-mission-runner.ts`):

- Every pass that finishes through the normal evidence path bumps
  `iteration`/`updatedAt` on all four refs (they are the pass's working
  files).
- Missing `artifacts/primary.md` keeps today's semantics: early return to
  checkpoint with `lastError`, no ref updates, no publishing.
- On a `complete` decision, publish **each ref lacking a `knowledgeId`**:
  - Markdown artifacts publish their file content as-is.
  - The source ledger publishes `renderSourceLedgerMarkdown(sources)` — a new
    pure function in `src/lib/research-artifact-contract.ts` rendering the
    mission's merged, normalized `ResearchSourceRef[]` (never raw file bytes):
    title, status counts, then list-formatted sections per status
    (used/candidate/conflicting/rejected) with title, link (url or localPath),
    publisher, publishedAt, claim, note, confidence. List format, not tables,
    to avoid Markdown-escaping pitfalls.
  - Each entry passes `validateResearchArtifactContent` (existing 1 MiB cap)
    and carries the existing provenance header; ids/tags come from the
    existing `knowledgeId(missionId, artifactKey)` scheme
    (`research-<mission>-<key>`), tags `research`, `mission:<id>`, mode, kind.
- **Failure isolation:** each publish is individually wrapped. A failed or
  skipped artifact stays `working`, the failure reasons are recorded in
  `lastError` (naming the artifacts), and the mission still completes.
  Saving becomes retryable (via the manual action) instead of blocking the
  run's terminal state.
- The user-driven `finish` action (checkpoint → completed) runs this same
  publish-all step, so a manually finished mission saves its artifacts just
  like an agent `complete` decision.

### 3. Manual publish — `publish-artifact` action

New action on the existing actions route
(`POST /api/research/missions/[id]/actions`):

- Input: `{ action: "publish-artifact", artifactKey: string }`.
- Allowed when the mission is settled (`checkpoint`, `completed`, `failed`),
  the ref exists, and its state is `working` — `published` conflicts,
  `rejected` refs must first regain a working version through the existing
  reject → continue flow; guarded by `allowedResearchActions`.
  Running/queued missions reject it.
- Reuses the same render → validate → publish path as auto-publish; on
  success sets `knowledgeId` + `state: "published"`; `lastError` is cleared
  once no publish-failed artifacts remain.
- Already-published → conflict error ("already published"), not a re-publish.
- Missing/unreadable file → clear 4xx message; ref unchanged.

### 4. Files API — read-only, ref-backed

New route: `GET /api/research/missions/[id]/files/[key]`.

- Resolves `key` → ref → `relativePath`; serves **only** paths backed by a
  ref on that mission, read through the store's existing containment checks
  (`assertRealMissionDirectory` + `isWithin`).
- Response: `{ key, kind, title, fileName, content, absolutePath, updatedAt }`.
  `absolutePath` powers a copy-path affordance (local daemon, user's own
  files). Unknown mission/key → 404; containment violations → 4xx, never 500.
- Downloads are client-built blobs from this response (suggested name
  `<mission-slug>-<key>.md` / `.json`); no server write path exists.

### 5. UI — make produced/saved state obvious

**Desk rail artifact cards** (`research-mission-detail.tsx`): each card keeps
its `kind · state` kicker and gains:

- **View** — read-only in-app viewer (existing Studio modal pattern,
  `research-studio-modals.tsx`).
- **Download** — client-side blob save.
- **Open in Grimoire** — published refs (as today).
- **Publish to Grimoire** — settled + unpublished refs only.

**Saved summary** (mission detail): completed missions show an explicit
outcome line — "N artifacts published to the Grimoire · workspace on disk"
with the workspace path + copy button. Publish failures render as
"M not yet saved — publish now" (retry affordance). Checkpointed missions
show "N working files on disk — publish to Grimoire when ready."

**Library tab** (`research-tab-library.tsx`): unpublished cards get
View/Download instead of a dead end; published cards keep the Grimoire open.
The header comment claiming artifacts expose no real file bytes is updated.

**A11y / design contract:** `.focus-ring` on new interactive elements;
existing `Modal`/`IconButton`/`Button` primitives (focus trap + return
included); `useAnnouncer()` on publish/download outcomes; tokens only; no
new icon names unless added to `ICON_NAMES` via the subset script.

### 6. Error handling summary

| Failure                             | Behavior                                                       |
| ----------------------------------- | -------------------------------------------------------------- |
| `primary.md` missing at finish      | Checkpoint + `lastError` (unchanged)                           |
| Vault write fails for an artifact   | Mission still completes; ref stays `working`; named in `lastError`; manual retry |
| Manual publish on published ref     | Conflict error, no re-publish                                  |
| Manual publish, file unreadable     | Clear 4xx message, ref unchanged                               |
| Files route: unknown key/mission    | 404                                                            |
| Files route: containment violation  | 4xx, never 500                                                 |
| Artifact over 1 MiB                 | That artifact fails validation; others still publish           |

### 7. Testing (co-located `node:test` suites, existing patterns)

- `research-mission-lifecycle`: creation registers 4 refs; primary first.
- Store: legacy mission read backfills standard refs, never clobbers.
- Runner: complete publishes 4 Vault entries (ids, tags, provenance);
  checkpoint publishes none; partial publish failure → mission completed +
  `lastError` names failures + refs retryable; passes bump all refs.
- Actions: `publish-artifact` guards (running rejected, published conflicts,
  unknown key 404s), success sets `knowledgeId`/`state`.
- Contract: `renderSourceLedgerMarkdown` content assertions (counts,
  sections, link/claim fields, empty-sources case).
- Files route: ref-backed keys only, 404s, containment.
- UI: card affordances per state, following `research-tab-library.test.ts`
  / `research-tab-desk.test.ts` patterns.

## Out of scope

- Presentation (`.html`) companion artifacts beyond the existing kinds table.
- Writing artifacts anywhere outside the mission workspace or the Vault
  (e.g., auto-copying into `projectRoot`).
- Changing the agent-facing flow prompts or the `@@research-control`
  contract.
- Familiar-type multiselect (queued as the next task this session).
