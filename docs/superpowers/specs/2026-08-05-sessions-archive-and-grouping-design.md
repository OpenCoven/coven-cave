# Sessions archive visibility and grouping control

## Purpose

Keep archived chat visibility in the Sessions list, rather than in Chat's
contextual side rail. Replace the Sessions grouping dropdown with a compact, direct, three-choice
segmented control.

## Scope

### Archive visibility

- `ChatList` remains the only UI that can opt into archived sessions.
- The archive control remains beside the Sessions search and filtering tools.
- `WorkspaceSidebar` no longer offers "Show archived", fetches archived rows,
  or passes an archive opt-in to the shared session visibility filter.
- The Chat side rail therefore always uses the default archive-free view.
- Existing per-row archive and unarchive actions stay unchanged. Once a session
  is archived from the rail, the normal session refresh removes it from that
  rail.

### Session grouping

- Replace the native grouping `<select>` on `ChatList` with a compact segmented
  `role="group"` of mutually exclusive pressed buttons.
- The equal-width choices are labeled `Flat`, `Project`, and `Date`, mapping
  respectively to the existing `none`, `project`, and `date` values.
- The control uses the existing `groupBy` state and normalization, so grouping,
  sorting, filtering, and drag behavior do not change.
- The control exposes pressed state with `aria-pressed`, keeps the existing
  focus styling, and does not use tab roles, `aria-controls`, or `idPrefix`.

## Error handling

The removed sidebar archive fetch also removes its archive-visibility-specific
error path. Per-row archive errors remain in the side rail. The Sessions
archive fetch and its existing behavior are unchanged.

## Verification

- Update the archive-visibility source-contract test to require archive opt-in
  only in `ChatList` and to forbid it in `WorkspaceSidebar`.
- Update workspace sidebar wiring tests so they no longer require the removed
  visibility menu.
- Add or update a Sessions list source-contract assertion for the segmented
  `Flat`, `Project`, and `Date` control.
