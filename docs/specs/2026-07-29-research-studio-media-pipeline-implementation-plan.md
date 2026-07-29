# Research Studio Media Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship podcast, short-video, and long-video generations from Research Mission artifacts with reviewable drafts, explicit render configuration, persistent single-flight execution, cancellable child processes, secure seekable media, honest readiness, and requirement-level proof.

**Architecture:** Keep the generation JSON record as the durable source of truth. A media draft persists its extractive script/storyboard, selected provider/voice/length, lifecycle, and coarse progress; an atomic compare-and-set moves it into a per-familiar FIFO queue. A process-local runner drains persisted queued records one at a time, reconstructs the correct pipeline from the record, and writes media through a no-symlink atomic store. Next instrumentation recovers interrupted renders and resumes queued work, while the Studio UI only polls non-terminal rows and gets all capability choices from one readiness endpoint.

**Tech Stack:** TypeScript 6, React 19, Next.js 16 App Router, Node filesystem/child-process/stream APIs, Piper/Kokoro, ElevenLabs, Sharp, ffmpeg/ffprobe, Playwright, plain `node:test` suites through `scripts/run-tests.mjs`, and Coven semantic CSS tokens.

**Execution note:** This repository uses the conservative Beads profile. Run every verification step, but do not commit, push, sync Beads, or close a bead until Val explicitly authorizes it. A bead is not complete merely because its implementation exists as uncommitted local work.

---

## Scope and source of truth

This plan covers the four open issues authored by `BunsDev`:

- `#4021` — epic and cross-phase acceptance.
- `#4022` — contract, queue, drafters, media store.
- `#4023` — podcast, Studio UI, readiness.
- `#4024` — short video, long video, tests/docs.

The durable work queue is:

| Bead | Scope | Live status on 2026-07-29 | Required correction |
| --- | --- | --- | --- |
| `cave-lbi0o` | Epic | open | Keep open through merged closeout |
| `cave-j8mui` | Contract v2 | closed | Reopen until merged and acceptance is re-proved |
| `cave-xqmgo` | Persistent runner | closed | Reopen; current implementation is not a persistent FIFO queue |
| `cave-3nmyw` | Drafters | closed | Reopen until the uncommitted work is delivered |
| `cave-8k9gv` | Media store | closed | Reopen; ancestor symlinks and large-file buffering remain |
| `cave-sczdy` | Podcast | closed | Reopen; provider/voice selection and real E2E proof remain |
| `cave-306jn` | Studio UI | closed | Reopen; configuration, draft resume, and retry semantics remain |
| `cave-h6pro` | Readiness | closed | Reopen; endpoint currently chooses a provider instead of describing choices |
| `cave-qeq97` | Short video | closed | Reopen; ffmpeg is not killed and standalone SVG tokens do not resolve |
| `cave-5s7q2` | Long video | open | Claim only after short-video acceptance passes |
| `cave-qgllg` | Tests/docs | in progress | Keep in progress through final proof and documentation |

No open self-authored implementation PR carried this WIP at the audit point.

## Verified starting state

At the 2026-07-29 audit, the existing WIP was in
`.worktrees/feat-research-media-contract` on `feat/research-media-contract`. It
was 41 commits behind `origin/main`, had 14 modified tracked files plus the new
route/pipeline files, and had no commit or PR. Only `scripts/run-tests.mjs`
overlapped the relevant upstream changes, so the WIP should be rebased and that
file reconciled by hand.

Current local checks pass:

- `git diff --check`
- `pnpm typecheck`
- `pnpm check:tests-wired` (`1342` files wired)
- 13 targeted Research Studio/media test files

Those checks are a baseline, not acceptance proof. The current tests mostly
exercise pure helpers, source pins, and mocked UI routes. The following
acceptance-breaking gaps were verified in code:

1. Creation stores media as `draft`, while `enqueueResearchMediaJob()` accepts
   only `queued`; the render route never performs the transition.
2. Provider, voice, and length are neither accepted by the create contract nor
   persisted on the draft. The render route silently chooses readiness's
   preferred provider.
3. A kept draft has no row action to reopen review. Failed-row Retry creates
   another draft, announces it as queued, and strands it.
4. The runner refuses a second job instead of persisting a FIFO queue.
5. Recovery runs lazily from a list request and waits 15 minutes; startup does
   not resume queued work.
6. Short-video cancellation aborts TTS but not `ffmpeg`.
7. Standalone SVGs passed to Sharp contain unresolved CSS `var(...)` colors.
8. Video output is read wholly into memory before a second write, despite the
   500 MB cap.
9. The store rejects a symlink at the final file but not symlinked familiar or
   generation directories.
10. Readiness reports one chosen provider instead of all available providers
    and voices.
11. The daemonless Playwright test mocks render completion and covers only the
    podcast UI path.
12. Long video is not implemented, and the persisted progress model cannot
    express chapters.

## Product and architecture decisions

These decisions remove ambiguity before implementation:

1. **Review stays extractive and read-only.** This issue requires a durable
   draft-then-render review, not an editor. A draft row always offers **Review
   draft**. Editing source narration would require a separate authored-content
   contract and is outside this issue.
2. **Configuration is frozen on the draft.** Media create requires a
   kind-matching `{ provider, voice, length }`. The review shows those values;
   the job never reselects a provider later. Existing WIP media drafts without
   configuration remain reviewable but cannot render until reconfigured by
   creating a replacement draft.
3. **Lengths are bounded presets, not fake promises.**
   - Podcast: `brief` (about 3 minutes), `standard` (about 8), `extended`
     (about 15).
   - Short video: `brief` (up to 30 seconds), `standard` (up to 60); never over
     60 seconds.
   - Long video: `brief` (up to 5 minutes), `standard` (up to 10), `extended`
     (up to 20).
   Drafters use deterministic character/scene budgets; the rendered duration is
   measured and hard-capped before publication.
4. **Queue means persisted FIFO plus single-flight execution.** Any number of
   records may be `queued`, but only one record per familiar may be
   `rendering`. FIFO is oldest `updatedAt`, then `id`. Cancelling a queued item
   removes it from the queue; completion starts the next item.
5. **Recovery distinguishes queued from interrupted.** Startup leaves `queued`
   records queued and resumes them. A `rendering` record from an earlier
   process becomes `failed` immediately with `interrupted by restart`; it is
   never shown as live.
6. **Cancellation owns every subprocess.** TTS and ffmpeg share one
   `AbortSignal`. ffmpeg receives `SIGTERM`, then `SIGKILL` after a bounded
   grace period if needed. A cancelled job cannot publish media afterward.
7. **Large video publication is file-to-file.** Pipelines render to a private
   temporary file; the media store streams it to a same-directory temporary
   file while enforcing the size cap, then atomically renames it. It never
   materializes a 500 MB `Uint8Array`.
