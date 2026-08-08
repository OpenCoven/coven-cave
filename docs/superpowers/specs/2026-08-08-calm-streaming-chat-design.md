# Calm streaming chat design

**Bead:** `cave-kojcl`

**Status:** Approved design

**Date:** 2026-08-08

**Scope:** Main Chat and Quick Chat

**Extends:** `2026-07-28-streamed-chat-activity-design.md`

## Goal

Make a live familiar response readable as a conversation rather than a terminal
log. Activity updates in place, completed prose stays stable, trustworthy
results surface as soon as they are established, and the completed transcript
keeps the answer while letting operational detail recede.

The core rule is:

> Stream the answer forward; update the activity in place.

## Current baseline

The existing chat stack already provides important pieces that this design must
preserve:

- turn text, tool events, progress events, and lifecycle state are available
  without changing harness protocols;
- `segmentTurn()` preserves chronology between prose and tool activity;
- `MessageBubble` progressively renders Markdown and limits the cursor to the
  last streaming text segment;
- `createMarkdownRenderGate()` prevents stale asynchronous Markdown renders
  from replacing newer content;
- the Main Chat transcript already releases bottom-following on explicit user
  scroll intent;
- Quick Chat uses the same intent-release principle through
  `useStickToBottom()`; and
- the streamed-activity design groups repeated tools and collapses reasoning
  after completion.

The remaining problem is presentation ownership. Live prose is still treated
primarily as one changing Markdown snapshot, activity can compete with the
answer, generic tool success can look more meaningful than it is, and settled
turns retain too much operational weight.

This design extends the existing streamed-activity contract. It does not remove
reasoning disclosures, tool grouping, chronological segmentation, structured
edit cards, or existing turn controls.

## Decisions

1. Build one shared, pure streaming-turn view model for Main Chat and Quick
   Chat.
2. Keep harness and `/api/chat/send` protocols unchanged.
3. Commit prose at complete Markdown rendering-unit boundaries. Committed units
   never change again; only the active unit may rerender.
4. Keep one current activity line visible while the familiar is working or
   answering, then collapse activity after settlement.
5. Support explicit familiar-authored result markers and automatic results from
   a strict trusted-evidence allowlist.
6. Never infer evidence from generic command success or free-form output text.
7. Preserve an explicit interrupted or failed state instead of making a partial
   answer resemble a completed one.
8. Follow the stream only while the user remains pinned to the bottom.

## Shared view model

Add a pure model with no React or surface-specific dependencies:

```ts
type StreamingTurnStatus =
  | "working"
  | "answering"
  | "complete"
  | "interrupted"
  | "failed";

type StreamingContentBlock =
  | { id: string; kind: "markdown"; source: string }
  | {
      id: string;
      kind: "list";
      ordered: boolean;
      committedItems: Array<{ id: string; source: string }>;
      activeItem?: { id: string; source: string };
    };

type TurnResultState =
  | "pending"
  | "running"
  | "passed"
  | "attention"
  | "failed";

type TurnResult = {
  id: string;
  label: string;
  state: TurnResultState;
  source: "familiar" | "verified-event";
};

type StreamingTurnViewModel = {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  activity: ActivityEvent[];
  currentActivity: ActivityEvent | null;
  results: TurnResult[];
  status: StreamingTurnStatus;
  committedText: string;
};
```

The view model derives from the existing turn text, progress, tools, reasoning,
and lifecycle state. It does not own persistence, network requests, tool
execution, Markdown HTML generation, or surface layout.

Main Chat and Quick Chat consume the same model. Their wrappers may choose
density and disclosure defaults, but they must not independently reinterpret
status, results, or block completeness.

## Status derivation

Status is deterministic:

- **working** — the turn is pending and has no visible answer prose yet;
- **answering** — the turn is pending and has visible answer prose;
- **complete** — the turn settled successfully;
- **interrupted** — generation was stopped, cancelled, or disconnected without
  a terminal execution error; and
- **failed** — the turn settled with a terminal execution or transport error.

An empty successful turn is not shown as a polished completion. Existing
empty-response handling remains authoritative and must produce an explicit
failure or retry surface.

The UI copy is:

- `<Familiar> is working`
- `<Familiar> is responding`
- `<Familiar> · completed <relative time>`
- `Response stopped`
- `Response failed`

The familiar name comes from the turn identity. No generic persona name may be
substituted.

## Stable Markdown rendering

### Partitioning contract

Add a pure `partitionStreamingMarkdown()` helper that returns stable source
slices rather than rendered HTML. It recognizes rendering units outside fenced
examples and protocol markers:

- a heading commits after its terminating newline;
- a paragraph commits after a blank-line boundary;
- a blockquote commits after its terminating blank line;
- a thematic break commits after its terminating newline;
- a fenced code block commits only after its matching closing fence;
- an indented code block commits after its terminating blank line;
- a table commits only after a valid header, delimiter, body, and terminating
  blank line;
- a list keeps one stable list container while completed list items move into
  `committedItems`; only the trailing item may remain active; and
- an unterminated or structurally ambiguous tail remains the `activeBlock`.

End-of-stream commits the remaining active source verbatim before the final
settled render. The final content must remain byte-equivalent to the visible
assistant text after protocol markers are stripped.

### Rendering contract

`StreamingMarkdownBlocks` renders each committed block with a stable key based
on its source range and turn id. Once committed:

- its React element and rendered HTML are not replaced by later stream frames;
- selection inside it remains intact;
- screen readers are not asked to reread it;
- syntax highlighting does not rerun for it; and
- later content may only append after it.

Only the active block uses the progressive asynchronous Markdown path. If its
structure is not yet safe to parse, it renders as escaped plain text with
preserved whitespace. In particular:

- an incomplete table does not become a table;
- an incomplete fenced block does not trigger full syntax highlighting;
- a partial list marker does not restructure prior prose; and
- a partial protocol marker remains hidden through the existing streaming-safe
  marker extractors.

Raw transport chunks may continue arriving at token cadence, but the active
block presents them in calmer batches. The renderer schedules at most one
update per animation frame and prefers to flush on a sentence ending, newline,
list-item boundary, or code-fence boundary. A short inactivity window and a
bounded maximum buffer prevent both visible token shimmer and perceptible
stalling. This buffer affects presentation only: stopping, copying, persistence,
and final settlement use the complete accumulated source.

The current `closeTrailingFence()` behavior may remain as a no-layout-shift
fallback only when the active code frame can keep identical dimensions. It must
not cause committed prose to be reparsed.

### Caret

The active block alone may render the streaming caret. It is a small,
non-glowing vertical caret or dot:

- placed only at the active text edge;
- paused or hidden after a short period with no new content;
- removed immediately on settlement; and
- non-animated under `prefers-reduced-motion`.

## Activity model

### Current activity

`currentActivity` is the latest running progress event, otherwise the latest
meaningful activity event. It renders as one replace-in-place line above the
answer:

```text
Nova is working
Running focused chat checks…
```

When answer prose begins, the line stays in place and the phase label changes
to responding. It does not append prior statuses to the main message body.

Tool and runtime events map to short product language through an allowlisted
formatter:

- file discovery becomes `Searching the chat implementation…`;
- test execution becomes `Running focused tests…`;
- build execution becomes `Checking the production build…`; and
- diff inspection becomes `Reviewing the final changes…`.

Unknown tools use an existing human-readable display name or a neutral
`Working…` label. Raw tool function names, argument dumps, and framework
messages never become the primary status line.

### Activity disclosure

The full chronological activity trail retains timestamps, reasoning
disclosures, progress details, grouped tool calls, errors, and durations.

- While working, Main Chat may keep the disclosure open when it contains useful
  detail.
- While answering, the current line remains visible and the full trail may stay
  open only if the user opened it.
- After completion, the full trail is collapsed and labeled
  `View activity · <count> updates`.
- Quick Chat uses the same current line but keeps the full trail collapsed by
  default at every phase.
- User disclosure choice is preserved for that turn; new events do not force a
  manually collapsed disclosure back open.

The activity trail extends the existing tool-run grouping contract. It does not
duplicate tool cards into a second data structure.

## Results

Results are durable outcome rows separate from prose and activity:

```text
Results
✓ Focused regression tests passed
✓ Production build passed
```

Each row has a stable id, explicit state text, an icon, and a semantic color.
Color is never the only state channel.

### Familiar-authored results

Familiars may emit display-only markers:

```text
<coven:result
  id="production-build"
  state="passed"
  label="Production build passed"
/>
```

Supported states are `pending`, `running`, `passed`, `attention`, and `failed`.
The parser follows the existing marker safety contract:

- attributes are quoted and length-limited;
- markers inside inline or fenced code stay literal examples;
- malformed complete markers are stripped, never rendered as raw tags;
- an incomplete trailing marker stays hidden while pending;
- repeated markers with the same id update one row in place; and
- first-seen id order is stable while the latest valid value wins.

Result markers are presentation metadata only. They cannot invoke actions,
change turn lifecycle, claim that an unverified automatic event passed, or
grant authority.

### Automatic verified results

