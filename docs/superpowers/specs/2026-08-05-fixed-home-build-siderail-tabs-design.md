# Fixed Home and Build Siderail Tabs

## Goal

Keep the global section switcher in one stable location while moving between
the Home and Build rooms. The switcher is the first interactive control inside
the left siderail in both states.

## User Interface

- The two visible labels are `Home` and `Build`, in that order.
- The existing segmented-control appearance, icons, active treatment, tooltips,
  keyboard navigation, and collapsed-rail behavior remain unchanged.
- The switcher renders before the familiar selector, New chat action, sidebar
  options, destination rows, projects, and sessions in both siderail hosts.
- Switching sections changes the selected tab and room content without changing
  the switcher's top offset or DOM position within the siderail.

## Implementation

Use the existing `NavSectionTabs` component in both hosts:

1. Move its `SidebarMinimal` render before the familiar selector and New chat
   controls.
2. Keep its `WorkspaceSidebar` render as the first child of the full sidebar.
3. Change the `code` section descriptor's visible label from `Code` to `Build`.
   Preserve the internal `code` section identifier and all routing semantics.
4. Update comments and assertions that describe the visible `Home | Code`
   control.

No CSS ordering, new wrapper component, route rename, or data migration is
needed.

## Accessibility

The existing tablist and roving-tab behavior remain authoritative. DOM order
matches visual order, so keyboard and screen-reader users encounter Home and
Build before room-specific controls.

## Verification

- Assert the registry exposes the visible labels `Home` and `Build`.
- Assert both siderail hosts mount `NavSectionTabs` before their first
  room-specific control.
- Run the focused navigation-section and sidebar tests.
- Confirm the switcher occupies the same top position in Home and Build in the
  real app at expanded and collapsed widths.