8. **Rendered slides use resolved server colors.** The video renderer owns a
   small named render palette whose concrete values are sourced from the
   default Coven token contract. A standalone SVG contains concrete colors,
   not browser-only CSS variables.
9. **Readiness describes choices; it does not make choices.** It returns ready
   local voices, whether ElevenLabs is configured, and ffmpeg/ffprobe state.
   The persisted config selects an available provider and voice.
10. **Long video reuses short-video primitives.** H2 sections become chapters,
    each chapter uses the same still/TTS/encode seam, and the final MP4 is a
    concat of chapter files. Progress is `{ current, total, label }` at chapter
    granularity.

## File map

### Shared contract and persistence

- Modify `src/lib/research-generations.ts` — media config, readiness, progress,
  validators, response types, and client fetchers.
- Modify `src/lib/research-generations.test.ts` — type/validation/migration
  contract tests.
- Modify `src/lib/server/research-generations.ts` — config-aware drafting,
  long-video chapter drafting, atomic compare-and-set transitions.
- Modify `src/lib/server/research-generations.test.ts` — migration, budgets,
  chapters, and transition races.

### Runner and pipelines

- Create `src/lib/server/research-media-job-contract.ts` — dependency-neutral
  job context/definition types.
- Modify `src/lib/server/research-media-jobs.ts` — persisted FIFO draining,
  cancellation, startup, and recovery.
- Modify `src/lib/server/research-media-jobs.test.ts` — FIFO, atomicity,
  cancellation, restart, and drain tests.
- Create `src/lib/server/research-media-job-factory.ts` — reconstruct the
  podcast/short/long definition from one persisted record.
- Create `src/lib/server/research-media-job-factory.test.ts` — kind/config
  dispatch tests.
- Modify `src/lib/server/research-podcast-pipeline.ts` and its test — consume
  frozen config and retain cancellation/metadata.
- Create `src/lib/server/research-video-renderer.ts` and its test — resolved
  palette, PNG rendering, abortable ffmpeg/ffprobe, and atomic file output.
- Modify `src/lib/server/research-short-video-pipeline.ts` and its test — use
  the shared renderer and enforce duration/config caps.
- Create `src/lib/server/research-long-video-pipeline.ts` and its test —
  chapter rendering, progress, concat, and caps.

### Media/readiness API

- Modify `src/lib/server/research-media-store.ts` and its test — no-symlink
  directory chain, safe file handles, streaming publication, range metadata.
- Modify `scripts/cross-environment.test.ts` — keep the no-follow fallback
  explicit on Windows.
- Modify `src/lib/server/research-media-readiness.ts` and its test — all
  provider/voice/ffmpeg choices.
- Modify `src/app/api/research/generations/route.ts` and its test — validate and
  persist config on draft.
- Modify `src/app/api/research/generations/render/route.ts` and its test —
  atomic draft-to-queued command.
- Modify `src/app/api/research/generations/cancel/route.ts` and its test —
  queued/rendering cancellation.
- Modify `src/app/api/research/generations/media/route.ts` and its test — safe
  handle-backed range streaming and download disposition.
- Modify `src/app/api/research/generations/readiness/route.ts` and its test —
  new readiness shape.
- Modify `instrumentation.ts` and `src/app/root-shell-startup.test.ts` —
  non-blocking runner startup.

### Studio and proof

- Modify `src/components/role-surfaces/research-tab-studio.tsx` — config state,
  draft resume, honest retry, queue/progress polling.
- Modify `src/components/role-surfaces/research-studio-modals.tsx` — provider,
  voice, length, review metadata, players, and download.
- Modify `src/components/role-surfaces/research-tab-studio.test.ts` — source
  contract and interaction pins.
- Modify `src/styles/globals/surface-research-studio.css` — token-only states
  and responsive fields.
- Create `src/lib/server/research-media-lifecycle.integration.test.ts` — real
  mission artifact → draft → queue → ready lifecycle with controlled TTS/video
  dependencies.
- Create `scripts/research-media-ffmpeg.integration.test.mjs` — opt-in real
  ffmpeg/ffprobe MP4 proof.
- Modify `tests/research-studio-media.spec.ts` — daemonless UI states for all
  media kinds.
- Modify `tests/research-desk-tabs.spec.ts`, `src/app/api/api-contracts.test.ts`,
  and `scripts/run-tests.mjs` — route/test registration.
- Modify `docs/research-desk-app-redesign-plan.md` and
  `docs/specs/research-generations-media-contract-v2.md` — final contract and
  issue links.

---

## Task 0: Preserve the WIP, rebase it, and reconcile Beads

**Files:** No product files. Beads records and the dedicated worktree only.

- [ ] **Step 1: Confirm live ownership and preserve the exact dirty set**

Run from `.worktrees/feat-research-media-contract`:

```bash
git fetch origin
git status --short --branch
git diff --check
git stash push --include-untracked -m "research-media-wip-before-origin-main-rebase-2026-07-29"
git stash list --format="%gd %s"
```

Expected: one named stash contains every tracked and untracked media file; the
worktree is clean. Do not touch unrelated state in the canonical checkout.

- [ ] **Step 2: Rebase the transport branch and restore the WIP**

```bash
git rebase origin/main
git stash pop
git status --short --branch
```

Expected: only `scripts/run-tests.mjs` requires semantic reconciliation. Keep
every upstream test entry and add the media tests in their sorted suite
locations. If any other file conflicts, stop and compare both sides before
editing.

- [ ] **Step 3: Reopen prematurely closed Beads**

```bash
bd reopen cave-j8mui cave-xqmgo cave-3nmyw cave-8k9gv cave-sczdy cave-306jn cave-h6pro cave-qeq97 --reason "Implementation exists only as uncommitted WIP and issue acceptance is not yet proved or merged."
bd update cave-qgllg --append-notes "Implementation plan: docs/specs/2026-07-29-research-studio-media-pipeline-implementation-plan.md. Keep open through requirement-level closeout."
bd show cave-lbi0o
bd show cave-qgllg
```

Expected: the eight delivery beads are open, the closeout bead remains in
progress, and the epic remains open.

- [ ] **Step 4: Re-run the preserved baseline**

```bash
git diff --check
pnpm typecheck
pnpm check:tests-wired
```

Expected: all pass from the rebased worktree.

## Task 1: Make media configuration and progress part of the durable contract

**Files:**

- Modify `src/lib/research-generations.ts:20-230,341-440`
- Modify `src/lib/research-generations.test.ts`
- Modify `src/lib/server/research-generations.ts:75-280,610-870`
- Modify `src/lib/server/research-generations.test.ts`

