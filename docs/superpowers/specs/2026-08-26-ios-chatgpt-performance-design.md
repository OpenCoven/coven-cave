# Instant native iOS chat performance

> **Approved design.** This specification defines the active performance
> direction for native iOS chat. Priority and later amendments remain in
> [`../../ios-current-direction.md`](../../ios-current-direction.md).

**Bead:** cave-emi6j  
**Scope:** `apps/ios/CovenCave` only  
**Approved:** 2026-08-27

## Decision

Coven Cave will make native iOS chat feel immediate through four ordered
priorities:

1. instant acknowledgement
2. fluid streaming
3. native tactility
4. visual quiet

The app will resume the last active conversation from local state, persist an
outgoing turn before attempting network delivery, render common response
content as incremental native blocks, and schedule transcript work from the
visible viewport rather than total conversation length.

This is a phased native migration. Rare complex content may use an isolated
settled-content WebView while a native equivalent is unavailable, but ordinary
chat must never initialize WebKit.

## Evidence and constraints

The existing app already provides important foundations:

- `ChatThread` appends outgoing messages optimistically and persists stable
  per-familiar run IDs before dispatch.
- Queued replay is ordered, reconciles an attempted delivery by exact run ID,
  and refuses to repeat an uncertain POST automatically.
- `TranscriptRows` gives message and day-divider rows stable identity and uses
  an O(1) message lookup for streaming mutation.
- stream publication is coalesced to approximately 20 updates per second;
  terminal events still flush immediately.
- `LazyVStack`, coalesced auto-follow, debounced persistence, downsampled image
  caching, and cached haptic generators are already present.

The remaining common-path renderer is the main architectural mismatch.
`MessageBubble` gives every assistant response a `MarkdownWebView`. The
performance audit measured one cold simulator renderer acquisition at about
2518 ms, while subsequent JavaScript renders took about 5 ms while streaming
and 10 ms after settlement. These are observations, not percentile budgets,
but they show that WebKit startup and per-message ownership are the problem,
not the JavaScript update itself.

The design must preserve:

- graphite surfaces, restrained lavender presence, and conversation-first
  visual hierarchy
- the drawer and familiars-first Chats information architecture
- attachments, activity steps, link previews, Reader, copy, reply, forward,
  regenerate, delete, and next-path suggestion actions
- Dynamic Type, VoiceOver, text selection, Reduce Motion, Reduce Transparency,
  and native keyboard behavior
- App Lock privacy shielding and existing pairing, project, model, and session
  provenance

## Goals

- Show the locally composed message within one rendered frame.
- Keep the composer available regardless of connection or renderer state.
- Survive suspension, termination, and offline launch without losing or
  duplicating a send.
- Stream text without reparsing or rebuilding completed response content.
- Allocate zero WebViews for ordinary text and Markdown replies.
- Keep long-chat work proportional to the visible viewport.
- Make every delivery and recovery state truthful and actionable.
- Establish physical-device budgets that can approve or reject release.

## Non-goals

- Replacing the drawer, familiar-first Chats home, or desktop/web chat.
- Shipping native parity for Mermaid, arbitrary HTML, and every Markdown
  extension in the first migration phase.
- Reposting an uncertain request automatically.
- Running an indefinite background retry service that iOS cannot guarantee.
- Keeping hidden WebViews warm.
- Changing server semantics through client-side prompt comparison or inferred
  acknowledgements.

## Interaction contract

### Launch

When App Lock permits content disclosure, Cave selects the last active,
unarchived local thread and paints its newest viewport immediately. It does not
wait for connection discovery, authentication refresh, session bootstrap, or
remote transcript refresh.

If there is no resumable local thread, Cave opens the existing familiars-first
Chats home. Instant resume changes the launch destination, not the Chats
information architecture. Opening Chats from the drawer still shows the
familiar home.

Remote bootstrap and transcript reconciliation begin after the local frame is
available. They may patch the transcript only through the same stable message
identity rules used during an active session.

### Compose and send

On send:

1. Cave captures the exact visible text, wire prompt, attachments, selected
   model controls, target familiars, thread identity, session identities, and
   project provenance.
2. The visible user message appears and the composer clears in the same UI
   transaction.
3. A light send haptic fires. The composer remains focused and usable.
4. Cave atomically persists the user message and its outbox entry.
5. Network dispatch starts only after that transaction succeeds.

The user-facing state progresses through:

- **Queued** - durable and waiting for a usable connection
- **Sending...** - the stable run identity is durable and dispatch has begun
- **Reconnecting...** - Cave is resuming or reconciling that exact run
- no label - every target reached a definitive terminal result
- **Needs attention** - automatic continuation would be unsafe or cannot
  satisfy authentication, provenance, or payload requirements

Persistence failure does not remove the visible text. The message becomes
**Needs attention**, explains that it was not sent, and offers Retry. Cave must
not display **Queued** or **Sending...** unless the corresponding durability
boundary succeeded.

An assistant row appears as soon as dispatch owns at least one target. Activity
and response text update at display cadence. Scrolling, selection, composing,
and navigating remain independent of stream arrival.

## Durable chat state

### Store boundary

Replace the whole-file `[ThreadSnapshot]` persistence boundary with one
actor-isolated `ChatStateStore` backed by the system SQLite library. This adds
no package dependency. One database holds:

- thread metadata
- messages and source content
- ordered outbox entries and per-target delivery legs
- attachment payload references
- the last active thread and last visible anchor
- lightweight transcript row metadata and layout hints
- schema and migration version

SQLite is the chosen boundary because one transaction can commit the visible
message and delivery intent while indexed queries load only the latest
viewport. A larger JSON envelope would preserve atomic replacement but would
still require decoding every thread before instant resume.

Database work stays off the main actor. The database uses WAL mode, foreign-key
enforcement, bounded busy handling, and
`NSFileProtectionCompleteUntilFirstUserAuthentication` on the database, WAL,
shared-memory, and attachment files. App Lock remains the disclosure gate; no
transcript content may be copied into unprotected preferences for a faster
launch.

### Outbox model

An `OutboxEntry` is immutable delivery intent:

- entry ID and visible message ID
- thread ID and compose sequence
- visible text and exact wire prompt
- attachment references
- immutable target familiar IDs
- session and project provenance captured at compose time
- requested model and response controls
- creation time

Each target has one `OutboxLeg`:

- familiar ID
- stable client run ID
- state: `waiting`, `dispatching`, `reconciling`, `delivered`, or
  `manualRetryRequired`
- attempted boundary
- last transport error category
- server user and assistant turn IDs when known
- last transition time

Group membership cannot change the target set after composition. A later group
edit applies only to later turns.

### Dispatch and reconciliation

Entries replay FIFO by compose sequence within a thread. Different threads may
progress concurrently. Target legs of one group entry may fan out concurrently
only after the shared message and every initial run ID are committed.

Before the first POST for a leg, Cave commits its run ID and attempted boundary.
After interruption it:

1. attempts to resume the server run buffer by that ID;
2. if the buffer has a gap or expired, searches the exact persisted
   conversation turn carrying that ID;
3. adopts only the assistant child of that matched user turn;
4. marks the leg delivered only after the adopted transcript state is durable.

Prompt text is never a delivery identity. Two intentional identical prompts
remain two independent entries.

If the server cannot prove whether an attempted run completed, the leg becomes
`manualRetryRequired`. A deliberate Retry creates a new run ID and keeps the
prior attempt metadata long enough to explain what happened. Automatic replay
never sends the uncertain run again.

Connection failures use bounded exponential backoff with jitter and stop until
a positive connection signal or foreground activation. Authentication,
project selection, rejected payloads, and uncertain prior attempts do not
spin; they become **Needs attention** with the specific recovery action.

Delivered entries compact only after the corresponding message and server IDs
are durable. The outbox releases its delivery hold on attachment data as soon
as no pending leg needs it; the transcript's attachment asset remains available
to the message. Terminal diagnostics expire after seven days and retain no more
than the newest 100 terminal legs per thread.

### Migration

On first open of the new store:

1. load the legacy thread snapshot through its existing decoder;
2. decode inline attachment data off-main into content-addressed files in a
   staging directory, fsync them, and reuse them on an interrupted retry;
3. import messages, thread metadata, and final attachment references in one
   database transaction;
4. convert each message with embedded `queued*` fields into one outbox entry
   with equivalent target, run, attempted, and completed-leg state;
5. verify row counts and queued identities;
6. mark the database migration complete before selecting it as authoritative.

The legacy file remains untouched after migration, but later writes go only to
the new store. Deleting it is explicitly outside this project; a later
migration may remove it only after at least one shipped app version has read
the new store successfully. An interrupted import restarts from the legacy
source and reuses or removes orphan staging files by content hash; it cannot
produce a half-migrated authoritative database.