Automatic promotion is fail-closed. A row may be created only from a normalized
event classified by a trusted adapter as one of:

- test;
- build;
- typecheck;
- lint; or
- an explicitly registered first-party verification kind.

The normalized event must carry a stable id, verification kind, terminal
status, and human-readable label. The classifier may use structured tool
metadata such as a known runner identity and exit status. It must not:

- regex-match arbitrary tool output;
- treat a generic successful shell or tool call as evidence;
- infer success from familiar prose;
- promote a non-terminal running event to passed; or
- convert an unknown event kind into a result.

If the current stream event model cannot prove those fields, the event remains
activity. The initial allowlist should prefer no automatic row over an
untrustworthy one.

Explicit and automatic rows sharing an id are resolved conservatively:

- a trusted terminal failure or attention state cannot be overwritten by a
  familiar-authored passed marker;
- otherwise the newest trusted event wins over authored state; and
- duplicate labels with different ids remain distinct because they may
  represent separate checks.

## Composition

### Main Chat

The assistant turn renders:

1. familiar identity and lifecycle metadata;
2. current activity line and active Stop control;
3. committed prose blocks followed by the active block;
4. result rows;
5. interrupted or failure treatment when applicable;
6. the activity disclosure; and
7. settled message actions.

This remains a light conversational turn, not a bordered dashboard. Prose is
limited to a readable measure rather than spanning the full pane, while wide
artifacts and code may use their existing breakout behavior.

### Quick Chat

Quick Chat renders the same semantic order with compact spacing:

1. identity and current activity;
2. prose;
3. results;
4. interruption or failure treatment; and
5. collapsed activity.

It does not create a separate parser, status reducer, result classifier, or
autoscroll rule.

## Controls

- **Stop** is visible while working or answering.
- **Continue** appears after interruption only when the runtime supports
  continuation for that turn.
- **Retry** appears after failure through the existing resend/regenerate path.
- **Copy** during streaming copies committed text only and says
  `Copy completed text`.
- Settled Copy uses the complete final answer.
- Existing Reply, Read, feedback, regenerate, and branch navigation controls
  remain settled-turn actions.

Controls use native buttons, `.focus-ring`, descriptive accessible names, and
existing focus-return behavior. Stopping or retrying announces the state change
through the existing announcer.

## Interrupted and failed turns

Stopping or failing never removes already committed prose or established
results. Instead the turn appends an explicit state:

```text
Response stopped
The implementation is present, but visual interaction verification did not run.
✓ Focused tests passed
○ Visual interaction check incomplete
```

On interruption:

- the active block is frozen and committed as the partial visible answer;
- running results become pending unless a trusted terminal event proves another
  state;
- the caret disappears;
- the activity trail remains available; and
- Continue is offered only when supported.

On failure:

- established passed results remain passed;
- the failing trusted result becomes failed when identifiable;
- unrelated running results become attention or pending rather than failed;
- the error message stays specific and retryable; and
- Retry never silently replays a mutation that lacks existing idempotency
  protection.

## Scroll following

Main Chat and Quick Chat share the same intent-release semantics:

- while pinned, append and late-layout updates schedule one instantaneous
  bottom pin through `requestAnimationFrame`;
- wheel-up, upward scrollbar movement, upward keyboard navigation, or a touch
  gesture toward older content releases following immediately;
- streamed updates never re-stick a released reader;
- returning to the true bottom re-enables following; and
- sending, selecting `New response content`, or explicitly jumping to the
  latest turn re-engages following.

When content arrives while released, render a focused, accessible
`New response content` control. Its count is not token-based; one active turn
produces one notification state regardless of how many chunks arrived.

## Visual contract

- Reuse semantic design tokens and existing chat primitives.
- Main prose uses the established primary text tier and a readable line height.
- Status, timestamps, and activity use secondary or muted tiers.
- `Results` uses the established small section-label treatment.
- Result state colors use `--color-success`, `--color-warning`,
  `--color-danger`, and neutral text tokens with the documented tint recipe.
- The current activity line is lightweight and unbordered.
- The expanded activity trail may reuse existing hairline disclosure chrome.
- No glow, large pulsing cursor, animated gradient, or required motion is added.
- Every theme and mode must preserve readable contrast and hierarchy.

## Component boundaries

- `src/lib/streaming-turn-view-model.ts` owns status derivation, activity
  selection, result merging, and the pure aggregate model.
- `src/lib/streaming-markdown-blocks.ts` owns source partitioning and stable
  block ids.
- `src/lib/chat-result-markers.ts` owns streaming-safe result marker parsing.
- Existing tool/progress normalization owns trusted verification
  classification; the view model only consumes normalized evidence.