- [ ] **Step 1: Add failing contract tests**

Add assertions that:

```ts
const podcastConfig = validateResearchMediaRenderConfig("podcast", {
  provider: "local",
  voice: "piper-lessac-medium",
  length: "standard",
});
assert.deepEqual(podcastConfig, {
  ok: true,
  value: {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "standard",
  },
});
assert.equal(
  validateResearchMediaRenderConfig("short-video", {
    provider: "local",
    voice: "piper-lessac-medium",
    length: "extended",
  }).ok,
  false,
);
assert.equal(
  isResearchGenerationProgress({
    unit: "chapter",
    current: 2,
    total: 4,
    label: "Methods",
  }),
  true,
);
```

Add server tests proving:

- media drafts persist the validated config;
- old v1 extractive rows still normalize to v2;
- an old WIP v2 media row without `renderConfig` remains readable but is not
  renderable;
- long-video H2s become ordered chapters;
- two simultaneous compare-and-set calls from `draft` produce exactly one
  winner.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/research-generations.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-generations.test.ts
```

Expected: failures name missing render config/progress validators, chapter
content, and atomic transition helpers.

- [ ] **Step 3: Define the exact persisted types**

Add:

```ts
export type ResearchMediaProvider = "local" | "elevenlabs";
export type ResearchMediaLength = "brief" | "standard" | "extended";

export type ResearchMediaRenderConfig = {
  provider: ResearchMediaProvider;
  voice: string;
  length: ResearchMediaLength;
};

export type ResearchGenerationProgress = {
  unit: "chapter";
  current: number;
  total: number;
  label: string;
};

export type ResearchGenerationVideoChapter = {
  id: string;
  title: string;
  scenes: ResearchGenerationStoryboardScene[];
};
```

Change long-video content to:

```ts
| {
    kind: "long-video";
    chapters: ResearchGenerationVideoChapter[];
    video?: ResearchGenerationMediaFileRef;
  };
```

Add optional `renderConfig` and `progress` to `ResearchGeneration`. They are
optional only so old WIP records survive normalization; every newly created
media draft must have `renderConfig`.

- [ ] **Step 4: Add bounded config/content validation**

Implement `validateResearchMediaRenderConfig(kind, value)` with these rules:

- provider must be `local` or `elevenlabs`;
- voice is trimmed, non-empty, and at most 128 characters;
- short video accepts only `brief|standard`;
- podcast and long video accept all three presets;
- extractive kinds reject media config;
- progress requires `1 <= current <= total <= 64` and a 1–120 character label.

Update `validateCreateResearchGenerationInput()` to require `renderConfig` for
media kinds and reject it for extractive kinds. Update
`isResearchGenerationContent()` for long-video chapters and validate every
stored media reference's provider/voice fields.

- [ ] **Step 5: Make drafting honor deterministic preset budgets**

Use a constant map:

```ts
export const RESEARCH_MEDIA_LENGTH_LIMITS = {
  podcast: {
    brief: { maxCharacters: 2_700 },
    standard: { maxCharacters: 7_200 },
    extended: { maxCharacters: 13_500 },
  },
  "short-video": {
    brief: { maxDurationMs: 30_000, maxScenes: 6 },
    standard: { maxDurationMs: 60_000, maxScenes: 12 },
  },
  "long-video": {
    brief: { maxDurationMs: 300_000, maxChapters: 4 },
    standard: { maxDurationMs: 600_000, maxChapters: 8 },
    extended: { maxDurationMs: 1_200_000, maxChapters: 12 },
  },
} as const;
```

Podcast truncates at a segment boundary within the character budget. Short
video truncates scenes to its preset. Long video groups H2 sections and their
following subordinate sections into chapters, preserving source order and
verbatim text.

- [ ] **Step 6: Add an atomic transition primitive**

Add a mutex-protected compare-and-set:

```ts
export async function transitionResearchGeneration(
  familiarId: string,
  id: string,
  expected: readonly ResearchGenerationStatus[],
  update: ResearchGenerationUpdate,
): Promise<
  | { ok: true; generation: ResearchGeneration }
  | { ok: false; code: "not-found" | "invalid-state"; generation?: ResearchGeneration }
>;
```

The function loads, checks status, validates config/content/progress, writes
once, and returns the exact persisted row. Extend `ResearchGenerationUpdate`
with `renderConfig` and `progress`; clearing uses `null`.

- [ ] **Step 7: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/research-generations.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-generations.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit after authorization**

```bash
git add src/lib/research-generations.ts src/lib/research-generations.test.ts src/lib/server/research-generations.ts src/lib/server/research-generations.test.ts
git commit -S -m "feat(research): persist media render configuration"
```

## Task 2: Implement the persisted FIFO runner and startup recovery

**Files:**

- Create `src/lib/server/research-media-job-contract.ts`
- Modify `src/lib/server/research-media-jobs.ts`
- Modify `src/lib/server/research-media-jobs.test.ts`
- Modify `instrumentation.ts`
- Modify `src/app/root-shell-startup.test.ts`

- [ ] **Step 1: Add failing queue/recovery tests**

Cover these exact sequences:

```ts
// FIFO: both rows persist as queued; only the first runs.
await queueResearchMediaGeneration(familiarId, firstId, fakeFactory);
await queueResearchMediaGeneration(familiarId, secondId, fakeFactory);
assert.deepEqual(
  (await listResearchGenerations(familiarId))
    .filter((row) => row.status === "queued" || row.status === "rendering")
    .map((row) => row.id),
  [secondId, firstId],
);

// A second render request for the same draft loses the CAS.
const outcomes = await Promise.all([
  queueResearchMediaGeneration(familiarId, draftId, fakeFactory),
  queueResearchMediaGeneration(familiarId, draftId, fakeFactory),
]);
assert.equal(outcomes.filter((result) => result.ok).length, 1);
```

Also prove:

- completion automatically drains the next queued record;
- cancelling queued work never starts it;
- cancelling active work calls `kill()` exactly once and terminal state cannot
  be overwritten by a late result;
- startup converts old `rendering` rows to failed immediately;
- startup preserves and drains queued rows;
- startup is idempotent under repeated instrumentation/route calls.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-jobs.test.ts
```

Expected: FIFO, CAS, and startup tests fail against the in-memory-only runner.

- [ ] **Step 3: Move the neutral job types out of the runner**

Create:

```ts
import type {
  ResearchGeneration,
  ResearchGenerationContent,
  ResearchGenerationMediaKind,
  ResearchGenerationProgress,
  ResearchGenerationStage,
} from "../research-generations.ts";

export type MediaGenerationContent = Extract<
  ResearchGenerationContent,
  { kind: ResearchGenerationMediaKind }
>;

export type ResearchMediaJobContext = {
  reportStage: (
    stage: ResearchGenerationStage,
    progress?: ResearchGenerationProgress,
  ) => Promise<void>;
  signal: AbortSignal;
  isCancellationRequested: () => boolean;
};

export type ResearchMediaJobDefinition = {
  familiarId: string;
  generationId: string;
  run: (
    context: ResearchMediaJobContext,
  ) => Promise<{ content: MediaGenerationContent }>;
  kill?: () => void;
};

export type ResearchMediaQueueResult =
  | {
      ok: true;
      generation: ResearchGeneration;
      done: Promise<void>;
    }
  | {
      ok: false;
      code: "not-found" | "not-media" | "invalid-state" | "invalid-draft";
      error: string;
      generation?: ResearchGeneration;
    };
```

Pipelines import this file, preventing a runner→factory→pipeline→runner cycle.

- [ ] **Step 4: Replace rejection with persisted FIFO draining**

Expose:

```ts
export type ResearchMediaJobFactory = (
  generation: ResearchGeneration,
) => ResearchMediaJobDefinition;

export async function queueResearchMediaGeneration(
  familiarId: string,
  generationId: string,
  factory?: ResearchMediaJobFactory,
): Promise<ResearchMediaQueueResult>;

export async function cancelResearchMediaJob(
  familiarId: string,
  generationId: string,
): Promise<boolean>;

export function startResearchMediaJobs(
  factory?: ResearchMediaJobFactory,
): Promise<void>;
```

`queueResearchMediaGeneration()` atomically transitions `draft → queued`,
returns the queued row, then starts a non-blocking drain. The drain selects the
oldest queued row for a familiar, atomically claims `queued → rendering`, and
stores one active handle per familiar in a `globalThis` map. `finally` removes
the handle and drains again. A per-generation deferred in the same global map
backs `done`; it resolves when that queued record reaches a terminal state and
is never persisted.

- [ ] **Step 5: Make recovery process-aware and non-blocking**

`startResearchMediaJobs()` owns a `globalThis` startup promise. On first call:

1. scan all familiar stores;
2. mark pre-start `rendering` records failed with `interrupted by restart`;
3. leave queued records intact;
4. schedule one drain per familiar;
5. resolve without waiting for renders to finish.

Remove the 15-minute age heuristic. Keep a route-level `void
startResearchMediaJobs()` fallback, but do not put recovery in every GET.

- [ ] **Step 6: Wire Next startup without delaying shell registration**

In `instrumentation.ts`, follow the existing migration pattern:

```ts
try {
  const mediaJobs = await import("@/lib/server/research-media-jobs");
  void mediaJobs.startResearchMediaJobs().catch((error) => {
    console.warn("[instrumentation] research media jobs failed to start:", error);
  });
} catch (error) {
  console.warn("[instrumentation] research media jobs could not start:", error);
}
```

Extend `root-shell-startup.test.ts` to require the `void ...catch` form and to
reject `await mediaJobs.startResearchMediaJobs()`.

- [ ] **Step 7: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-jobs.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/root-shell-startup.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit after authorization**

```bash
git add instrumentation.ts src/app/root-shell-startup.test.ts src/lib/server/research-media-job-contract.ts src/lib/server/research-media-jobs.ts src/lib/server/research-media-jobs.test.ts
git commit -S -m "feat(research): persist and recover media render queues"
```

## Task 3: Harden the media store and stream large outputs

**Files:**

- Modify `src/lib/server/research-media-store.ts`
- Modify `src/lib/server/research-media-store.test.ts`
- Modify `src/app/api/research/generations/media/route.ts`
- Modify `src/app/api/research/generations/media/route.test.ts`
- Modify `scripts/cross-environment.test.ts`

- [ ] **Step 1: Add failing filesystem tests**

Use temporary roots to prove:

- a symlinked familiar directory is rejected;
- a symlinked generation directory is rejected;
- a final symlink is rejected;
- a source file growing past its cap during copy fails and leaves no target;
- a failed copy leaves no `.tmp-*` file;
- an atomic publish replaces only the exact target;
- a read returns an open no-follow handle plus stable stat metadata;
- removal refuses to recursively operate through a symlink.

Add range cases for `bytes=0-0`, `bytes=10-`, `bytes=-128`, out-of-range, an
empty suffix, and multipart ranges.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-store.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/media/route.test.ts
```

Expected: ancestor-symlink and streaming-publication assertions fail.

- [ ] **Step 3: Add safe directory and file-handle primitives**

Use `lstat`, `realpath`, and `open` with `O_NOFOLLOW`:

```ts
export type OpenResearchMedia = ResearchGenerationMediaFileRef & {
  handle: FileHandle;
};

export async function openResearchGenerationMedia(
  familiarId: string,
  generationId: string,
  key: string,
): Promise<OpenResearchMedia>;
```

Create/validate root → familiar → generation one component at a time. Every
component below the configured root must be a real directory, never a symlink,
and its `realpath` must remain inside the configured root's `realpath`.
Open with `constants.O_NOFOLLOW` where the platform exposes it; on Windows,
retain the pre-open `lstat` plus post-open `FileHandle.stat()` containment
check. Add the same adversarial cases to the repository's Windows
cross-environment test surface so the fallback is deliberate rather than an
untested flag omission.

- [ ] **Step 4: Add streaming atomic publication**

Keep the byte writer for bounded WAVs and add:

```ts
export async function publishResearchGenerationMediaFile(input: {
  familiarId: string;
  generationId: string;
  key: string;
  mimeType: "video/mp4";
  sourcePath: string;
  durationMs: number;
}): Promise<ResearchGenerationMediaFileRef>;
```

Open `sourcePath` without following its final symlink, stream into an exclusive
temporary file beside the target, count bytes while streaming, abort above 500
MB, `fsync`, close, and rename. Stat the final file and return its measured
size.

- [ ] **Step 5: Serve ranges from the safe open handle**

Export a pure `parseResearchMediaRange()` helper. The route creates a stream
from `handle.createReadStream({ start, end, autoClose: true })`, returns `206`
with `Content-Range` for valid ranges, `416` for malformed/unsatisfiable
ranges, and supports `download=1` with a safe `Content-Disposition:
attachment`.

- [ ] **Step 6: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-store.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/media/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types scripts/cross-environment.test.ts
pnpm typecheck
```

Expected: all pass and no test leaves data outside its temporary root.

- [ ] **Step 7: Commit after authorization**

```bash
git add src/lib/server/research-media-store.ts src/lib/server/research-media-store.test.ts src/app/api/research/generations/media/route.ts src/app/api/research/generations/media/route.test.ts scripts/cross-environment.test.ts
git commit -S -m "fix(research): harden media storage and streaming"
```

## Task 4: Make readiness describe all valid render choices

