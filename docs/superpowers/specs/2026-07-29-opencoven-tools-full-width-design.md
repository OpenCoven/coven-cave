# OpenCoven Tools Full-Width Settings Control Design

## Goal

Make the OpenCoven Tools control on Settings > About use the full available
content width on desktop while keeping the CovenCave control compact and
preserving the existing mobile layout.

## Current Problem

The About controls use a two-column grid. CovenCave and OpenCoven Tools each
occupy one column, so the denser OpenCoven Tools content is constrained to half
the available width even though it benefits from a wider row.

## Chosen Approach

Keep the existing grid and add a focused wide modifier to the OpenCoven Tools
control:

- CovenCave remains in the first column at its current width.
- OpenCoven Tools moves to the next row and spans the full grid with
  `grid-column: 1 / -1`.
- The existing `55rem` container breakpoint continues to collapse the grid to
  one column, so mobile and narrow-pane behavior remain unchanged.

This is preferred over making every control full width because it preserves the
compact treatment of the smaller CovenCave section. It is also preferred over
introducing template areas or a separate grid because a single semantic
modifier expresses the layout requirement without restructuring the surface.

## Component and Styling Contract

- Add `settings-about-control--wide` to the existing OpenCoven Tools control
  container only.
- Define the modifier beside the controls-grid rules in
  `src/styles/settings-about.css`.
- Use the existing grid, breakpoint, spacing, and design tokens without adding
  new tokens or hardcoded dimensions.
- Do not change OpenCoven Tools behavior, copy, diagnostics, update actions, or
  accessibility semantics.
- Do not change the CovenCave control or the About links bento.

## Responsive Behavior

- Desktop: CovenCave occupies one grid column; OpenCoven Tools spans both
  columns on the row below.
- At or below the existing `55rem` container breakpoint: both controls remain
  in the current single-column flow.
- The modifier must not create implicit columns or horizontal overflow.

## Testing and Verification

- Add a source-contract test that pins the modifier to the OpenCoven Tools
  container and pins `grid-column: 1 / -1` in the stylesheet.
- Run the focused About component test, design lint and codemod checks, the
  relevant app suite, typecheck, and production build.
- Render Settings > About in the real app at desktop and narrow widths and
  confirm the intended row geometry without overflow.

## Exclusions

- No changes to update logic, daemon status, diagnostics, external links, copy,
  or navigation.
- No redesign of the About page, links grid, cards, or responsive breakpoints.
- No new shared layout abstraction for this one-control geometry change.
