# Model- and harness-level analytics

State: **Living** — describes what ships today, including the places where the
contract is wider than the data behind it.

Two independent measurement systems answer "which model, on which harness, is
actually working for this familiar," and they render side by side in one
section. They do not share a denominator, a source, or a privacy posture, and
reading one as if it were the other is the single most common mistake this
surface invites.

| | Execution telemetry | Thumbs feedback |
|---|---|---|
| Unit | One assistant attempt | One human vote on one message |
| Source | Projected from local conversation transcripts | Appended when a person clicks a thumb |
| Model dimension | `requestedModel` / `forwardedModel` / `confirmedModel` | One `model` stamp captured at vote time |
| Runtime dimension | `harnessId` (+ `harnessVersion`) | `runtime` binding id |
| Derivation | `src/lib/familiar-execution-analytics.ts` | `src/lib/message-feedback-rollup.ts` |
| Covers history | Every transcript on disk | Only votes cast since stamping shipped |

Both render inside **Runtime performance** on
`/dashboard/familiars/<id>/analytics` (`RuntimePerformanceSection` in
`src/components/familiar-analytics-content.tsx`).

---

## 1 · The attempt is the unit

`ExecutionAttemptSnapshotV1` (`src/lib/familiar-execution-analytics.ts`) is the
content-free record of one assistant response: who ran, on what, how long it
took, what it cost, and whether it settled. It carries no prompt, no reply, and
no tool arguments — only tool *names*, statuses, and durations.

Identity is deterministic, not random. `deterministicExecutionAttemptId`
(`src/lib/server/familiar-execution-analytics-projection.ts`) hashes
`schemaVersion · familiarId · sessionId · turnId · attemptNumber` into an
`ea1_…` id, so re-projecting the same transcript produces the same row rather
than a duplicate. That is what makes the ledger safely append-only.

`attemptNumber` is **always 1**. A transcript persists one assistant result per
turn; retries inside a harness leave no separate record, and the projection
refuses to invent them. Anything reasoning about retry cost is reasoning about
data that does not exist here.

One naming trap: `executionKind` does not hold the execution kind when an
origin is known. `normalizeExecutionAttemptSnapshot` sets
`executionKind: origin ?? "assistant-response"`, so the bold label in **Recent
execution evidence** usually reads `chat`, `board`, or `cron`. The structured
kind survives untouched at `execution.kind`.

## 2 · Model identity is three fields, not one

A single attempt records up to three model identities, because the three
regularly disagree:

- **`requestedModel`** — what the surface asked for. It is a *selection*, not
  just a string: `{ kind: "runtime-default" }` is a distinct, meaningful value
  and flattens to the literal label `runtime-default`.
- **`forwardedModel`** — what the Cave actually put on the wire.
- **`confirmedModel`** — what the harness echoed back from its own init or
  system event.

The gap between them is the interesting signal. A harness that silently
downgrades, or that ignores an override and runs its default, shows up as
`requested ≠ confirmed` and nowhere else.

**Today the aggregate throws that gap away.** `aggregateWindow` keys the model
slice as `confirmedModel ?? forwardedModel ?? requestedModel`, and the recent
attempt list collapses identically. So a substitution is invisible in the
"Models" bars: the attempt is simply attributed to whatever ran. The three
fields are preserved on every row and returned by the API — the collapse
happens only at presentation.

Only `confirmedModel` has a coverage ratio. Attempts where the harness never
echoed a model still appear in the slice, attributed to the forwarded or
requested id, and the **Confirmed model** coverage figure is the only thing on
screen that says so.

## 3 · Harness identity is id plus version — and the version is never there

The harness slice keys `harnessId@harnessVersion` and renders it with the `@`
replaced by a space ("Harnesses and versions"). The harness id is canonicalized
through `canonicalHarnessId` (`src/lib/harness-adapters.ts`) so the same runtime
does not split into two bars under two spellings.

`harnessVersion` is structurally unpopulated. Conversations record
`harness` (an id) and never a version — see `ConversationFile` in
`src/lib/cave-conversations.ts` — and the projection therefore emits
`harness: { id }` only. The consequences are exact and worth stating plainly:

