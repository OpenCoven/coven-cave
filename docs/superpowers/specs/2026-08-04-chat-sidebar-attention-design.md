# Chat Sidebar Attention States

**Status:** Approved design

## Goal

Make it immediately clear which chats are waiting on the human and gently
resurface conversations that have been left hanging, without treating every
completed familiar reply as an urgent request.

The sidebar must answer two separate questions:

1. What is the runtime doing?
2. Who owes the next conversational turn?

Runtime state and conversational attention remain independent. A session may
be completed while awaiting the human, or running without requiring any human
action.

## Chosen direction

Use a hybrid attention model:

- An explicit request for input, approval, credentials, or a decision becomes
  actionable immediately.
- A chat whose latest completed turn is from a familiar remains ordinary for
  24 hours, then receives a quiet left-hanging reminder.
- An explicit request still unresolved after 48 hours escalates visually.

The sidebar combines hierarchy, plain language, and restrained semantic color:
an **Awaiting you** group appears above Recent, while each affected row also
carries a text label and state tint. Color reinforces meaning but never carries
it alone.

## Attention state model

Each visible chat derives exactly one attention state:

| State | Meaning | Entry condition | Exit condition |
| --- | --- | --- | --- |
| `none` | No human action is inferred | Default; human authored the latest turn; session is running; or evidence is unavailable | A stronger state becomes derivable |
| `left-hanging` | The familiar left the last completed turn and the conversation has gone quiet | Latest completed turn is from the familiar and remains unanswered for at least 24 hours, with no explicit request marker | Human sends a newer reply, the session resumes running, or the chat is archived |
| `awaiting-human` | The familiar explicitly needs human input | Latest unresolved request asks for input, approval, credentials, or a decision | Human sends a newer reply, the session resumes running, or the chat is archived |
| `overdue-human` | An explicit request has remained unresolved long enough to warrant stronger notice | `awaiting-human` remains unresolved for at least 48 hours from the request timestamp | Human sends a newer reply, the session resumes running, or the chat is archived |

The 24-hour and 48-hour boundaries are inclusive. A request at exactly 48
hours is `overdue-human`; a non-explicit familiar-last turn at exactly 24 hours
is `left-hanging`.

### Explicit request evidence

Explicit requests must come from structured response metadata emitted when the
familiar deliberately blocks on the human. The metadata records:

- the session id
- the request turn id
- the request timestamp
- a machine-readable reason: `input`, `approval`, `credentials`, or `decision`

The list layer must not infer an explicit request by keyword-matching assistant
prose. Text heuristics are too easy to trigger on quoted instructions,
explanations, or historical discussion. If structured request evidence is
missing, the hybrid model may still derive `left-hanging` from turn order and
age, but it must not claim `awaiting-human`.

### Clearing and precedence

A newer human-authored turn clears every prior attention state. Merely opening
or reading the chat does not clear it.

Attention derivation uses this precedence:

1. archived or actively running session -> `none`
2. newer human reply -> `none`
3. unresolved explicit request at least 48 hours old -> `overdue-human`
4. unresolved explicit request -> `awaiting-human`
5. familiar authored the latest completed turn at least 24 hours ago ->
   `left-hanging`
6. otherwise -> `none`

Failed and paused runtime states remain visible through their existing runtime
signals. They do not automatically imply that the human owes a reply.

## Data ownership and flow

### Canonical derivation

The session-list boundary owns attention derivation because every chat-list
surface needs the same answer. It reads persisted conversation metadata and
returns a compact attention snapshot on each `SessionRow`:

```ts
type ChatAttentionState =
  | "none"
  | "left-hanging"
  | "awaiting-human"
  | "overdue-human";

type ChatAttention = {
  state: ChatAttentionState;
  since: string | null;
  reason: "input" | "approval" | "credentials" | "decision" | null;
};
```

`since` is the explicit request timestamp when one exists; otherwise it is the
latest completed familiar-turn timestamp. It is never the generic session
`updated_at`, because unrelated runtime or metadata activity must not reset an
attention clock.

The API returns a normalized `ChatAttention` for every session, including
`{ state: "none", since: null, reason: null }`. Consumers do not reinterpret
raw transcript data or maintain separate local attention stores.

### Live reconciliation

The existing session poll picks up persisted changes. To avoid stale attention
between polls:

- starting a new human turn immediately projects `none` for that session
- starting or adopting a live generation projects `none`
- when persistence and the next session poll complete, canonical API data
  replaces the projection

Projection is forward-only and session-scoped. A failed send restores the last
canonical attention snapshot rather than silently clearing it.

### Existing familiar-level response signal

The current familiar-level `responseNeeded` set is not precise enough to drive
chat rows because it identifies a familiar, not a specific conversation. The
new session-level attention snapshot becomes the source for chat rows.

Familiar badges and Inbox reminders may later aggregate session attention, but
that aggregation is outside this sidebar change. This work must not preserve
or extend a parallel, manually maintained familiar-level truth.

## Sidebar presentation

### Grouping

In the Recent view, actionable chats appear in an **Awaiting you** group above
the ordinary recency sections. The group includes:

- all `awaiting-human` chats
- all `overdue-human` chats
- all `left-hanging` chats

Rows are ordered by urgency, then age:

1. `overdue-human`, oldest first
2. `awaiting-human`, oldest first
3. `left-hanging`, oldest first

Each chat appears only once. Promotion into Awaiting you removes it from its
ordinary Recent bucket.

