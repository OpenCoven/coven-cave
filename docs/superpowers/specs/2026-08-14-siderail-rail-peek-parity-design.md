# Siderail rail/peek parity: one geometry across collapse

**Issue:** #4351 · **Surface:** left siderail · **Extends:**
[`docs/specs/2026-08-06-sidebar-rail-parity-design.md`](../../specs/2026-08-06-sidebar-rail-parity-design.md)
(frozen store — that record stays as written)

## The defect

Hovering the collapsed 56px nav rail floats the sidebar open as an overlay
(hover-peek). Every control moved. Measured at 1440×900, rail → peek:

| control | dx | dy |
|---|---|---|
| nav rows (Home, Tasks, Rituals, …) | +7 | −88 … −108 |
| scope trigger, New chat | +8 | −78 |
| Dashboard | +39 | +67 |
| Settings | +138 | +27 |

The user's report is the honest description: *"all of the buttons do not line up
horizontally with where they are when the sidebar is collapsed."*

## Why it happened

The 2026-08-06 work made the siderail header identical **across sections**
(Home ↔ Chat). It was still not identical **across collapse**, and nothing in
the stylesheets said it had to be. Four independent causes, all the same shape:

1. **Two coordinate systems.** The rail centres square controls inside 56px; the
   panel left-aligns rows inside 232px. Their icon columns landed 8px apart, and
   the peek overlay's left border added a ninth pixel.
2. **Rail-only controls.** A decorative brand mark on top and an account avatar
   at the bottom had no counterpart in the panel, so everything after them sat
   ~60px out of line with its own peek position.
3. **A different footer shape.** The footer was a horizontal row in the panel and
   a vertical stack in the rail. That is why Settings travelled 138px.
4. **Different density.** Rail and panel used different row heights, gaps,
   container padding, and even icon sizes (20px against 16px).

## The design

Three constants on `.shell-nav`, solving for the same icon centre in both states:

```css
--rail-pad: 4px;      /* band inset inside .shell-nav */
--rail-lead: 8px;     /* leading padding inside an expanded control */
--rail-control: 32px; /* the collapsed rail's square control box */
```

```text
rail  icon centre = --space-2 + (56 - 2*--space-2 - --rail-control)/2 + --rail-control/2
                  = 8 + 4 + 16 = 28px
panel icon centre = --space-2 + --rail-pad + --rail-lead + --icon-md/2
                  = 8 + 4 + 8  + 8 = 28px
```

They are **not independent**:

```text
--rail-pad === (56 - 2 * --space-2 - --rail-control) / 2
```

Change one without the others and the column splits again. The relation is
written on `.shell-nav` in `styles/globals/shell-navigation.css`, pinned by
`src/components/sidebar-rail-header.test.ts`, and measured end-to-end by
`tests/sidebar-rail-peek-parity.spec.ts`.

Everything else follows from reading those constants rather than restating them:

- Rows, header controls and footer buttons take `--rail-control` for height and
  `--rail-lead` for leading padding. The two bordered controls subtract their
  own edge so their glyphs still land on the column.
- Rows take `flex: none`. `.sidebar-nav-scroll` is a flex column, so an
  overflowing list had been quietly compressing rows below their `min-height`,
  which broke the pitch the rail's fixed squares assume.
- The footer becomes a stacked column of **labelled** rows in the panel too.
- One icon scale in both states; New chat keeps its quiet-primary tint rather
  than inverting to a solid accent fill in the rail.
- `"Rooms"` collapses to a hairline that preserves the label's line box instead
  of rendering a full-width uppercase word inside a 56px column.
- The peek drops its left border and left radii: it is pinned to the window edge
  the rail occupies, so that hairline both floated in space and pushed every
  control 1px right.

**Two controls retired.** The brand mark was decorative (`aria-hidden`, no
action) and put a third identity glyph in a column that already carries the
familiar avatar. The account avatar's `onClick` was `onOpenSettings` — the same
action as the Settings button directly above it. Both were rail-only.

Measured after: `dx` 0 for every control, footer `dy` −1.

## What stays unequal, deliberately

The Home/Chat section tabs. Two stacked tabs cannot be as tall as one row of
two, so content below them shifts ~25px on peek. That is under one row's pitch,
so the control under the cursor does not change. Making it zero would mean
stacking the tabs in the expanded panel as well, which costs the panel a compact
segmented control to serve the rail — the wrong trade, since the expanded panel
is the primary experience. Documented on `.shell-nav`.

## Three traps worth keeping

- **A rail-only control is a parity bug in waiting.** Anything the panel does not
  also render displaces everything after it by its own height.
- **Media-query overrides re-split the two states silently.** A
  `@media (max-height: 760px)` block set per-selector row heights and gaps; every
  one of them reached the panel only, because the rail's `.shell-nav--rail`
  rules are more specific and win. At 1280×720 the states diverged again and the
  footer walked 6px. Density belongs on the shared constant, not on the selectors
  that read it. (That block was also incoherent on its own terms: its 31px was
  1px *taller* than the base row it claimed to compact, and its wider gap made a
  short column looser rather than denser. It is gone.)
- **Measure after the entry animation.** The peek enters from
  `translateX(-8px)` over 0.13s, so an early `getBoundingClientRect()` reads the
  slide as a layout shift and reports a few pixels of drift that are not there.
  The spec awaits `getAnimations()` rather than a wall-clock guess.

## Verification

`tests/sidebar-rail-peek-parity.spec.ts` measures the rendered boxes in both
states and asserts that every control holds its icon column and its box left
edge within 1px, that the rail carries no control the panel lacks, and that the
footer band holds both axes. The 1px tolerance is for sub-pixel glyph widths,
not for a layout shift.

## Out of scope

Merging `SidebarMinimal` and `WorkspaceSidebar` into one component (still the
right long-term shape, still not this change). The Chat thread list, recency
buckets and group rows. The iOS app.