- the "Harnesses and versions" list never shows a version;
- **Harness version** coverage reads 0% whenever attempts exist;
- every recent attempt renders `<harness> · version unreported`.

That is honest output, not a bug in the display. A version-aware regression
("this stopped working at 1.0.42") is not answerable from this surface until a
capture path records one.

## 4 · Windows and how each number is computed

Windows are `7d`, `14d`, `8w` (56 days), and `all`, aggregated server-side by
completion time. The scope control on the page uses the same four ids
(`src/lib/analytics-window.ts`), so the headline and the slices always agree.

- **Success rate** = `completed / (completed + failed)`. Cancellations are
  excluded from the denominator entirely — abandoning a run is not the model
  failing. Zero settled attempts yields `null`, which renders "Unreported"
  rather than 0%.
- **Median and p95 duration** come only from attempts that reported a duration.
- **Total tokens** = `inputTokens + outputTokens`. Cache read and cache
  creation tokens are captured on the snapshot but excluded from the total, so
  cross-model token comparisons understate cache-heavy harnesses.
- **Cost** is passed through from the harness result event. Harnesses that
  report none contribute nothing rather than zero.
- **Slices** sort by attempt count descending, then key ascending — a stable
  order that does not reshuffle as ties appear.

`recentAttempts` is capped at 100 (default 50) via `?recent=` on
`GET /api/familiars/<id>/execution-analytics`, and the section renders the
first 8 that fall inside the selected window.

## 5 · Coverage is the honesty layer

Every window carries `coverage`, a `known / total` ratio per field:
`harnessVersion`, `confirmedModel`, `usage`, `cost`, `duration`, `tools`. The
UI sorts them worst-first, which is the correct default: the least-covered
field is the one most likely to be silently distorting a chart above it.

Coverage answers "how much of this window actually reported this?" — never
"what is the value?". A 40% cost coverage means the cost figure describes 40%
of the attempts, not that costs fell.

Three drifts exist between the declared contract and what is emitted:

1. `EXECUTION_ATTEMPT_COVERAGE_FIELDS` declares **15** fields; `aggregateWindow`
   emits **6** ratios. Controls (`controls.requested` / `.forwarded` /
   `.applied`) and the individual usage fields are captured per attempt and
   never aggregated.
2. `coverage.knownFields` is computed for every snapshot by
   `coverageForSnapshot` and read by nothing. It is written to the ledger and
   dropped.
3. `COVERAGE_LABELS` in the analytics content carries `firstOutput` and
   `quality`, which no aggregator produces. They are dead entries, harmless
   because unknown keys fall back to the raw key.

None of these produce a wrong number on screen; all three mean a field that
looks contracted is not measured.

## 6 · Where the data comes from

There is **no live capture path**. `provenance.source` admits `"live"`, and
`backfillFamiliarExecutionAttempts` treats live rows as authoritative and
refuses to overwrite them — but nothing in the tree writes one. Every attempt
in the product today is `conversation-backfill`, projected from
`ConversationFile` turns, and every row renders with `provenance: "backfilled"`.

The read path (`readFamiliarExecutionAnalytics`,
`src/lib/server/familiar-execution-analytics-source.ts`) is:

1. read the ledger at
   `${COVEN_CAVE_HOME:-~/.coven/cave}/familiar-execution-analytics/v1/<familiarId>.jsonl`;
2. re-project **every** conversation belonging to that familiar;
3. append rows that are new or changed — a failed append is swallowed, because
   derived persistence is a cache and an unwritable ledger must not hide
   analytics that can still be computed;
4. aggregate.

Two consequences follow. Reads are self-healing: delete the ledger and the next
read rebuilds it. Reads are also **O(full transcript history)** — there is no
incremental cursor, so cost grows with the familiar's lifetime, not with the
selected window.

`backfill.state` reports `complete` only when every scanned conversation
loaded; a transcript that fails to parse yields `partial` plus a `remaining`
count, so a missing chunk of history is visible rather than assumed absent.

The ledger tolerates corruption line by line: one unparseable JSONL line is
skipped, not fatal. Last write wins per `attemptId`.