The Projects view preserves project folders and their existing ordering.
Attention rows remain inside their project, with the same row cues and labels.
Project metadata includes an attention count, for example
`2 awaiting · 6 chats · 3h`, when the count is nonzero.

Search does not create a separate attention group. Matching rows retain their
attention state, label, tint, and accessible description in the results.

Archived chats never appear in Awaiting you. If the user explicitly enables
archived visibility, archived styling wins and attention is `none`.

### Row cues

Affected rows use three simultaneous channels:

| State | Copy | Color treatment | Structural treatment |
| --- | --- | --- | --- |
| `left-hanging` | **Left hanging** | Warning-colored text and a very light warning-derived tint | Warning tick; ordinary border |
| `awaiting-human` | **Awaiting you** | Warning text, approximately 14% warning fill, and 30-45% warning-derived border | Warning tick and explicit second-line label |
| `overdue-human` | **Still waiting** | Danger text with the existing danger background and border tokens | Danger tick and explicit second-line label |

The row retains its ordinary title and relative timestamp. The attention label
uses a small status dot plus text; assistive text includes the elapsed time and
request reason when available, for example:

> Awaiting you for approval since 7 hours ago.

The runtime dot, PR badge, and branch glyph retain their existing meaning. The
attention tick and label are a separate layer and do not recolor GitHub state.
The active row keeps the accent selection treatment while its text label
continues to communicate attention.

No attention state pulses or continuously animates. Existing running-state
motion keeps its reduced-motion fallback.

### Theme and token rules

All styling uses semantic tokens and the established tint recipe:

- `--color-warning` for `left-hanging` and `awaiting-human`
- `--danger-bg`, `--danger-border`, and `--danger-text` for `overdue-human`
- `color-mix(in oklch, ...)` for warning fill and border derivation
- existing surface, text, border, radius, spacing, and motion tokens

The treatment must remain legible across every supported theme and dark/light
mode combination. No hardcoded render colors, off-grid spacing, or new text
tier is introduced.

## Accessibility

- **Awaiting you** is a real labeled section with a visible count.
- Attention labels are rendered as text, not title-only tooltips.
- Color is never the only differentiator.
- The chat row's accessible name or description includes the attention label,
  reason when known, and elapsed duration.
- Project attention counts are announced as text.
- Row actions, drag behavior, focus rings, keyboard opening, and split-opening
  behavior remain unchanged.
- No new animation is introduced.
- At narrow sidebar widths, project identity may continue to collapse, but the
  attention label remains visible.

## Failure handling

Attention derivation fails quiet:

- missing conversation metadata -> `none`
- malformed timestamp -> `none`
- unknown explicit-request reason -> `none`
- transcript load failure -> `none`

The API must not convert errors into success-shaped `awaiting-human` values.
Existing session-list error handling remains responsible for surfacing an
overall list failure. One malformed conversation must not prevent other
sessions from loading.

Client projections are also conservative. They may temporarily suppress an
attention cue after a human sends a turn, but they never invent a request.
When a send fails, the previous canonical state is restored.

## Scope

This design includes:

- session-level attention metadata and derivation
- session-list API integration
- Recent, Projects, and search sidebar presentation
- immediate client reconciliation for sends and live generations
- accessibility and theme-safe styling
- focused model, API, component, and visual-state tests

This design excludes:

- operating-system notifications
- configurable reminder thresholds
- snoozing or manually dismissing a hanging chat
- automatic task creation
- natural-language classification of arbitrary assistant prose
- redesigning familiar-level presence, Inbox, Home, mobile-native iOS, or the
  full Sessions surface

Those surfaces may aggregate the canonical session state in later work, but
they must not block the sidebar improvement.

## Acceptance criteria

1. An explicit structured request appears in Awaiting you immediately after the
   familiar turn completes.
2. A familiar-last conversation remains ordinary before 24 hours and becomes
   `left-hanging` at 24 hours.
3. An unresolved explicit request becomes `overdue-human` at 48 hours.
4. A newer human turn clears all attention states immediately and canonically.
5. Opening or reading a chat does not clear attention.
6. Running and archived sessions derive `none`.
7. Failed and paused runtime states retain their runtime signals without being
   treated as human requests automatically.
8. Awaiting you rows are urgency-ordered and do not duplicate in Recent.
9. Projects and search preserve attention labels and accessible descriptions.
10. Missing or malformed evidence fails to `none` without breaking the list.
11. All attention states use semantic tokens, explicit copy, focus-safe markup,
    and no new continuous motion.
12. The result survives every supported palette and mode combination.

## Test strategy

### Pure model tests

Cover:

- all four states
- exact 24-hour and 48-hour boundaries
- newer human reply precedence
- running and archived exclusions
- explicit-request reason normalization
- malformed and missing timestamp behavior
- ordering by urgency and age

### API tests

Prove:

- session-list responses include normalized attention snapshots
- one malformed conversation does not fail the whole list
- request timestamps come from the request turn rather than `updated_at`
- persistence after a human reply returns `none`

### Component tests

Prove:

- Awaiting you appears above Recent with the correct count
- promoted rows do not duplicate
- Projects and search retain cues
- labels and accessible descriptions include state, reason, and elapsed time
- active, PR, archived, hover-action, keyboard, and drag behavior remain intact

### Design-system and browser checks

Run the existing design lint, token-drift checks, chat-sidebar contract tests,
and targeted app tests. Drive the sidebar at normal and narrow widths in both
dark and light mode, including at least one non-default palette, and verify
that urgency remains clear without relying on color.
