# Chat detail row reference design

## Goal

Match the supplied chat detail-row references while preserving Coven Cave's
existing session facts, project picker, theme tokens, and accessible popover
behavior.

## Chosen approach

Extend `ChatSessionContextRow` instead of replacing the chat header or adding a
parallel overlay. The existing row already owns runtime, branch, project,
model, usage, cost, and duration; keeping that boundary avoids duplicated state
and keeps the change scoped.

## Layout

- Render one 30–32px full-width mono instrument strip under the title row.
- Order the left controls as runtime/model, branch, then project. Controls use
  quiet neutral fills, tinted glyphs, truncated values, and a trailing caret
  where an action is available.
- Render right-side metrics as Done, Elapsed, Context, Tokens, and Cost when
  their source data exists.
- Keep the context mini-meter inline after its value.
- On narrow panes, preserve the single row and allow horizontal scrolling
  rather than removing the metrics.

## Interactions

- Keep the existing shared project picker on the project control.
- Make Done, Elapsed, and Context keyboard-focusable triggers with anchored
  breakdown cards.
- Done summarizes completed transcript tool calls by category.
- Elapsed summarizes thinking, tool, and idle time when those values can be
  derived; unavailable categories are omitted.
- Context shows used/window tokens, a segmented usage bar, input/output/cache
  rows, and remaining capacity.
- Tokens and Cost remain compact facts because the references do not provide
  separate detail cards for them.

## Data and fallbacks

- Derive all values from the existing transcript and last settled assistant
  turn. Never invent placeholder metrics.
- If detailed timing or tool-category data is unavailable, keep the top-level
  metric and omit unsupported detail rows.
- Keep context-window estimation explicit in accessible labels.

## Accessibility and visual system

- Use the shared `Popover`, focus return, Escape/outside-click dismissal, and
  `.focus-ring`.
- Pair every tint with text; color is never the only channel.
- Use semantic design tokens and existing spacing/type/radius steps across all
  themes and modes.

## Validation

- Unit-test the pure detail-row derivation and formatting.
- Update structural component tests for trigger/popover semantics and responsive
  behavior.
- Run targeted tests, lint/type checks covering changed files, and capture the
  real Chat surface at desktop and narrow widths for visual comparison.
