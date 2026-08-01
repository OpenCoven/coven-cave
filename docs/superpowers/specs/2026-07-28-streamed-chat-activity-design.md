# Streamed chat activity design

## Goal

Make an assistant turn explain its live work without interrupting the answer:
thinking streams in a compact inline disclosure, and adjacent repeated tool
calls become one expandable run with an honest call count.

## Existing contracts retained

- `/api/chat/send` and persisted `ToolEvent` data stay unchanged.
- `splitReasoning()` continues to strip complete and partial `<thinking>` /
  `<reasoning>` tags from visible prose while a turn streams.
- `segmentTurn()` remains the chronology boundary. A tool run can only be
  grouped within one tool segment; it never crosses an assistant text span.
- Structured edit cards remain individual, actionable items and are excluded
  from rollups.

## Interaction

### Streamed thinking

When a pending assistant turn contains reasoning, render the reasoning
disclosure before the visible answer. It is open while pending, identifies the
activity as “Thinking”, and updates as chunks arrive. Once the turn settles it
returns to the normal collapsed state, except when the existing global “Show
thinking” preference is enabled. The body remains formatted with `RichText`.

### Consecutive tool runs

Partition each chronological tool segment into maximal consecutive runs of the
same normalized tool name. A run of one call keeps the existing `ToolBlock`.
A run of two or more calls renders one `ToolRunGroup` disclosure whose summary
uses the exact display name and the count, for example `Read · 3 calls`.
Opening it renders every existing `ToolBlock`, preserving all inputs, output,
status, duration, file actions, and error treatment.

The group boundary is intentionally strict: prose, a progress event, a
different tool name, a structured edit, or a non-adjacent segment ends the
run. This avoids claiming unrelated activity was one action.

### Completed turns

The existing completed-turn work line continues to summarize all non-edit
activity. Its expanded content uses the same run presentation, so users see
the same grouping whether they open a completed work line or watch the turn
stream.

## Visual and accessibility contract

- Reuse `cave-tool-summary`, `cave-tool-block`, semantic tokens, existing
  disclosure chevron, and `.focus-ring` behavior; add only tokenized layout
  rules required for a nested run.
- The group summary has a clear accessible name containing its tool and call
  count. Native `<details>/<summary>` supplies keyboard interaction and
  expanded/collapsed semantics.
- Existing reduced-motion behavior remains unchanged; no new animation is
  required.

## Verification

Focused source tests must prove the run partitioning and each render path,
including the live-thinking open state and settled collapse behavior. The
chat-polish suite and the project lint/type checks then validate integration.
