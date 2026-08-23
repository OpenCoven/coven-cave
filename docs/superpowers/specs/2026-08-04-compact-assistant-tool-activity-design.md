# Compact assistant-turn tool activity

## Summary

Replace the current tall tool-activity presentation with one compact disclosure
per assistant turn. The collapsed row summarizes call count and tool categories,
while expansion preserves access to every call's existing input, output, status,
and duration.

File-edit cards remain visible outside the disclosure because their Review and
Undo actions are primary transcript actions. This work changes presentation
only; tool event parsing, persistence, and runtime semantics remain unchanged.

## Goals

- Render one compact tool-activity disclosure per assistant turn.
- Summarize the turn as `<count> calls · <categories>`.
- Preserve detailed inspection of every non-edit tool call.
- Group consecutive calls to the same tool without hiding one-off calls.
- Auto-expand only a repeated group that contains running calls.
- Collapse that repeated group when all of its calls settle.
- Keep failures and running state visible while disclosures are collapsed.
- Reduce expanded height by using compact rows and removing redundant card
  framing.

## Non-goals

- Changing tool event ingestion, normalization, persistence, or replay.
- Combining activity from multiple assistant turns.
- Moving file-edit cards or their Review and Undo actions into the rollup.
- Guessing concurrency or execution relationships not represented by the
  transcript.
- Adding a session-wide preference for tool disclosure state.

## Existing behavior

`ToolGroup` in `src/components/chat-view.tsx` already provides one collapsed
`details` element for a settled turn's non-edit tool activity. Its summary
emphasizes duration, step count, the last shell command, batch count, and
successful-call count. Expanded content uses `ToolRuns`, which combines
consecutive same-name calls through `groupConsecutiveTools`, while
`ToolRunGroup` and `ToolBlock` provide nested disclosures.

The turn renderer already separates structured file mutations from other tool
events and renders those edit cards visibly. That separation remains the
authority boundary for this design.

## Architecture

### Turn-level disclosure

Extend the existing `ToolGroup`; do not introduce a second activity component or
change the turn data model.

The outer `details` remains collapsed by default and belongs to exactly one
assistant turn. Its summary contains:

1. A disclosure caret.
2. A tool/activity icon.
3. The total non-edit call count.
4. Distinct tool categories in first-seen order.
5. Running and error status when present.

The primary phrase is:

```text
8 calls · search, read, shell
```

Use the existing `toolCategory` classification. Categories are de-duplicated in
first-seen order so the summary reflects the turn's progression without
reordering it by count. If available horizontal space is exhausted, the
category phrase truncates; the call count and non-success status must remain
visible.

The current duration, last-command, batch, and successful-call phrases leave
the outer summary. Duration remains available on individual calls and batch
headers where already recorded.

### Expanded content

`ToolRuns` remains responsible for rendering ordered non-edit tool activity.
It continues to use transcript order and existing batch boundaries.

- A one-off call renders as one compact collapsed row.
- Two or more consecutive calls with the same normalized tool name render as a
  repeated-call subgroup.
- A repeated-call subgroup summary uses the tool's readable name and count,
  such as `Read ×4`.
- Expanding a one-off row or subgroup reveals the existing readable input,
  output, status, and duration surfaces.
- Existing batch bands may remain when they communicate a real multi-call
  transcript batch, but spacing and nested framing become compact enough that
  the expanded turn reads as one activity list rather than stacked cards.

Grouping is presentational. It must not merge non-consecutive calls or reorder
events.

### File-edit cards

The turn renderer continues splitting structured file mutations from other
tools before rendering `ToolGroup`.

Edit cards remain visible in the transcript and outside the tool disclosure.
Their current structured diff, Review, Undo, aggregate changed-files action,
status, and duration behavior remain unchanged. Repeated edit calls are never
collapsed into a repeated-call subgroup.

## Disclosure state

### Outer turn disclosure

The outer assistant-turn disclosure stays collapsed by default, including while
tools are running. The summary itself carries running and error state, so
activity remains observable without forcing the transcript open.

