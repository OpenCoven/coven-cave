# Thread Signal Chat Overlay Design

## Goal

Show the complete Thread Signal card above chat content without adding it to the
conversation log or changing transcript scroll height. Preserve the card's
existing score explanations, signal triage, dismissal, analytics navigation,
task creation, keyboard behavior, and responsive layout.

## Chosen Direction

Host the card in an absolutely positioned overlay inside the transcript column
but outside the scrollable conversation log.

This is preferable to:

- **Keeping the card as a transcript row.** It preserves simple document flow,
  but the card's arrival, dismissal, and content changes alter transcript height
  and move the reader's place.
- **Using a viewport-level portal.** It guarantees non-flow placement, but loses
  the chat column's natural bounds and complicates split panes, side inspectors,
  and responsive sizing.

The local overlay host gives the card the chat column as its containing block
while keeping the transcript's layout and scroll measurements independent.

## Structure

- Add a positioned host around the transcript column.
- Keep the existing conversation `role="log"` as the only scroll container.
- Render `ThreadSignalCard` after the transcript scroller, as a sibling rather
  than a descendant of the conversation log.
- Place a full-inset absolute overlay over the transcript column.
- Bottom-align and horizontally center the card with a bounded maximum width.
- Let empty overlay space pass pointer input through to the transcript while the
  card itself remains interactive.

The card remains a size container, so its existing two-to-three-column score
layout responds to the card's actual width in narrow windows and split panes.

## Overflow and Layering

The overlay is bounded by tokenized insets and the height of the transcript
column. If the card is taller than the available space, the card scrolls
internally instead of expanding the transcript or escaping the chat surface.
Overscroll remains contained within the card.

The overlay sits above transcript content and the existing Thread Signal row
detail popovers. Its surrounding transparent area does not become an invisible
input shield. A token-derived shadow separates the floating card from messages
without introducing a new surface color.

## Interaction and Accessibility

- Preserve the existing `Thread Signal` article label and all visible action
  labels.
- Preserve toggle semantics for score tiles and signal rows.
- Preserve `Escape` dismissal of an open signal detail.
- Preserve focus rings, announcements, deferred dismissal with Undo, analytics
  navigation, task creation, and resolution-thread launches.
- Do not add modal semantics or a focus trap: the overlay supplements the chat
  and does not block interaction with it.
- Do not add entrance motion. Reduced-motion behavior therefore needs no special
  overlay exception.

## State and Data Flow

`chat-view.tsx` continues to own the ephemeral `threadSignalReport` state.
Receiving a settled self-report sets that state and mounts the overlay.
Dismissal clears it after the card's existing Undo window. The card receives the
same report and callbacks as before; no report generation, scoring, persistence,
or API contract changes.

## Failure Behavior

The overlay adds no asynchronous work. Existing task-creation failures remain
announced by `ThreadSignalCard`, and analytics navigation and resolution-thread
launch behavior remain unchanged. Content overflow degrades to internal
scrolling rather than clipping or changing transcript height.

## Verification

- Pin that `ThreadSignalCard` renders in the overlay host after the transcript
  tail, not inside the conversation log.
- Pin absolute positioning, click-through surrounding space, interactive card
  content, bounded width, and internal overflow.
- Keep the existing Thread Signal keyboard, action, dismissal, responsive, and
  row-detail overlay tests green.
- Measure transcript `scrollHeight` before and after the Thread Signal appears;
  the values must be identical.
- Inspect constrained and wide chat panes to confirm the card remains reachable,
  does not cover the composer, and does not overflow the chat column.
- Run targeted component tests, typecheck, lint, build, and the design-system
  checks required for changed UI files.

## Out of Scope

- Changing self-report generation, scoring, persistence, or dismissal storage.
- Redesigning the Thread Signal card's content or action hierarchy.
- Changing the Familiar Analytics Thread Signals surface.
- Turning the overlay into a modal, toast, or viewport-level portal.