## 7 · Privacy posture

Metadata only, enforced at normalization. Strings are trimmed and truncated
(model and session ids to 256 chars, harness id/version and tool names to 128,
control values to 64); tool arrays are capped at 100 entries; negative and
non-finite numbers are dropped rather than clamped. Thumbs rollups are
aggregate-only by construction — consumers receive counts, never message ids,
timestamps, or content.

The route rejects any familiar id that fails `isValidFamiliarId` with 403
`path not allowed` before touching the filesystem, and responds `no-store`.

## 8 · Thumbs feedback is a different question

`MessageFeedbackRollup` buckets human votes by `model` and by `runtime`. It
replays an append-only log per message so a re-vote or a toggle-off resolves to
the person's final verdict, then counts up/down per bucket.

Do not read it against the execution numbers:

- its runtime axis is the **runtime binding id** (`binding.runtime`, stamped at
  vote time), which never passes through `canonicalHarnessId`, so its bars do
  not line up one-for-one with the harness slice;
- votes cast before model stamping shipped carry no model and are omitted from
  the per-model buckets entirely, while still counting in the up/down totals —
  which is why the empty state says older votes carry no model stamp;
- coverage is human attention, not telemetry. A model with two votes and a
  thousand attempts is not better measured than one with none.

## 9 · Known gaps

Verified against the tree, in rough order of how much they limit the surface:

1. **No live capture.** Everything is reconstructed from transcripts, so
   anything a transcript does not persist — in-harness retries, per-attempt
   control application, harness version — is unrecoverable rather than merely
   missing.
2. **Harness version is never recorded** (§3), so version-level regression
   analysis is impossible and one coverage row is permanently 0%.
3. **Model substitution is invisible in aggregate** (§2). The data to detect it
   is on every row; only the slice keying discards it. A `requested vs
   confirmed` mismatch count would be a pure presentation addition.
4. **Controls are captured and never aggregated.** Reasoning effort, verbosity,
   and the rest, plus `rejectedFamilies`, ride on every snapshot and reach no
   chart — the question "does high reasoning effort actually change the outcome
   rate?" is one aggregation away and currently unanswerable.
5. **No coven-level rollup.** Model and harness dimensions exist only per
   familiar; `coven-analytics.ts` and `dashboard-analytics.ts` carry no model or
   harness axis, so "which harness is failing across the whole roster" has no
   surface.
6. **Cache tokens are excluded from totals** (§4).
7. **Read cost scales with lifetime history** (§6).
8. **iOS has no analytics digest yet** — tracked as `cave-9rwd.5` against
   `docs/superpowers/specs/2026-08-07-ios-familiar-command-center-design.md`.
   Its acceptance criteria already require unavailable to be distinct from
   zero, which is the same discipline §5 encodes on desktop.

## 10 · Changing this safely

- The wire contract is versioned three ways —
  `EXECUTION_ATTEMPT_SCHEMA_VERSION`, `EXECUTION_ATTEMPT_LEDGER_VERSION`,
  `FAMILIAR_EXECUTION_ANALYTICS_VERSION`. A shape change that old ledger lines
  cannot satisfy needs a schema bump plus a ledger directory bump (`v1/` is in
  the path); a change to what a field *means* needs a bump even when the type is
  unchanged, because the ledger is append-only and old rows keep flowing.
- Adding a coverage key is additive by design: unknown keys fall back to the raw
  key in the UI, so a new ratio renders before it has a label.
- Never widen the snapshot toward content. The metadata-only boundary is what
  lets this ledger sit unencrypted in `~/.coven/cave`.
- Tests that pin this contract, all registered in `scripts/run-tests.mjs`:

  ```bash
  node scripts/run-tests.mjs app   # or: pnpm test:app
  ```

  The load-bearing files are
  `src/lib/server/familiar-execution-analytics.test.ts` (projection, ledger,
  aggregation), `src/app/api/api-contracts.test.ts` (route shape and the live /
  backfill provenance split), and
  `src/components/familiar-analytics-view.test.ts` (the rendered section,
  including the coverage rows and slice output).