**Files:**

- Modify `src/lib/server/research-media-readiness.ts`
- Modify `src/lib/server/research-media-readiness.test.ts`
- Modify `src/lib/research-generations.ts`
- Modify `src/app/api/research/generations/readiness/route.ts`
- Modify `src/app/api/research/generations/readiness/route.test.ts`

- [ ] **Step 1: Add failing readiness tests**

Assert the endpoint can simultaneously report:

```ts
{
  providers: {
    local: {
      ready: true,
      voices: [
        { id: "piper-lessac-medium", name: "Piper Lessac", engine: "piper" },
      ],
    },
    elevenlabs: {
      ready: true,
      defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID,
    },
  },
  ffmpeg: { ready: true },
  podcast: { ready: true },
  shortVideo: { ready: true },
  longVideo: { ready: true },
}
```

Also prove actionable hints for no voice/key, no ffmpeg, and ffprobe missing.
The endpoint must never return a `via` selection.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-readiness.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/readiness/route.test.ts
```

Expected: the old single-provider readiness shape fails.

- [ ] **Step 3: Implement the new readiness response**

Return all verified `speech.tts` voices with only client-safe fields
`id`, `name`, and `engine`. Report ElevenLabs as configured based on Vault key
presence, not a network call. Probe both:

```ts
await execFileAsync("ffmpeg", ["-version"], probeOptions);
await execFileAsync("ffprobe", ["-version"], probeOptions);
```

Podcast is ready when either provider is ready. Both video kinds require a
provider plus ffmpeg and ffprobe. Each false state carries one concrete next
step.

- [ ] **Step 4: Add server-side config/readiness matching**

Add:

```ts
export function validateResearchMediaSelection(
  kind: ResearchGenerationMediaKind,
  config: ResearchMediaRenderConfig,
  readiness: ResearchMediaReadiness,
): { ok: true } | { ok: false; error: string };
```

Local requires the selected ready voice id. ElevenLabs requires the Vault key
and a valid ElevenLabs voice id. Video additionally requires ffmpeg/ffprobe.
The create route and render route both call this function so readiness cannot
drift between draft and approval.

- [ ] **Step 5: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-readiness.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/readiness/route.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit after authorization**

```bash
git add src/lib/research-generations.ts src/lib/server/research-media-readiness.ts src/lib/server/research-media-readiness.test.ts src/app/api/research/generations/readiness/route.ts src/app/api/research/generations/readiness/route.test.ts
git commit -S -m "feat(research): expose media provider readiness"
```

## Task 5: Finish the podcast pipeline with frozen provider/voice choices

**Files:**

- Modify `src/lib/server/research-podcast-pipeline.ts`
- Modify `src/lib/server/research-podcast-pipeline.test.ts`

- [ ] **Step 1: Add failing pipeline tests**

Prove:

- local config calls the exact selected Piper/Kokoro voice;
- ElevenLabs config calls the exact validated voice id;
- segment failures name their 1-based index;
- cancellation aborts an in-flight synthesis and removes partial media;
- output metadata contains measured duration, provider, and voice;
- output over 50 MB fails without publishing a ref;
- every preset's character budget is respected before synthesis.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-podcast-pipeline.test.ts
```

Expected: frozen config/voice and shared signal assertions fail.

- [ ] **Step 3: Consume `renderConfig` without fallback selection**

Change `PodcastMediaJobInput` to require:

```ts
type PodcastMediaJobInput = {
  familiarId: string;
  generationId: string;
  script: ResearchGenerationScriptSegment[];
  renderConfig: ResearchMediaRenderConfig;
};
```

Remove `provider ?? "local"`. Use `context.signal` for all synthesis and make
`kill()` abort the same controller if the pipeline retains its own cleanup
controller. Record the resolved local voice only if it equals the requested
voice.

- [ ] **Step 4: Keep WAV assembly bounded and honest**

Validate PCM compatibility, concatenate exactly once, measure duration from
the final header, publish with the bounded byte writer, and remove the media
directory if cancellation arrives before the runner commits `ready`.

- [ ] **Step 5: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-podcast-pipeline.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit after authorization**

```bash
git add src/lib/server/research-podcast-pipeline.ts src/lib/server/research-podcast-pipeline.test.ts
git commit -S -m "feat(research): render configured podcast drafts"
```

## Task 6: Build the shared video renderer and repair short-video cancellation

**Files:**

- Create `src/lib/server/research-video-renderer.ts`
- Create `src/lib/server/research-video-renderer.test.ts`
- Modify `src/lib/server/research-short-video-pipeline.ts`
- Modify `src/lib/server/research-short-video-pipeline.test.ts`

- [ ] **Step 1: Add failing renderer tests**

Prove:

- generated SVG contains no `var(` token and has concrete palette values;
- Sharp emits a non-transparent 1280×720 PNG whose sampled background/accent
  pixels differ;
- ffmpeg receives H.264, AAC, `yuv420p`, `+faststart`, and the supplied abort
  signal;
- abort sends `SIGTERM`, escalates to `SIGKILL` after the grace period, and
  rejects with an abort-class error;
