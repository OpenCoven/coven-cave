# Notification Dropdown Layering Design

## Goal

Keep the open notification dropdown above workspace content without permanently
raising the title bar above drawers, dialogs, or other transient overlays.

## Root Cause

`Workspace` mounts `NotificationBell` in `FamiliarMenuBar`, inside
`.shell-top`. In the native Tauri shell, the title-bar glass rule applies
`backdrop-filter` to `.shell-top`. That creates a stacking context at the
default level, so the dropdown's local `z-50` cannot out-rank later shell
content even though every ancestor allows visible overflow.

The old `.sidebar-foot-bell` rules are not the active seam: the shared sidebar
footer no longer renders notifications.

## Design

While `.notification-bell__popover` is mounted, give `.shell-top` a transient
z-index above in-content layers. Use `:has()` so closing the dropdown returns
the title bar to its normal stacking level. Keep the value below drawers,
portaled popovers, drag ghosts, and modals.

Do not portal or restructure `NotificationBell`; its placement, focus trap,
mobile layout, and dismissal behavior remain unchanged.

## Verification

- Pin the conditional title-bar selector and layer in the shell chrome source
  contract.
- Run the focused shell chrome test before and after the CSS change.
- Run changed-file lint, the design codemod check, and `git diff --check`.
- Open the bell in the native Tauri shell and confirm it paints above the
  workspace content.
