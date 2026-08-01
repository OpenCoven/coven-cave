# Dia-Style Sidebar Edge Design

**Bead:** `cave-9q0v`

## Objective

Make Coven Cave's expanded desktop sidebar and collapsed hover-peek read as one
inset floating surface, following the supplied Dia-style reference, without
changing navigation state, routing, widths, resize persistence, or mobile
behavior.

## Owning seam

The behavior belongs in `src/styles/globals/shell-navigation.css`. Both the
expanded sidebar and hover-peek already render as direct `.shell-nav` children
of `.shell-nav-panel`; their distinction is layout geometry, not component
ownership. A focused source-contract test pins the shared silhouette and state
differences, and `scripts/run-tests.mjs` wires that contract into `test:app`.

No React component or responsive stylesheet needs to change.

## Selected design

At desktop widths (`min-width: 1024px`), every non-rail sidebar surface owns
the same visual treatment:

- one token-driven hairline border;
- `--radius-panel` corners;
- restrained elevation derived from `--shadow-color`;
- horizontal clipping at the rounded edge;
- preserved `overflow-y: auto` for long navigation content;
- the same grid-aligned inset around expanded and hover-peek states.

The expanded sidebar remains in normal flex layout and consumes its existing
resizable allocation. Its width is reduced by the shared inline margins; flex
stretch continues to provide full available height. The hover-peek remains
absolutely positioned over content and gets the same inset through that shared
margin rule.

The collapsed `.shell-nav--rail` is deliberately excluded. It stays flush and
square so its icon hit areas and persistent-column reading do not change.

The detail canvas loses its competing rounded leading gutter. The sidebar is
the sole elevated object; the main canvas returns to `--bg-base`.

## State matrix

| State | Layout | Surface treatment |
| --- | --- | --- |
| Expanded desktop | Existing flex allocation | Inset, rounded, bordered, elevated |
| Hover-peek desktop | Existing absolute overlay | Same inset and silhouette |
| Collapsed rail | Existing compact allocation | Flush, square, no elevation |
| Mobile drawer | Existing responsive rules | Unchanged; desktop rule does not apply |

## Accessibility and compatibility

- Vertical scrolling remains available through explicit `overflow-y: auto`.
- Existing focus order, landmarks, keyboard controls, and focus rings are
  unchanged.
- No new motion is introduced; existing reduced-motion behavior remains
  authoritative.
- All colors, radius, spacing, and shadow inputs use existing design tokens and
  therefore inherit all theme/mode combinations.
- Mobile behavior is protected structurally by the desktop-only media query,
  avoiding a second responsive override to maintain.

## Verification contract

`src/components/sidebar-floating-edge.test.ts` pins:

1. the shared desktop selector and token-driven border/radius/shadow;
2. horizontal clipping plus preserved vertical scrolling;
3. the common grid-aligned inset;
4. expanded flex geometry and unchanged absolute hover-peek positioning;
5. exclusion of the collapsed rail;
6. removal of the detail-pane gutter;
7. absence of floating-surface changes from the mobile stylesheet.

The focused contract, complete app suite, lint, typecheck, test wiring, build,
bundle budgets, and CI must pass before merge.

## Non-goals

- Replacing `react-resizable-panels` or changing remembered widths.
- Making the expanded sidebar cover the main content.
- Redesigning rows, labels, familiar scope, badges, or footer actions.
- Changing collapsed-rail or mobile-drawer interaction.
- Adding colors, typography, icons, or animation.