- ffprobe validates video/audio codecs, dimensions, and duration;
- output publication uses the file-stream API, never `readFile(outputPath)`.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-video-renderer.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-short-video-pipeline.test.ts
```

Expected: unresolved token, process kill, and whole-file buffering tests fail.

- [ ] **Step 3: Add a concrete server render palette**

Define a small palette with comments pointing to
`src/styles/globals/foundations.css`:

```ts
export const COVEN_VIDEO_RENDER_PALETTE = {
  background: "oklch(0.225 0.004 291)",
  accent: "#9386d0",
  primaryText: "oklch(0.985 0 0)",
  secondaryText: "oklch(0.66 0.010 291)",
} as const;
```

`storyboardSceneToSvg(scene, palette)` interpolates escaped concrete values.
This server artifact is not render JSX/CSS and cannot inherit a browser theme.
The renderer test reads `foundations.css` and pins all four values to the
default Coven token declarations so this concrete asset palette cannot drift
silently.

- [ ] **Step 4: Implement abortable child ownership**

Use `spawn("ffmpeg", args, { cwd, stdio: [...] })`, capture bounded stderr, and
attach one abort listener. On abort, send `SIGTERM`; after 2 seconds send
`SIGKILL` if `exitCode` is still null. Always remove listeners/timers.

Implement the same command wrapper for `ffprobe` without a kill escalation
because it is short-lived and receives the same abort signal.

- [ ] **Step 5: Extract one reusable sequence renderer**

Expose:

```ts
export async function renderResearchVideoSequence(input: {
  scenes: ResearchGenerationStoryboardScene[];
  provider: ResearchMediaProvider;
  voice: string;
  maxDurationMs: number;
  outputPath: string;
  workDir: string;
  signal: AbortSignal;
  reportStage: ResearchMediaJobContext["reportStage"];
}): Promise<{ durationMs: number; provider: ResearchMediaProvider; voice: string }>;
```

It synthesizes each scene, writes concrete PNGs, writes one PCM WAV, creates
the concat manifest, runs ffmpeg, probes the result, and rejects output outside
1280×720, H.264/AAC, or the supplied duration cap.

- [ ] **Step 6: Make short video a thin configured wrapper**

Require `renderConfig`, map `brief|standard` to 30/60 seconds, call the shared
renderer, then publish the output with
`publishResearchGenerationMediaFile()`. `kill()` aborts the shared signal, so
it owns both TTS and ffmpeg.

- [ ] **Step 7: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-video-renderer.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-short-video-pipeline.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit after authorization**

```bash
git add src/lib/server/research-video-renderer.ts src/lib/server/research-video-renderer.test.ts src/lib/server/research-short-video-pipeline.ts src/lib/server/research-short-video-pipeline.test.ts
git commit -S -m "fix(research): make short-video rendering cancellable"
```

## Task 7: Wire the factory and real draft-to-queue API lifecycle

**Files:**

- Create `src/lib/server/research-media-job-factory.ts`
- Create `src/lib/server/research-media-job-factory.test.ts`
- Modify `src/app/api/research/generations/route.ts`
- Modify `src/app/api/research/generations/route.test.ts`
- Modify `src/app/api/research/generations/render/route.ts`
- Modify `src/app/api/research/generations/render/route.test.ts`
- Modify `src/app/api/research/generations/cancel/route.ts`
- Modify `src/app/api/research/generations/cancel/route.test.ts`

- [ ] **Step 1: Add failing dispatch and lifecycle tests**

Factory tests require an exact matching config/content pair and reject missing
config, mismatched content, or unsupported kind.

Add a server lifecycle test that seeds a real temporary Research Mission and
artifact, then executes:

```ts
const drafted = await createResearchMediaGenerationFromMission(input);
assert.equal(drafted.ok && drafted.generation.status, "draft");

const queued = await queueResearchMediaGeneration(
  familiarId,
  drafted.ok ? drafted.generation.id : "",
  fakeFactory,
);
assert.equal(queued.ok && queued.generation.status, "queued");

await queued.done;
const [ready] = await listResearchGenerations(familiarId);
assert.equal(ready.status, "ready");
assert.equal(ready.content?.kind, "podcast");
```

The same test calls queue twice and expects the second response to be a `409`
equivalent invalid-state result.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-job-factory.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/render/route.test.ts
```

Expected: factory and real draft→queued assertions fail.

- [ ] **Step 3: Implement the production job factory**

Dispatch exhaustively:

```ts
switch (generation.kind) {
  case "podcast":
    return createPodcastMediaJobDefinition({ ...common, script, renderConfig });
  case "short-video":
    return createShortVideoMediaJobDefinition({ ...common, storyboard, renderConfig });
  case "long-video":
    return createLongVideoMediaJobDefinition({ ...common, chapters, renderConfig });
  default:
    throw new Error("generation is not a renderable media draft");
}
```

Do not read readiness or choose defaults in the factory.

- [ ] **Step 4: Validate configuration when drafting**

The create route:

1. validates request shape;
2. obtains readiness;
3. validates the selected provider/voice/kind;
4. creates and returns a `draft`.

It never queues automatically.

- [ ] **Step 5: Make render one atomic command**

The render route:

1. loads the draft;
2. verifies current readiness still permits its persisted config;
3. calls `queueResearchMediaGeneration()`;
4. maps not found to 404 and invalid state/readiness to 409;
5. returns the exact persisted queued record.

Delete the old `list → check draft → enqueue(definition)` path. The route
never manually writes `queued` and never supplies provider defaults.

- [ ] **Step 6: Keep cancellation status-specific**

Cancel accepts `queued|rendering`, returns 409 for
`draft|ready|failed|cancelled`, and returns the persisted cancelled row so the
client does not manufacture state.

- [ ] **Step 7: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-job-factory.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/render/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/research/generations/cancel/route.test.ts
pnpm typecheck
```

Expected: all pass, including the real draft→queued lifecycle.

- [ ] **Step 8: Commit after authorization**

```bash
git add src/lib/server/research-media-job-factory.ts src/lib/server/research-media-job-factory.test.ts src/app/api/research/generations/route.ts src/app/api/research/generations/route.test.ts src/app/api/research/generations/render/route.ts src/app/api/research/generations/render/route.test.ts src/app/api/research/generations/cancel/route.ts src/app/api/research/generations/cancel/route.test.ts
git commit -S -m "feat(research): queue reviewed media drafts atomically"
```

## Task 8: Complete Studio configuration, draft resume, retry, players, and download

**Files:**

- Modify `src/components/role-surfaces/research-tab-studio.tsx`
- Modify `src/components/role-surfaces/research-studio-modals.tsx`
- Modify `src/components/role-surfaces/research-tab-studio.test.ts`
- Modify `src/styles/globals/surface-research-studio.css`

- [ ] **Step 1: Add failing UI contract tests**

Pin these visible behaviors:

- provider options come only from readiness;
- local provider exposes a labelled select of ready local voices;
- ElevenLabs exposes a labelled voice-id field with its configured default;
- length options are kind-specific;
- create sends `{ renderConfig }`;
- a draft row exposes **Review draft**;
- failed Retry creates a new draft, opens review, and announces **draft ready
  for review**;
- queued/rendering rows show stage and FIFO state, with chapter progress when
  present;
- polling runs only while queued/rendering rows exist;
- audio/video controls use the local media route;
- download appends `download=1`;
- completion/cancel/failure announcements use the visible action vocabulary;
- modal focus trap, return, Escape, labels, help/error associations, and
  reduced-motion remain intact.

- [ ] **Step 2: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/role-surfaces/research-tab-studio.test.ts
```

Expected: provider/voice/length, draft resume, and retry assertions fail.

- [ ] **Step 3: Add controlled render-configuration state**

Track:

```ts
const [mediaProvider, setMediaProvider] =
  useState<ResearchMediaProvider>("local");
const [mediaVoice, setMediaVoice] = useState("");
const [mediaLength, setMediaLength] =
  useState<ResearchMediaLength>("standard");
```

When a media card opens, select the first available provider and its first
ready voice. Never switch a user's valid selection when readiness refreshes.
Reset `extended` to `standard` when opening short video.

- [ ] **Step 4: Render accessible configuration fields**

