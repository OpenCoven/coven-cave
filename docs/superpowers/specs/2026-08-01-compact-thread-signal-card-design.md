# Compact Thread Signal Card Design

## Goal

Reduce the visual footprint of Thread Signal cards in chat without hiding
confidence, tool reliability, context pressure, blocker information, or actions.
The card preserves chat as the primary surface when the available pane is
narrow.

## Layout

- Treat the card as a size container so its layout responds to the actual chat
  pane width rather than the viewport.
- Render the three score items in one column by default.
- Switch directly to three equal columns at a card width of `560px`.
- Do not introduce a two-column intermediate layout.
- Keep the header on one row when it fits. Allow the metadata to truncate rather
  than widening the card.
- Keep actions wrapped so they remain reachable without horizontal overflow.

## Density and Shape

- Use `--space-2` for card padding and primary internal gaps.
- Use `--space-1` for score-item padding and `--space-6` for action minimum
  height while retaining legible text and clear hover and focus states.
- Use `--radius-sm` for the card and score items so they read as compact
  information surfaces rather than large pills.
- Preserve the current semantic surface, border, text, and severity color
  tokens.

## Responsive Behavior

- Constrained chat panes receive the compact one-column score layout and use the
  full available chat width.
- Wide card containers receive the three-column score layout.
- Secondary rails and panels must not force the card into a compressed
  multi-column layout.
- The same rules apply in desktop split panes and narrow windows because the
  breakpoint is based on card width.

## Accessibility

- Preserve the `Thread Signal` article label and existing semantic headings.
- Keep action labels visible; do not replace them with icon-only controls.
- Preserve keyboard focus visibility and readable severity distinctions.
- Do not rely on color alone for context severity; the text label remains.

## Verification

- Add source-level assertions for compact tokenized spacing, the smaller radius,
  and the one-to-three-column container-query behavior.
- Verify the card has no two-column state.
- Run the targeted Thread Signal tests, changed-file lint, and the design
  codemod drift check.
- Inspect the card in constrained and wide chat panes to confirm it does not
  overflow and that the wide layout activates only when the card has room.

## Out of Scope

- Changing Thread Signal data, scoring, dismissal behavior, or report actions.
- Redesigning the Familiar Analytics Thread Signals section.
- Automatically opening or closing chat side rails.
