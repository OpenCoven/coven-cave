# Canvas editor full screen — design

**Date:** 2026-07-21 · **Bead:** cave-i0qt · **Status:** approved

## Problem

In the Canvas sketch editor (`src/components/canvas-editor.tsx`), the sketch
preview is capped at `min(900px, 100%)` wide inside a padded stage, and the
320px inspector/design-chat aside is always visible. There is no way to view a
sketch at full size — neither filling the editor area nor taking over the
screen.

## Goals

- Let the sketch fill the whole editor body (in-app expand).
- Let the sketch take over the monitor (native fullscreen), where supported.
- Preserve the Select / Comment / Edit workflow and all editor state
  (selection, style drafts, comments, chat) across both.

## Non-goals

- No fullscreen for the gallery thumbnails or the inline chat artifact viewer.
- No layout redesign of the aside; it simply hides while expanded.
- No persistence of the expanded state across editor sessions.

## Approved approach (A)

Two icon buttons in the editor header, grouped immediately before the
Select/Comment/Edit mode group:

1. **Expand** (in-app toggle) — icon `ph:arrows-out-simple`, switching to
   `ph:arrows-in-simple` while active; `aria-pressed` reflects state with a
   steady accessible name ("Expand sketch"), per the ARIA toggle-button
   pattern.
2. **Full screen** (native) — icon `ph:frame-corners` (new `ICON_NAMES`
   entry + regenerated `ph-icons-subset.json`); rendered only when the
   Fullscreen API is available.

Rejected: floating overlay cluster on the sketch corner (overlaps sketch
content, weak on touch); single button with modifier for native
(undiscoverable).

## Behavior

### In-app expand

- `expanded` state on the editor root: class `canvas-editor--expanded`.
- CSS only: hide `.canvas-editor__aside`, drop stage padding, let
  `.canvas-editor__frame-shell` fill the stage (no 900px cap, no radius/border
  chrome). Header stays visible so modes, Done, and both toggles remain
  reachable.
- `Esc` exits. Precedence, encoded in a small exported pure helper
  (`resolveEscapeAction`) so it is testable: (1) if the sketch is in native
  fullscreen, the browser owns `Esc` (it exits fullscreen itself; one press
  peels exactly one layer); (2) if focus is in a non-empty input/textarea,
  `Esc` belongs to the field — do nothing (this now also covers expand, a
  deliberate extension of the existing selection-only guard); (3) else if a
  selection exists, clear it; (4) else if expanded, exit expand; (5) else
  nothing.
- Editor state (selection, drafts, annotations, chat) is untouched by
  toggling.

### Native fullscreen

- `requestFullscreen()` on `.canvas-editor__frame-shell` (the div wrapping the
  iframe and the runtime-error overlay), with `webkit`-prefixed fallbacks for
  WKWebView/Tauri.
- Button hidden unless `document.fullscreenEnabled` (or
  `webkitFullscreenEnabled`) is true.
- A `fullscreenchange` (+`webkitfullscreenchange`) listener syncs a
  `nativeFullscreen` state so the button label flips to "Exit full screen" and
  exit-by-`Esc` (handled natively by the browser) keeps the UI in sync.
- `:fullscreen` CSS on the frame shell removes the border/radius.

### Accessibility

- Both buttons use `focus-ring-inset`/`focus-ring` per the global convention,
  have `title` + `aria-label`s, and the expand toggle sets `aria-pressed`.
- State changes announce through the editor's existing `aria-live` region:
  "Sketch expanded." / "Sketch restored." / "Entered full screen." /
  "Exited full screen."

## Testing

Per repo convention (behavioral tests for pure logic, source-regex pins for
React wiring), in `src/components/canvas-editor.test.ts` (already wired in
`scripts/run-tests.mjs`):

- Behavioral: `resolveEscapeAction` — field-with-content guard, selection
  precedence, exit-expand, no-op when neither.
- Source pins: `canvas-editor--expanded` class toggle, fullscreen-availability
  gate, `aria-pressed` wiring, `fullscreenchange` listener, and the
  `:fullscreen` / `--expanded` CSS rules in `src/styles/canvas-editor.css`.

Validation: targeted test run + `pnpm typecheck`; PR through the protected
`main` path with the required checks.