`GenerationConfigModal` receives readiness and the controlled values. Every
field has a persistent label, `aria-describedby` help, and a specific inline
repair error. Provider is a labelled select, local voice is a labelled select,
ElevenLabs voice is a labelled text field, and length is a labelled select.
Extractive modals render none of those fields.

- [ ] **Step 5: Repair draft and retry lifecycle**

For a media `draft`, show **Review draft** in the row actions and reopen
`GenerationReviewModal`. Retry creates a replacement draft with the original
config, inserts it once, opens review, and announces:

```ts
announce(`${label} draft ready for review`);
```

Do not announce queued until the render endpoint returns a queued row.

- [ ] **Step 6: Render honest progress and media actions**

Use:

```ts
function generationStatusText(generation: ResearchGeneration): string {
  if (generation.status === "queued") return "Waiting to render";
  if (generation.status === "rendering" && generation.progress) {
    return `${stageLabel(generation.stage)} · Chapter ${generation.progress.current} of ${generation.progress.total}: ${generation.progress.label}`;
  }
  // Retain the existing terminal/status mappings.
}
```

Ready podcast uses `<audio controls preload="metadata">`; ready videos use
`<video controls preload="metadata">`. Both receive a **Download** link to the
same local-only media route with `download=1`.

- [ ] **Step 7: Style within the design contract**

Reuse existing modal/control classes and semantic tokens. Add no raw render
colors, off-grid spacing, or new radii. Preserve the three-action chrome budget,
`.focus-ring`, token state tints, container behavior, and global reduced-motion
fallback.

- [ ] **Step 8: Run GREEN and design gates**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/components/role-surfaces/research-tab-studio.test.ts
pnpm codemod:design:check
pnpm lint
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit after authorization**

```bash
git add src/components/role-surfaces/research-tab-studio.tsx src/components/role-surfaces/research-studio-modals.tsx src/components/role-surfaces/research-tab-studio.test.ts src/styles/globals/surface-research-studio.css
git commit -S -m "feat(research): configure and review Studio media"
```

## Task 9: Implement chaptered long-video rendering

**Dependency:** Do not claim `cave-5s7q2` until Tasks 1–8 pass and the
short-video real ffmpeg proof in Task 10 passes.

**Files:**

- Create `src/lib/server/research-long-video-pipeline.ts`
- Create `src/lib/server/research-long-video-pipeline.test.ts`
- Modify `src/lib/server/research-media-job-factory.ts`
- Modify `src/lib/server/research-media-job-factory.test.ts`

- [ ] **Step 1: Claim the long-video bead**

```bash
bd update cave-5s7q2 --claim
bd update cave-5s7q2 --append-notes "Depends on verified short-video renderer; implementation plan Task 9."
```

Expected: exactly this bead moves to in progress.

- [ ] **Step 2: Add failing chapter tests**

Prove:

- chapters render in source H2 order;
- each chapter reports `{ current, total, label }`;
- each chapter uses the shared video renderer;
- a failure names its chapter and leaves no published final file;
- cancellation during any chapter kills the active child and skips remaining
  chapters;
- ffmpeg concatenates chapter MP4s without reordering;
- final ffprobe duration respects the selected 5/10/20 minute cap;
- final metadata carries the selected provider/voice.

- [ ] **Step 3: Run RED**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-long-video-pipeline.test.ts
```

Expected: module-not-found or missing long-video implementation.

- [ ] **Step 4: Render chapters and concatenate**

Require `chapters` and `renderConfig`. For each chapter:

1. report `scripting` with chapter progress;
2. render `chapter-NNN.mp4` through `renderResearchVideoSequence()`;
3. append its escaped filename to a concat manifest;
4. stop immediately on abort.

Run final ffmpeg concat with stream copy when compatible:

```text
-f concat -safe 0 -i chapters.txt -c copy -movflags +faststart long-video.mp4
```

Probe the final result; if stream-copy metadata is invalid, fail clearly rather
than silently re-encode an unbounded file. Publish by streaming file-to-file.

- [ ] **Step 5: Register the factory branch**

The `long-video` factory branch requires `content.kind === "long-video"`,
non-empty chapters, and a valid persisted config. No feature flag or hardcoded
disabled response remains.

- [ ] **Step 6: Run GREEN**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-long-video-pipeline.test.ts
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/lib/server/research-media-job-factory.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit after authorization**

```bash
git add src/lib/server/research-long-video-pipeline.ts src/lib/server/research-long-video-pipeline.test.ts src/lib/server/research-media-job-factory.ts src/lib/server/research-media-job-factory.test.ts
git commit -S -m "feat(research): render chaptered long videos"
```

## Task 10: Add real lifecycle, ffmpeg, API-contract, and daemonless UI proof

**Files:**

- Create `src/lib/server/research-media-lifecycle.integration.test.ts`
- Create `scripts/research-media-ffmpeg.integration.test.mjs`
- Modify `tests/research-studio-media.spec.ts`
- Modify `tests/research-desk-tabs.spec.ts`
- Modify `src/app/api/api-contracts.test.ts`
- Modify `scripts/run-tests.mjs`
- Modify `package.json`

- [ ] **Step 1: Add a controlled end-to-end server lifecycle test**

The test uses temporary mission, generation, and media roots. It saves a real
mission with a markdown artifact, drafts from that artifact, queues through the
production runner with controlled PCM synthesis/video seams, waits for
terminal state, opens the stored media, and verifies range bytes. Run the same
path for podcast and short video.

This test must not seed a row directly as `queued`; its purpose is to prevent
the broken draft→queued seam from returning.

- [ ] **Step 2: Add an opt-in real ffmpeg/ffprobe integration**

`scripts/research-media-ffmpeg.integration.test.mjs`:

1. skips with a clear TAP-style reason when ffmpeg/ffprobe are absent;
2. creates two concrete PNG stills and a deterministic PCM WAV;
3. calls the production sequence renderer;
4. probes H.264, AAC, 1280×720, duration ≤60 seconds;
5. reads an early and late byte range to prove seekable serving;
6. removes its temporary directory.

Add:

```json
"test:research-media:ffmpeg": "node scripts/research-media-ffmpeg.integration.test.mjs"
```

- [ ] **Step 3: Expand the daemonless Playwright spec**

Keep `page.route` mocks for UI determinism, but cover:

- readiness-disabled hints for missing voice and missing ffmpeg;
- local and ElevenLabs provider controls;
- podcast draft → review → queued → rendering → ready → player/download;
- kept draft → row **Review draft**;
- failed → Retry → review, with no false queued copy;
- short-video ready player;
- long-video chapter progress and ready player;
- cancel and removal;
- keyboard-only modal operation.

Do not present this mocked browser test as pipeline E2E; the server lifecycle
and ffmpeg tests own that proof.

- [ ] **Step 4: Register every route and test**

Add cancel, media, readiness, and render routes to
`src/app/api/api-contracts.test.ts` in the file's established sort order.
Register every new `*.test.ts`/`.mjs` file in the correct app/API/script suite
and add alias-loader registration only for tests that import `@/...`.

- [ ] **Step 5: Run focused proof**

```bash
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/server/research-media-lifecycle.integration.test.ts
pnpm test:research-media:ffmpeg
pnpm exec playwright test tests/research-studio-media.spec.ts
pnpm check:tests-wired
```

Expected: lifecycle passes; ffmpeg passes on a prepared machine or explicitly
skips only when prerequisites are absent; Playwright and wiring pass.

- [ ] **Step 6: Commit after authorization**

```bash
git add package.json scripts/run-tests.mjs scripts/research-media-ffmpeg.integration.test.mjs src/lib/server/research-media-lifecycle.integration.test.ts src/app/api/api-contracts.test.ts tests/research-studio-media.spec.ts tests/research-desk-tabs.spec.ts
git commit -S -m "test(research): prove Studio media lifecycles"
```

## Task 11: Update documentation, visually verify, and run every release gate

**Files:**

- Modify `docs/research-desk-app-redesign-plan.md`
- Modify `docs/specs/research-generations-media-contract-v2.md`
- Modify this plan's checkboxes/evidence notes only while executing

- [ ] **Step 1: Document the shipped contract**

Document:

- record/status/config/progress schemas;
- FIFO and single-flight semantics;
- startup recovery;
- provider/voice/length behavior;
- local media path, caps, range serving, GC;
- podcast/short/long pipeline boundaries;
- ffmpeg/ffprobe and voice remediation;
- test commands and which ones use controlled dependencies versus real
  binaries;
- links to `#4021`–`#4024` and their Beads.