During this one-time upgrade, the already decoded legacy active thread may
paint immediately after App Lock while the import finishes off-main. The
composer shows **Finishing chat upgrade...** and remains disabled until the
database becomes authoritative, so no send can straddle the stores. This
exception has its own `chat.store.migrate` signpost and is excluded from
ordinary resume and compose samples.

## Incremental native document model

### Document boundary

Each assistant message has a `NativeMessageDocument` containing:

- immutable completed blocks
- one mutable streaming tail
- the source revision and parsed source boundary
- deterministic block IDs derived from message ID, block kind, and source
  range

The parser runs outside the main actor. When a stream update is an append, it
parses only the previous unfinished tail plus the new suffix. A block freezes
when its closing syntax is unambiguous. Frozen blocks are never rebuilt during
that stream.

If an update replaces earlier source rather than appending, Cave invalidates
the changed suffix and reparses that message only. If the source before a
frozen boundary changed, the parser falls back to an asynchronous full-message
parse; it still does not invalidate other rows.

Publications are coalesced to display cadence. Only the active tail revision
changes during ordinary streaming, so SwiftUI diffs one block rather than the
whole response.

### Native block coverage

The first native phase supports:

- paragraphs and soft/hard line breaks
- headings with semantic levels
- ordered and unordered lists, including nesting
- block quotes and thematic dividers
- emphasis, strong emphasis, strike-through, inline code, and links
- fenced code with language label, selection, copy, horizontal scrolling, and
  full-screen zoom
- existing `<coven:next-paths>` suggestions as native action rows

Closed code fences request syntax highlighting off-main for recognized
languages. Until highlighting finishes, and for unknown languages, readable
monospaced source is the final-quality fallback. Highlighting must never delay
text visibility or selection. The first native release recognizes at least
Swift, Objective-C, TypeScript, JavaScript, JSON, Bash, Python, Rust, Go, SQL,
YAML, and Markdown.

Attachments, agent activity, response-control facts, first-link previews,
message timestamps, and message actions remain native siblings owned by
`MessageBubble`. They are not folded into Markdown. Existing GitHub context
outside the response body remains native. This phase does not claim support for
in-message GitHub, citation, attachment, or other live-card markers that native
iOS does not currently implement.

### Compatibility blocks

Tables, Mermaid, raw HTML, and unknown typed markers become explicit
`unsupported` blocks. While streaming, Cave shows readable source or a quiet
native placeholder. After settlement, only the unsupported block may create a
compatibility renderer.

The compatibility renderer:

- cannot replace or own the whole message
- is created only while its settled block is visible
- uses the bundled renderer and restricted content origin
- routes links through native URL handling
- preserves existing enlarge behavior
- reports failure by revealing readable source
- is destroyed when evicted and is never pooled or prewarmed

During cold creation or recreation after eviction, the block shows its readable
source until the compatibility renderer signals readiness; it never reserves a
blank frame.

Every compatibility block kind has a native replacement path. Removing the
last use of a kind removes its WebView route; the migration must not grow a
second permanent renderer architecture.

### Reader

Reader consumes the same `NativeMessageDocument` in a scrollable native layout.
Heading blocks provide its table of contents. It may materialize unsupported
compatibility blocks under the same visibility rules, but it does not parse
the response through a second pipeline.

## Transcript lifecycle

`LazyVStack`, `TranscriptRow`, stable message IDs, stable day-divider IDs, and
`TranscriptIndex` remain the transcript foundation.

A viewport controller observes visible row IDs and maintains up to 12 message
rows of prefetch on each side; day separators do not count toward the limit. It
schedules parsing, syntax highlighting, image decoding, and compatibility
preparation only for that window. It is a resource scheduler, not a replacement
scroll container; `ScrollView` and `LazyVStack` remain layout and accessibility
authorities.

The store exposes a lightweight index for every transcript row containing row
identity, day grouping, source revision, ordering metadata, and an optional
layout hint. A hint is keyed by message ID, source revision, available-width
bucket, and Dynamic Type category; a signature change invalidates it. Launch
loads this index, but it loads source bodies only for the viewport and prefetch
window.

Offscreen messages use the persisted hint or a deterministic estimate from
source length, known block kinds, and attachment dimensions. They do not retain
a live renderer. Returning rows restore from the parsed-document cache when
available or rebuild asynchronously. When a row above the saved viewport anchor
receives a different measured height, the viewport controller compensates the
delta while preserving the anchor message and intra-row offset. This keeps
materialization from visibly moving the reader.

The cache is keyed by message ID and source revision. Memory pressure evicts:

1. offscreen compatibility renderers
2. decoded full-resolution media
3. parsed offscreen documents
4. syntax-highlighted decorations

Persisted source and outbox state are never cache entries and are not evicted.

Composer changes cannot alter message render identity. Stream updates mutate
only the active assistant row and its tail block. Structural changes such as
insert, delete, retry, and day rollover rebuild row metadata and the O(1) index
once; text deltas do neither.

Auto-follow remains active only while the reader is near the bottom. Scrolling
up freezes position. New output then uses the existing quiet jump-to-latest
affordance; it cannot pull the reader away from older content.

Instant resume queries the lightweight row index and enough source bodies to
fill the saved viewport plus prefetch. Older source bodies hydrate incrementally
as their rows approach the window. A saved anchor restores position without
requiring all message views or documents to exist.

## Native tactility and visual quiet

- Use one light haptic when a local send is accepted and existing tap haptics
  for explicit copy, retry, suggestion, and zoom actions.
- Do not haptically announce transport retries, stream deltas, or background
  reconciliation.
- Keep outgoing state as quiet secondary text under the bubble. Reserve error
  color and persistent controls for **Needs attention**.
- Do not add per-token animation. Text appears at the publication cadence;
  completed blocks remain visually still.
- Preserve the existing no-bottom-tab, conversation-first composition.
- Glass remains concentrated in navigation and controls, not every response
  block.

Reduce Motion removes pulsing and insertion motion without reducing update
frequency or hiding delivery state. Reduce Transparency retains clear
boundaries and contrast.

## Accessibility

Native blocks expose:

- semantic heading levels
- list grouping, item order, and item count
- quote and code labels
- link destinations and native activation
- selectable text in transcript and Reader
- Dynamic Type without clipped fixed-height containers
- stable VoiceOver order while the tail updates

Streaming announcements are summarized and rate-limited; VoiceOver must not
announce every token. Delivery-state transitions announce once. **Needs
attention** includes the reason and available action, so color is never the
only signal.

Unsupported content exposes a meaningful label and readable-source fallback
before any compatibility renderer is available.

## Privacy and security

- App Lock shields transcript pixels before local resume is revealed and in
  system app-switcher snapshots.
- Chat state uses iOS data protection and never stores transcript excerpts in
  preferences, logs, signposts, or notification identifiers.
- Performance instrumentation records durations, counts, revisions, and sizes,
  not prompt or response content.
- Raw HTML remains inside the restricted compatibility path. Native blocks do
  not execute script.
- Outbox diagnostics may retain IDs and error categories, never credentials or
  authorization headers.

## Recovery semantics

| Condition | Automatic behavior | User-visible result |
| --- | --- | --- |
| Offline before dispatch | Keep durable FIFO entry | **Queued** |
| Dispatch is cancelled before the attempted boundary commits | Keep the leg waiting | **Queued** |
| Attempted boundary commits but the process ends before rollback can persist | Reconcile the exact run ID; never assume POST was absent | **Reconnecting...**, then **Needs attention** if the server has no evidence |
| Connection drops after attempted boundary | Resume or reconcile exact run ID | **Reconnecting...** |
| Exact run completes | Persist reply and terminal leg | Delivery label clears |
| Attempted run cannot be proven | Do not repost | **Needs attention** and Retry |
| Authentication expired | Stop replay until repaired | **Needs attention** and reconnect action |
| Project/session provenance invalid | Stop affected entry | **Needs attention** and selection action |
| Local compose transaction fails | Do not dispatch | **Needs attention** and Retry |
| Native parse fails | Preserve source and isolate failure to one message | Readable plain source |
| Compatibility render fails | Remove blank renderer | Readable block source |
| Store is corrupt | Preserve the file and fail closed | Local-data error with Retry and an explicit-confirmation Reset Local Chats action, never an empty-success transcript |

Partial assistant output remains readable after interruption. Resumption patches
that message in place. Manual Retry creates a new attempt and does not erase
the evidence of the uncertain one.

## Performance budgets

These budgets apply to a Release build on a supported physical iPhone unless a
row explicitly names a deterministic source contract. Simulator measurements
guide development but cannot approve release.

| Boundary | Budget |
| --- | ---: |
| App becomes eligible to reveal content -> cached conversation first stable frame | <= 100 ms p95 |
| Send tap -> visible local message | <= one 60 Hz rendered frame p95 |
| Compose transaction commit | <= 50 ms p95 |
| Stream publication cadence | 10-20 updates/second, terminal flush immediate |
| Main-thread work caused by one parser publication | <= 4 ms p95 |
| Composer frame time attributable to transcript work | no frame over 16.7 ms in the test workload |
| Ordinary settled or streaming reply WebViews | exactly 0 |
| Initial resume materialization | viewport plus at most 12 message rows on each side |
| Duplicate POST after any tested crash boundary | exactly 0 automatic duplicates |
| Main-thread attachment decode or syntax highlighting | exactly 0 |

