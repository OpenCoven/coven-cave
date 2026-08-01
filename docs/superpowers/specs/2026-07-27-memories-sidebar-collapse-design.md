# Memories sidebar collapse

## Goal

Let people reclaim width in the Memories (`GrimoireView`) workspace without
making its navigator unavailable.

## Interaction

- The navigator remains expanded by default, exactly as it is today.
- A labelled, keyboard-accessible toggle at the top of the navigator collapses
  it only after an explicit click.
- Collapsed state reduces the navigator to a narrow icon rail. The existing
  source groups remain reachable through their icons; each control retains an
  accessible name and a tooltip.
- Expanding restores the full navigator. The preference is stored locally and
  safely falls back to expanded if storage is unavailable or malformed.
- Narrow-container behavior remains unchanged: the existing detail/graph rules
  continue to own the available width.

## Implementation boundary

Keep the change within `src/components/grimoire-view.tsx` and its existing
source-pinned test. Use the existing `ph:sidebar-simple` icon, design tokens,
focus-ring utility, roving navigation convention, and container-query layout.
Do not change document loading, selection, search, or the current per-section
collapse preferences.

## Verification

- Add a failing source-pinned test for the whole-rail preference, accessible
  toggle, collapsed rail semantics, and the preserved responsive rule.
- Run that focused test red, implement the smallest behavior, then rerun it
  green.
- Run the relevant component test group and `pnpm lint` if the touched
  Tailwind/design rules require it.