- `StreamingTurnResponse` owns the shared semantic composition.
- `StreamingMarkdownBlocks` owns committed and active prose rendering.
- `StreamingActivityLine`, `TurnResults`, and `TurnActivityDisclosure` own their
  focused presentations.
- Main Chat owns full-density placement, settled actions, and its transcript
  container.
- Quick Chat owns compact placement but not semantic derivation.
- The existing stick-to-bottom implementation remains the source of truth for
  user intent and is generalized only where necessary to share unseen-content
  state.

These names describe boundaries, not a requirement to put every component in a
separate file. Focused modules should remain small enough to understand and test
without loading the entire chat view.

## Error handling

- Parsing is fail-closed: malformed markers produce no result row.
- A partitioning ambiguity keeps text active rather than committing an unstable
  block.
- An asynchronous Markdown render that loses the render gate remains discarded.
- A result without verified terminal state remains pending or activity.
- Activity formatting falls back to neutral copy, never raw framework chatter.
- A missing familiar identity uses the existing unknown-familiar treatment; it
  does not invent a name.
- A runtime that cannot continue omits Continue rather than rendering a control
  that will fail.
- Retry and Stop failures use existing explicit error surfaces and announcements.

No broad catch or success-shaped fallback is introduced.

## Verification

### Pure model tests

Cover:

- every lifecycle transition;
- working-to-answering transition on first visible prose;
- current-activity replacement without activity loss;
- result marker parsing, repeated-id updates, malformed input, fenced examples,
  partial tails, and length limits;
- trusted automatic promotion for each allowlisted verification kind;
- rejection of generic tool success, output-text claims, and unknown kinds;
- conservative conflict resolution between authored and trusted results; and
- interruption and failure preservation rules.

### Markdown partition tests

Feed incrementally growing snapshots and prove:

- paragraphs and headings commit at the defined boundaries;
- committed source slices never change across later frames;
- list containers retain committed items while only the trailing item changes;
- incomplete tables remain plain active text;
- fenced code waits for its closing fence;
- nested blockquotes and lists do not commit prematurely;
- protocol markers do not disturb source ranges; and
- settlement preserves the complete visible source byte-for-byte.

Active-render tests also prove that bursty token input is coalesced, natural
boundaries flush promptly, and settlement cannot lose text still waiting in the
presentation buffer.

### Component and wiring tests

Cover:

- only one live caret and one current activity line;
- committed block DOM nodes retain identity across updates;
- Main Chat and Quick Chat consume the shared model;
- Quick Chat keeps activity collapsed by default;
- Results appears only when at least one row exists;
- Stop, Continue, Retry, and streaming Copy obey lifecycle and capability state;
- interrupted and failed turns do not use completed treatment;
- activity collapses after completion without losing details;
- accessible labels include state text;
- reduced motion disables caret animation; and
- user scroll intent releases following and exposes
  `New response content`.

### Integration checks

Use focused app tests for the view model, marker parser, Markdown partitioner,
Main Chat, Quick Chat, and scroll pinning. A real Tauri smoke should exercise:

- a tool-only working phase;
- transition into streamed prose;
- prose containing a list, table, and fenced code block;
- a verified test or build result;
- manual scroll-away during streaming;
- Stop or a controlled interrupted state; and
- completion in dark, light, and one non-default theme.

## Acceptance criteria

1. Main Chat and Quick Chat use one shared semantic streaming model.
2. Activity updates in one current line instead of appending narration to the
   answer.
3. Complete Markdown rendering units become stable and never rerender from later
   stream frames.
4. Only the active unit displays a streaming caret.
5. Results contain explicit markers or strictly verified automatic evidence,
   never generic tool success.
6. Completed turns collapse activity while preserving an expandable audit trail.
7. Interrupted and failed turns remain visibly distinct from completed turns.
8. User scroll intent stops automatic following until the user returns or jumps
   to new content.
9. Existing reasoning, tool grouping, edit cards, controls, and persistence
   behavior remain intact.
10. The treatment is keyboard accessible, screen-reader legible,
    reduced-motion safe, and token-compliant across themes.

## Out of scope

- Changing harness wire protocols or requiring harness-native structured blocks.
- Native iOS chat.
- Group Chat or other transcript surfaces in the first implementation.
- A dedicated task inspector or rich timeline inside every turn.
- Automatic interpretation of arbitrary shell output.
- Replacing existing tool cards, reasoning disclosures, or structured edit
  review.
- Persisting a second copy of rendered HTML.
- Optimistic result states before evidence exists.
