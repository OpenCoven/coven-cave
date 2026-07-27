# Familiar rooms UI refinement

## Objective

Make every registered familiar room feel like one coherent, minimal desktop
workspace while preserving each room's vocation-specific workflow and every
existing capability.

The registered rooms are Research Desk, Code Workshop, Comms Operations,
Watchtower, Writing Desk, Chart Room, Review Deck, and The Archive.

## Success criteria

- Every room uses one clear header hierarchy, status pattern, action budget,
  pane grammar, and drawer interaction.
- Room chrome exposes no more than three persistent actions plus one overflow.
- Secondary rails remain reachable but do not dominate narrow panes.
- Loading, empty, filtered-empty, and failure states are distinguishable,
  accessible, and tell the user what to do next.
- Keyboard focus, menu dismissal, focus return, mutation announcements, and
  reduced motion follow the Coven design contract.
- All room capabilities remain reachable in at most two interactions.
- The room shell survives narrow containers, dark and light mode, and at least
  one non-default palette without clipped controls or double scroll regions.
- Existing room tests, typecheck, lint, design-token drift, and browser review
  pass.

## Current-state findings

The shared primitives already establish a useful three-part grammar: rails,
canvas, and an optional bottom drawer. The implementation has drifted from the
current design contract in several places:

- The host duplicates static role metadata in a badge and can repeat room
  status already shown inside a room, especially Research Desk.
- The command menu is a custom absolute-positioned menu without the shared
  popover behavior for outside click, Escape, focus return, or auto-flip.
- Toolbar actions are all persistent text pills even when they are secondary,
  increasing header noise.
- `SurfaceEmpty` is visually quiet but cannot provide an action, loading
  semantics, filtered-empty recovery, or an explicit error state.
- Room responsiveness uses a viewport media query rather than the room's
  container, despite rooms being dockable and resizable.
- Narrow layouts stack both rails around the canvas, making the primary work
  hard to find and producing long nested scroll regions.
- Shared CSS contains raw state colors and off-contract sizing that weakens
  theme consistency.
- Several rooms silently convert failed requests into empty collections.

Research Desk and Code Workshop are intentional architecture exceptions:
Research Desk is a five-tab control plane with its own responsive system, and
Code Workshop embeds the mature CodeView. They should inherit the refined host
but should not be forced into `SurfaceRoom`.

## Chosen approach

Use a shared-contract-first refinement.

1. Refine `RoleSurfaceHost` into a quieter, accessible room header.
2. Strengthen `SurfaceRoom` and its furniture primitives with semantic state
   components and container-aware rail disclosure.
3. Migrate the six `SurfaceRoom` rooms to those primitives with surgical copy
   and state fixes.
4. Apply host-level consistency only to Research Desk and Code Workshop.

This approach is preferred over bespoke redesigns because it produces the most
consistent result with the least duplicated code and the lowest collision risk.
A new shell is rejected because the current registry and room boundaries are
sound; the problem is refinement, not architecture.

## Interaction design

### Header

The header contains:

- room icon and title;
- one concise live status, when meaningful;
- up to two direct room actions;
- one overflow menu for infrequent commands.

The static role name moves to accessible context rather than a persistent badge.
Status details remain available as a tooltip and accessible label. The overflow
uses the shared popover scaffold and restores focus to its trigger.

Warnings render as one compact semantic notice below the header. Duplicate
daemon status inside a room is removed when the host already communicates it.

### Room layout

Wide containers retain the current left rail, canvas, and right rail. The canvas
is always the visual and keyboard priority.

At medium widths, the right rail becomes an on-demand inspector controlled by a
shared button. At compact widths, both rails become labeled disclosure panels
above or below the canvas, closed by default unless they contain the active
selection. The room, not the viewport, determines these transitions through
container queries.

The bottom drawer remains closed by default and uses one consistent toggle row.
Its state continues to persist through each room's existing state model.

### State components

`SurfaceEmpty` gains optional description and action content while retaining a
compact room-appropriate presentation. Dedicated `SurfaceLoading` and
`SurfaceError` primitives prevent loading and failure from masquerading as
empty data.

- Loading uses `role="status"`, an object-specific label, and compact skeletons.
- Error uses `role="alert"`, safe detail, and a retry action when available.
- Filtered empty states offer a clear-filter action.
- True empty states name the next useful action.

### Controls and copy

Shared inputs use persistent labels where context is not self-evident. Search
and filter placeholders use the canonical `Filter <items>…` grammar. Static
metadata becomes muted text unless it represents live state. Semantic warning,
danger, success, and information styles derive from existing tokens.

Mutations that publish, move, resolve, approve, or otherwise change durable
state announce completion through `useAnnouncer()`.

## Room-specific refinements

- **Comms Operations:** distinguish inbox failure from an empty inbox; make New
  draft the single primary rail action; reduce repeated approval chrome.
- **Watchtower:** use semantic status rows and retryable escalation/host errors;
  avoid repeating daemon state in both host and rail.
- **Writing Desk:** keep drafting central, move destructive discard behind
  secondary disclosure, and announce publish completion.
- **Chart Room:** make task intake explicit and compact; distinguish board load
  failure; announce task creation and lane moves.
- **Review Deck:** preserve its specialized review layout and stylesheet while
  aligning host actions, error recovery, and announcement behavior.
- **The Archive:** use the shared search control semantics, add clear-filter
  recovery, and distinguish memory read failure from an empty file.
- **Research Desk:** retain the five-tab host; remove duplicated engine status
  when the room header already reports it, or reduce the host status to avoid
  repetition.
- **Code Workshop:** retain CodeView unchanged; inherit the quieter header and
  shared host states only.

## Error handling

Requests must keep separate `loading`, `data`, and `error` state. A failed
request never commits an empty array solely to make rendering convenient.
Retries re-run the same scoped loader. Existing safe diagnostics remain terse
and do not expose private paths or response bodies.

The room-level error boundary remains as the final containment layer and gains
a direct way back to a stable Cave surface.

## Testing and validation

- Add source-contract tests for header budget, shared semantic state
  primitives, popover adoption, and container-query behavior.
- Update focused room tests for changed copy and controls.
- Run the room-focused tests in one alias-loader invocation where possible.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm codemod:design:check`, and the
  design-token drift suite.
- Launch the real web app with demo data and inspect all eight rooms at wide,
  medium, and compact widths.
- Review Coven dark, Coven light, and one non-default palette.
- Verify keyboard-only navigation, Escape/focus return, visible focus, drawer
  disclosure, and retry actions.

## Scope boundaries

- No new room, backend integration, or synthetic data.
- No removal of a capability.
- No role-specific branching in the shell.
- No architectural rewrite of Research Desk or Code Workshop.
- No unrelated redesign of global navigation, chat, tasks, settings, or the
  familiar profile surfaces.
