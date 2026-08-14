# iOS Canvas Scroll Header Design

## Goal

Give the native iOS Canvas gallery more vertical space while browsing without
making creation controls hard to recover.

## Interaction

- Keep the `Canvas` title row pinned at the top.
- Show the prompt composer and starter chips in their current layout at rest.
- After a deliberate upward gallery scroll, slide and fade the composer and
  starter chips away together.
- Reveal those controls as soon as the user deliberately scrolls downward.
- Always reveal the controls when the gallery returns near the top.
- Ignore small offset changes so finger jitter and layout updates do not flicker
  the controls.
- When Reduce Motion is enabled, change visibility without translational
  animation.

## Architecture

`CanvasView` will split its current header into:

1. A permanent title row.
2. A collapsible controls region containing `composer` and `starterBar`.

The gallery `ScrollView` will use `onScrollGeometryChange` to report a
normalized vertical offset. Normalization must account for the current top
content inset so changing the collapsible region's height does not look like a
user scroll and immediately reverse the state.

A small value-type scroll-state reducer will own:

- the previous normalized offset;
- accumulated movement since the last direction change;
- whether the controls are visible;
- upward and downward hysteresis thresholds;
- the near-top reset.

The view will apply reducer output to the collapsible region with a short
ease-out opacity-and-offset transition. Existing composer focus, generation,
refresh, and gallery behavior remain unchanged.

## State Rules

- Initial state: controls visible.
- Near top: controls visible and movement accumulation reset.
- Upward movement beyond the hide threshold: controls hidden.
- Downward movement beyond the reveal threshold: controls visible.
- Movement below the jitter threshold: no visibility change.
- Layout-driven inset changes: no direction reversal because decisions use the
  normalized offset.

## Accessibility

- Respect `accessibilityReduceMotion`.
- Do not remove or rename controls, labels, focus behavior, or VoiceOver order.
- If the prompt is focused, scrolling may dismiss the keyboard interactively;
  hiding the controls must not leave an active hidden text field.

## Testing

- Add native unit coverage for initial visibility, upward hide, downward reveal,
  near-top reset, jitter tolerance, and inset-normalized offsets.
- Extend `scripts/ios-canvas-tab.test.mjs` to pin the scroll geometry wiring,
  permanent title row, collapsible controls region, and Reduce Motion handling.
- Run the focused Node contract test and the iOS Canvas unit tests or simulator
  test target available in the repository.

## Scope

This change affects only the native iOS Canvas gallery header. It does not alter
the desktop/web Canvas composer, artifact generation, persistence, detail view,
or component annotation behavior.