The user may manually expand or collapse it at any time. No state is persisted
across reloads or shared between turns.

### Repeated-call subgroup

A repeated-call subgroup is controlled by two inputs:

- whether any contained call is currently `running`;
- whether the user has manually toggled the subgroup.

Required transitions:

1. A newly formed repeated group with a running call opens automatically.
2. It stays open while any contained call is running.
3. When the final running call settles, it collapses automatically.
4. After settlement, the user may expand or collapse it normally.
5. A later transition back to running opens it again.

This automatic behavior applies only to repeated-call subgroups. One-off calls
never auto-expand.

## Status and failure handling

Collapsing must not hide whether work is incomplete or failed.

- The outer summary shows a textual running count when any call is running.
- The outer summary shows a textual error count when any call failed.
- Repeated subgroup summaries expose their own running and error counts.
- Individual compact rows retain their status text.

Status uses iconography or text in addition to semantic color. Existing detailed
error output remains available by expanding the relevant row.

Compatibility and lifecycle notices are `ProgressEvent` records rather than
`ToolEvent` records. They remain in the existing `ProgressGroup`, where their
notice label and icon stay visible; this design does not merge progress events
into the tool-call disclosure.

## Visual design

The outer disclosure is a single low-height hairline-bordered row using design
tokens and the existing focus-ring contract. It should read as secondary
transcript metadata, not as another answer card.

Expanded content:

- uses the 4px spacing grid;
- removes redundant outer borders where the parent disclosure already provides
  containment;
- keeps compact row heights while preserving usable pointer targets;
- retains category accents as a scanning aid, never as the only status signal;
- preserves readable truncation for long tool names and arguments;
- avoids hardcoded colors, off-grid spacing, and static inline styles.

Transitions use existing duration and easing tokens. Under
`prefers-reduced-motion`, disclosure state changes occur without decorative
animation.

## Accessibility

- Use native `details` and `summary` keyboard behavior.
- Apply the shared visible focus-ring treatment to every interactive summary.
- Give the outer summary an accessible label containing call count and current
  running/error state.
- Give repeated groups labels containing the readable tool name, call count,
  and current running/error state.
- Keep status text available to assistive technology; do not rely on colored
  dots or borders.
- Preserve logical DOM and focus order when groups automatically open or close.
- Automatic collapse must not move focus. If focus is inside a repeated group
  when its calls settle, defer collapse until focus leaves the group.

## Testing

Add focused tests for:

- category summaries de-duplicated in first-seen order;
- singular and plural call-count copy;
- one outer disclosure per assistant turn;
- file-edit cards remaining outside that disclosure;
- one-off calls rendering as compact collapsed rows;
- consecutive repeated calls rendering as one counted subgroup;
- non-consecutive same-name calls remaining separate;
- a running repeated subgroup opening automatically;
- the subgroup collapsing after its final call settles;
- focus inside a settling subgroup preventing disruptive collapse;
- one-off running calls remaining collapsed;
- manual expansion after settlement;
- running and error text in collapsed tool summaries;
- existing progress-notice visibility remaining unchanged;
- accessible labels containing count and non-success status;
- existing readable input/output and edit-review behavior remaining intact.

Use the existing chat tool-activity and transcript tests as regression coverage.
Run the targeted app tests, TypeScript checks, and design-system lint/codemod
checks covering the touched component and styles.

## Acceptance criteria

1. Every assistant turn with non-edit tool activity renders one collapsed
   summary row.
2. The row reads `<count> call(s) · <distinct categories>` and exposes running
   or failed state without expansion.
3. File-edit cards remain visible outside the row with working Review and Undo
   actions.
4. Expanded one-off calls occupy one compact row each.
5. Consecutive repeated calls occupy one counted subgroup.
6. Only a repeated subgroup with running calls auto-expands.
7. That subgroup collapses after settlement unless doing so would move focus.
8. All existing tool details remain inspectable.
9. Tool event storage and runtime behavior are unchanged.
10. The surface passes targeted behavior, accessibility, type, and design-token
    checks.
