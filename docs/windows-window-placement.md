# Windows window placement and appearance

Windows main-window startup fits the normal window, including its native frame,
to the selected monitor's work area before showing it. The preferred logical
size is 1320 × 820, with a 960 × 600 minimum that yields to a smaller work area.
A saved rectangle selects the monitor with the largest overlap. If that monitor
is gone, startup centers a fitted default on the available preferred monitor.

The primary main window records normal outer geometry in version 1 of
`main-window-placement.json` under Tauri's application configuration directory.
Secondary main windows and Quick Chat do not replace it. Focus loss and normal
close are persistence points; maximize, minimize and fullscreen geometry are
excluded. Win32 presentation state is queried directly because a move event can
precede the framework's cached maximize-state update.

Malformed, unreadable, oversized and future-version configuration is preserved,
and that session does not overwrite it. Failed replacement preserves the prior
file. To reset placement, quit Cave and move this one file aside, retaining it
for recovery; do not remove the application configuration directory. An older
build can ignore this file. Rolling back the code requires no data migration.

The native title bar follows the app's resolved light/dark mode. Tray contrast
instead follows Windows `SystemUsesLightTheme`: black on a light taskbar, white
on a dark taskbar. Native settings/theme messages refresh the existing icon,
even when the app has explicitly selected its own theme. Missing or invalid
system appearance information retains the white fallback. The existing icon's
silhouette and alpha are preserved; no polling worker is added.

Quick Chat uses the actual tray rectangle where available, otherwise the cursor
monitor and then the primary monitor. It fits its outer rectangle, including
shadow extents, within that work area. Reopening repositions the existing window;
a user resize is retained in logical units when moving between display scales.
Native chrome selection and an optional global shortcut remain separate decisions.

## Acceptance still requiring Windows

Local arithmetic and React tests do not establish native display behavior.
The Windows PR lane compiles the native application and runs the placement,
configuration and tray tests, including a real HWND maximize/minimize check.
Record its actual result before claiming Windows compilation or test success.

On real Windows, verify first launch and restart on 1366 × 768 and 1080p at150%
scale, the complete composer, normal/maximize/minimize transitions, monitor
removal, mixed-DPI and negative-origin monitors, Quick Chat reopening and tray
overflow, and light/dark taskbars with both app modes. Confirm that changing
Windows appearance while the app is idle updates the tray icon. Record unavailable
display combinations explicitly; a hosted build is not this acceptance evidence.