Remove the statement that long video is disabled.

- [ ] **Step 2: Run all required gates from the rebased worktree**

```bash
git diff --check
pnpm typecheck
pnpm lint
pnpm test:app
pnpm test:api
node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types src/app/api/api-contracts.test.ts
pnpm check:tests-wired
pnpm test:e2e
pnpm build
pnpm test:research-media:ffmpeg
```

Expected: every mandatory gate passes. The ffmpeg test may only skip on a
machine where readiness also disables both video cards.

- [ ] **Step 3: Run native visual/accessibility verification**

Start the desktop shell in the foreground:

```bash
bash scripts/dev-app.sh
```

Verify the Studio in dark, light, and one non-default theme, then walk
`docs/coven-design-language.md` §9:

1. all three cards enabled when prerequisites exist;
2. missing prerequisites produce actionable disabled hints;
3. provider/voice/length labels and errors remain readable;
4. kept drafts reopen;
5. queued, rendering, chapter progress, failed, cancelled, and ready states are
   visually distinct without color alone;
6. audio/video play, seek, and download;
7. keyboard focus traps/returns and announcements work;
8. reduced motion has no animated-only state;
9. narrow pane layout remains usable;
10. no more than three always-visible actions plus overflow per row/surface.

Capture screenshots for disabled readiness, review, queued/rendering, podcast
ready, short-video ready, and long-video chapter progress.

- [ ] **Step 4: Record requirement-level evidence in Beads**

Append exact command results, screenshot paths, branch/worktree, and session to
each matching bead. Do not use “tests pass” as a substitute for the exact
acceptance evidence.

```bash
bd update cave-qgllg --append-notes "Verification complete: git diff --check, pnpm typecheck, pnpm lint, pnpm test:app, pnpm test:api, api-contracts.test.ts, pnpm check:tests-wired, pnpm test:e2e, pnpm build, and pnpm test:research-media:ffmpeg all exited 0. Native screenshots cover disabled readiness, review, queued/rendering, podcast ready, short-video ready, and long-video chapter progress in dark, light, and a non-default theme."
bd show cave-lbi0o
bd show cave-qgllg
```

Run the update command only when every statement in it is true; otherwise keep
the bead in progress and append the exact failing command and error instead.

- [ ] **Step 5: Prepare a PR-shaped handoff**

```bash
git status --short
git diff --stat origin/main
git diff --check origin/main
git log --oneline origin/main..HEAD
```

Expected: only Research Studio media scope is present, no unrelated canonical
changes were absorbed, and the branch is ready for an explicitly authorized
commit/push/PR workflow.

---

## Requirement coverage matrix

| Requirement | Implementation tasks | Proof |
| --- | --- | --- |
| Media-kind/status/content v2 + v1 migration | 1 | Contract/store tests |
| Reviewable bounded extractive script/storyboard | 1, 8 | Drafter tests + draft-resume UI |
| Persistent FIFO, one active per familiar | 1, 2 | CAS/FIFO/drain tests |
| Honest coarse stages and chapter progress | 1, 2, 8, 9 | Runner/UI/long-video tests |
| Cancel kills child processes | 2, 5, 6, 9 | Abort/kill tests and terminal-state race |
| Crash recovery, no stuck records | 2 | Startup recovery test |
| Path safety/no symlink/atomic/caps/GC | 3 | Filesystem adversarial tests |
| Local-only range serving and seeking | 3, 10 | Route tests + lifecycle ranges |
| Piper/Kokoro default without API key | 4, 5, 10 | Readiness + controlled pipeline + native E2E |
| ElevenLabs Vault opt-in | 4, 5, 8 | Readiness/config/pipeline tests |
| Per-generation provider/voice/length | 1, 4, 5, 6, 8 | Contract/API/UI tests |
| Studio readiness is one source of truth | 4, 7, 8 | Readiness and route tests |
| Draft review, polling only active, honest retry | 7, 8 | UI source/Playwright tests |
| Audio/video players and download | 3, 8, 10 | Route + Playwright + native verification |
| 720p short video ≤60 seconds | 6, 10 | ffprobe integration |
| Token-styled standalone stills | 6 | SVG/PNG pixel tests |
| Long video by H2 chapter with progress | 1, 9 | Drafter/pipeline/UI tests |
| Daemonless E2E, API contracts, test wiring, docs | 10, 11 | Named gates |
| All three cards creatable when ready | 4, 7–11 | Playwright + native verification |
| Design/a11y/reduced motion | 8, 11 | Lint, source pins, native checklist |

## Completion rule

The epic and phase issues may close only after:

1. the work is merged through the protected PR path;
2. all mandatory gates pass on the merged candidate;
3. real podcast and short-video artifacts play and seek;
4. long video is creatable and reports chapter progress;
5. cancel and restart recovery have direct evidence;
6. each issue acceptance bullet points to an exact test, command, artifact, or
   screenshot in its Bead.

Until then, `cave-lbi0o` and `cave-qgllg` remain open/in progress and the
worktree is not safe to archive.
