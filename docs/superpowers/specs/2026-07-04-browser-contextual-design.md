# Browser: Contextual-Only Surface

**Date:** 2026-07-04
**Status:** Approved

## Summary

Remove the in-app browser as a standalone navigation destination. It becomes contextual-only: a companion split pane on wide viewports, a bottom-sheet overlay on narrow/mobile. All existing URL-open entry points continue to work without changes; only the workspace's response to those events changes.

---

## Navigation Removal

The following items are deleted:

| Location | Change |
|---|---|
| `src/components/sidebar-minimal.tsx` `FOLDER_MODES` | Remove the `{ id: "browser", … }` entry entirely |
| `src/components/sidebar-minimal.tsx` addon gate | Remove the `if (fm.id === "browser") return addons?.browser === true` guard (no longer needed) |
| `src/components/workspace.tsx` `SURFACE_ORDER` | Remove `"browser"` — ⌘5 shortcut is freed |
| `src/components/command-palette.tsx` | Remove the "Go to Browser" surface row (currently gated by `addons?.browser`) |
| `src/components/settings-shell.tsx` | Remove the Browser entry from the Add-ons › Sidebar Surfaces settings section |
| `src/lib/cave-config.ts` `addons` default | Remove `browser: false` from the defaults object |

`"browser"` is **kept** in the `WorkspaceMode` union and in `WORKSPACE_MODE_TITLES`. The `<BrowserPane>` render site in workspace stays in place. The mode remains reachable via `?mode=browser` query param and `#browser` hash for external deep-link callers — those paths now invoke the same adaptive logic below instead of a bare `setMode`.

---

## Adaptive URL-Open Behaviour

All paths that currently call `setMode("browser") + browserPaneRef.current?.navigateTo(url)` are replaced with a new `openBrowserAdaptive(url: string)` function inside `workspace.tsx`.

### Wide viewport (≥ 768 px)

Opens as a **companion split pane** alongside the current surface.

1. Activate the existing companion split (the `SplitTarget` / split-pane mechanism already rendered at workspace line 1997 under `<BrowserPane label="companion" …/>`).
2. Call `browserPaneRef.current?.navigateTo(url)` to navigate the pane.
3. The current workspace mode (`chat`, `board`, etc.) does **not** change.
4. The split is resizable and closeable via the existing `drag-to-split` handle — closing it collapses back to the solo layout with no mode change.

### Narrow viewport (< 768 px)

Opens as a **bottom-sheet overlay** above the current surface.

1. New workspace state: `browserSheetOpen: boolean` (initially `false`) and `browserSheetUrl: string`.
2. `openBrowserAdaptive` sets `browserSheetOpen = true` then calls `browserPaneRef.current?.navigateTo(url)`.
3. Render: a full-width sheet positioned at the bottom of the viewport, approximately 85 % of screen height, rendered above the workspace surface (z-index overlay). Uses the existing `<Sheet>` / modal overlay pattern already present in the codebase.
4. Dismiss: close button in the sheet header, or swipe-down gesture — sets `browserSheetOpen = false`. Does not affect the active workspace mode.

---

## Event and Deep-Link Handling

The workspace already listens for `cave:open-url-in-browser` (via `OPEN_IN_APP_BROWSER_EVENT`) and reads `PENDING_IN_APP_BROWSER_URL_KEY` from sessionStorage on mount. Both of these handlers are updated to call `openBrowserAdaptive(url)` instead of `openUrlInAppBrowser(url)` (which did the old `setMode` path).

`?mode=browser` and `#browser` deep links are handled by the existing `readModeParam` and hash-check logic; those paths are updated to call `openBrowserAdaptive("")` (opening the split/sheet without a specific URL, landing on the pane's default/current tab).

---

## Reminder and Escalation Links

`openReminderLink` (workspace.tsx, currently calls `setMode("browser") + rAF navigateTo`) and the escalation source URL handler (workspace.tsx line 1892) both call `openBrowserAdaptive(url)` instead.

---

## Unchanged

- `src/components/browser-pane.tsx` — no changes
- `src/components/browser-quick-open.tsx` — no changes
- `src/lib/open-external.ts` (`openExternalUrl`, `openInAppBrowserUrl`) — no changes
- All `onOpenUrl` prop consumers (chat, board, group-chat, familiars, home, GitHub, Salem, dashboard, marketplace, settings, onboarding) — no changes
- All existing browser tests — should continue to pass; add regression tests for the split-open and sheet-open paths

---

## Testing

- `browser-pane-default-tabs.test.ts`, `browser-pane-hooks.test.ts`, `browser-pane-save.test.ts`, `browser-polish.test.ts`, `browser-quick-open.test.ts` — all pass without modification
- New pin: `openBrowserAdaptive` on wide viewport activates the companion split and does not change `mode`
- New pin: `openBrowserAdaptive` on narrow viewport sets `browserSheetOpen = true` and does not change `mode`
- New pin: closing the sheet sets `browserSheetOpen = false`
- Guard: `"browser"` no longer appears in `FOLDER_MODES`
- Guard: settings shell no longer contains the Browser addon toggle
