# Settings About Podcast Bento Remainder-Fill Design

## Goal

Make the Open Coven Weekly podcast card consume the unused remainder of its
About-page bento row while preserving the existing card order, content,
interaction, artwork, and design tokens.

## Current Problem

The About links bento uses four columns by default and two columns below the
`55rem` container breakpoint. The Discord card occupies one column, while the
podcast card always spans two:

- in the four-column layout, one column remains empty beside the podcast;
- in the two-column layout, the podcast cannot fit beside Discord and wraps to
  a new full-width row.

The existing one-column layout below `36rem` is already correct.

## Chosen Approach

Use breakpoint-aware column spans on the existing podcast card:

- default four-column grid: podcast spans three columns;
- two-column grid at or below `55rem`: podcast spans one column;
- one-column grid at or below `36rem`: podcast remains one column.

This lets normal grid auto-placement pair Discord and the podcast without
hard-coding a start line or changing DOM order.

Rejected alternatives:

- `grid-column: 2 / -1` couples the podcast to Discord's exact placement and
  needs extra breakpoint overrides.
- Explicit grid-template areas restructure the whole bento for a one-card
  geometry correction and add unnecessary maintenance.

## Visual and Interaction Contract

- Desktop: Discord occupies one quarter of the row and the podcast fills the
  remaining three quarters.
- Intermediate: Discord and the podcast share one row at equal width.
- Mobile: the podcast remains full width.
- Card copy, artwork, click target, focus treatment, hover motion, release
  rail, and all theme behavior remain unchanged.
- The grid must not create implicit columns or horizontal overflow.

## Testing

- Add a focused source-contract assertion for the default three-column span
  and the `55rem` one-column override before changing the stylesheet.
- Run the focused About component test and the relevant design gates.
- Render the About surface at representative four-, two-, and one-column
  widths in light and dark modes.
- Confirm the podcast fills the intended remainder and no horizontal overflow
  appears.

## Exclusions

- No markup, copy, navigation, or external-link changes.
- No changes to any other About card's placement or styling.
- No new design tokens, breakpoints, or shared grid abstractions.
