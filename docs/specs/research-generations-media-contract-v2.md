# Research Studio media generations contract v2

Research Studio keeps extractive drafting, human review, and asynchronous
rendering as explicit phases. This contract implements GitHub
[#4021](https://github.com/OpenCoven/coven-cave/issues/4021) through
[#4024](https://github.com/OpenCoven/coven-cave/issues/4024) and Beads
`cave-lbi0o`, `cave-j8mui`, `cave-xqmgo`, `cave-3nmyw`, `cave-8k9gv`,
`cave-sczdy`, `cave-306jn`, `cave-h6pro`, `cave-qeq97`, `cave-5s7q2`, and
`cave-qgllg`.

## Record contract

Media records use version 2 and one of `podcast`, `short-video`, or
`long-video`. Newly created records persist:

```ts
{
  status: "draft" | "queued" | "rendering" | "ready" | "failed" | "cancelled";
  renderConfig: {
    provider: "local" | "elevenlabs";
    voice: string;
    length: "brief" | "standard" | "extended";
  };
  stage?: "scripting" | "synthesizing" | "encoding";
  progress?: {
    unit: "chapter";
    current: number;
    total: number;
    label: string;
  };
}
```

The content discriminator must match the record kind:

- Podcast stores an extracted narration `script` and, when ready, `audio`.
- Short video stores an extracted `storyboard` and, when ready, `video`.
- Long video stores ordered H2-derived `chapters`, each with storyboard
  scenes, and, when ready, `video`.

Provider, voice, and length are frozen on the reviewable draft. Directions are
stored verbatim but never used to invent claims. Older v2 work-in-progress
media rows without configuration remain readable but cannot render; a legacy
flat long-video storyboard is read as one chapter.

## Draft, queue, and recovery

Creation reads a published or working mission Markdown artifact and returns a
`draft`. The user can keep and reopen that draft. Only `Render media` performs
the mutex-protected compare-and-set from `draft` to `queued`; simultaneous
render requests cannot queue the same record twice. The record store combines
an in-process queue with an OS-visible per-familiar write lock, so the
read/compare/write CAS stays atomic across Cave processes. At the 200-record
limit, creation returns a conflict; it never evicts an active or terminal row.

The persisted runner owns `queued → rendering → ready|failed|cancelled`.
Processes contend through a durable per-familiar intent lease, and the owner
monitors persisted status so cancellation in another process aborts its child:

- One media job runs per familiar; additional jobs remain persisted.
- FIFO order is oldest `updatedAt`, then `id`.
- Completion or failure drains the next queued row.
- Cancelling queued work prevents it from starting. Cancelling active work
  aborts TTS and video tools, escalates ffmpeg and ffprobe from `SIGTERM` to
  `SIGKILL` after a bounded grace period, force-settles a wedged process, and
  prevents a late result from replacing the terminal state or orphaning its
  published file.
- After obtaining the lease, startup marks ownerless `rendering` rows failed
  with `interrupted by runner ownership loss`, leaves `queued` rows queued,
  and resumes draining without delaying the application shell.

The Studio uses a non-overlapping 1.5-second generation poll only while a media
row is queued or rendering. Readiness refreshes separately every 30 seconds.
Queued rows say `Waiting to render`; rendering rows show the persisted stage
and chapter position. Retry is single-flight, creates a replacement draft, and
returns to review.

## Render configuration and bounds

The readiness endpoint describes every currently valid choice; it never
chooses one. It returns ready local Piper/Kokoro voices, ElevenLabs
configuration and its default voice ID, and combined ffmpeg/ffprobe readiness.
The create and render endpoints validate the exact persisted selection against
current readiness.

Length presets are hard limits:

| Kind | Brief | Standard | Extended |
| --- | --- | --- | --- |
| Podcast | 2,700 characters | 7,200 characters | 13,500 characters |
| Short video | 30 seconds, 6 scenes | 60 seconds, 12 scenes | Not valid |
| Long video | 5 minutes, 4 chapters, 20 scenes | 10 minutes, 8 chapters, 40 scenes | 20 minutes, 12 chapters, 80 scenes |

Podcast synthesizes the selected voice segment by segment, verifies that the
resolved voice did not drift, concatenates compatible PCM WAV payloads, and
measures the result. Every TTS request is limited to 4,000 characters;
ElevenLabs requests time out after 60 seconds and stream into the 50 MiB audio
cap. Short video renders concrete-token 1280×720 stills,
synthesizes one voiceover, encodes H.264/AAC `yuv420p` with `+faststart`, and
verifies codecs, dimensions, and duration with ffprobe. Long video uses the
same renderer per chapter, passes only the remaining duration budget into each
chapter, reports chapter progress, concatenates compatible chapter MP4s in
source order with stream copy, and probes the final cap before publication.

## Media storage and serving

Generation records live at:

```text
~/.coven/cave/research-generations/<familiarId>.json
```

Media defaults to:

```text
~/.coven/cave/research-generations/media/<familiarId>/<generationId>/<key>
```

`COVEN_RESEARCH_MEDIA_DIR` can override the media root. The store validates
each root, familiar, generation, and file component with `lstat` and
`realpath`, rejects symlinks, compares parent/file device and inode identities
before and after opening, and uses `O_NOFOLLOW` where available. Writes use an
exclusive same-directory temporary file, handle/path identity checks, size
enforcement during copy, `fsync`, and atomic rename. Audio is capped at 50 MiB
and video at 500 MiB. Deleting a generation removes only its validated media
directory.

`GET /api/research/generations/media` opens a stable file handle and supports
single byte ranges (`206`), unsatisfiable ranges (`416`), and
`download=1`. Players and downloads use this local-only route; no filesystem
path or provider secret reaches the client.

## Verification

Controlled tests prove contract migration, exact configuration, FIFO/CAS,
restart, cancel races, filesystem attacks, podcast/short/long pipelines, and a
real mission → draft → queue → ready → stored range lifecycle. The daemonless
Playwright spec owns deterministic UI state coverage, not pipeline proof.

The binary integration check:

```bash
pnpm test:research-media:ffmpeg
```

uses production sequence code with real ffmpeg/ffprobe and verifies H.264, AAC,
1280×720, duration, fast-start output, and early/late range reads. It skips
only when ffmpeg or ffprobe is unavailable. Release verification also runs
`pnpm typecheck`, `pnpm lint`, `pnpm test:app`, `pnpm test:api`,
`pnpm check:tests-wired`, API contracts, Playwright, and `pnpm build`.