The launch interval begins after App Lock has authorized disclosure and the
root scene is eligible to render. It excludes human biometric time and OS
process scheduling, but includes local state selection, viewport query, native
document materialization, layout, and the first stable transcript frame.

The standard long-chat workload contains 1,000 messages, an 800-character
average assistant response, a 50-line fenced code block every tenth assistant
response, and a 1024 x 1024 image every twentieth user message. Its active
response appends 4,000 characters at 20 publications per second while the test
types in the composer and continuously scrolls. Frame-budget claims refer to
this fixture; implementations may add harsher fixtures but may not replace it
with a smaller one.

## Validation

### Deterministic tests

- outbox state-machine transitions and illegal transition rejection
- crash injection immediately before and after message commit, attempted
  boundary, POST handoff, first stream frame, done frame, transcript commit,
  and terminal compaction
- identical-prompt and group partial-delivery duplicate prevention
- legacy snapshot migration, interrupted migration, and rollback-window reads
- FIFO ordering within a thread and concurrency across threads
- append-only parser fixtures for every supported block
- every streamed prefix of each fixture produces stable frozen block identity
- non-prefix replacement invalidates only the changed message suffix
- malformed, adversarial, deeply nested, and fuzzed Markdown remains bounded
  and preserves readable source
- compatibility detection never allocates a WebView for common-path fixtures
- transcript cache eviction, memory warning, anchor restoration, and
  long-conversation scrolling
- Dynamic Type, VoiceOver labels/order, Reduce Motion, and Reduce Transparency
- App Lock launch shielding and offline relaunch

### Instrumentation

Add named signposts for:

- `chat.resume.local-frame`
- `chat.store.migrate`
- `chat.compose.visible`
- `chat.compose.commit`
- `chat.parser.background`
- `chat.parser.publish-main`
- `chat.viewport.materialize`
- `chat.outbox.dispatch`
- `chat.outbox.reconcile`

Record bounded aggregates only. Tests use injected clocks to pin exact
aggregation behavior.

### Physical-device release gate

Collect at least 30 Release samples for launch, compose visibility, compose
commit, and parser publication on the oldest supported iPhone available for
release validation and one contemporary iPhone. Report p50 and p95, thermal
state, transcript size, attachment mix, connection state, and whether the run
was cold or warm.

Also verify:

- sustained streaming while composing and scrolling
- a large mixed-content transcript under memory pressure
- Wi-Fi/cellular loss and recovery around every dispatch boundary
- offline compose, force-quit, relaunch, and exact ordered replay
- no ordinary-chat WebKit process or `WKWebView` acquisition signpost
- energy and thermal behavior during long streaming and image viewing

A deferred or missing physical-device row is incomplete, not passed.

## Migration sequence

1. Add instrumentation and retain baseline evidence.
2. Land `ChatStateStore`, legacy migration, last-thread resume, and the durable
   outbox behind one internal migration flag.
3. Make the durable send path authoritative after crash-boundary tests pass.
4. Land native document parsing and common native blocks while preserving the
   current renderer as a whole-message rollback path behind a development-only
   flag.
5. Switch production chat to native blocks and narrow WebKit to settled
   compatibility blocks.
6. Make Reader consume the native document and add viewport-governed resource
   scheduling.
7. Replace tables, Mermaid, and remaining compatibility kinds natively as
   separate scoped follow-ups.
8. Remove the old whole-message WebView path after native common-path,
   accessibility, crash-recovery, and physical-device gates pass.

Each migration step must preserve stable message IDs, existing transcript
actions, and the ability to read previously persisted conversations. A phase
cannot claim success by silently dropping rich content or delivery evidence.

## Acceptance

The design is implemented only when:

- launch resumes the last active local conversation without network bootstrap;
- every accepted compose is either durably queued or explicitly marked unsent;
- tested termination points produce no automatic duplicate sends;
- common Markdown and code render incrementally through native blocks;
- ordinary chat owns zero WebViews;
- Reader and transcript share one parsed document;
- work for a long conversation is bounded by the viewport and cache policy;
- accessibility and App Lock contracts remain intact; and
- every physical-device performance budget has current measured evidence.
