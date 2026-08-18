# Settings vertical scroll ownership

## Scope

Repair the Settings shell so its existing Settings content pane scrolls vertically within the viewport. Apply the rule only to Settings; this is not an application-wide overflow normalization.

## Design

`SettingsShell` is a viewport-height, column-oriented shell. Its root must establish a flex formatting context, so the fixed header and the `min-h-0 flex-1` body are constrained to that viewport. The body then delegates vertical overflow only to `main.settings-shell__content`.

The header and Settings navigation rail remain fixed. Existing bounded scrolling inside Settings subcomponents is unchanged. No overlays, menus, dialogs, readers, or unrelated surface styles change.

The same DOM contract applies to standalone `/settings` and the embedded workspace Settings view: the root remains bounded, the intermediate body is shrinkable, and the content main owns vertical scrolling.

## Verification

Add a focused Settings shell contract test that verifies the three-part boundary: a viewport-locked flex root with hidden outer overflow, a `min-h-0 flex-1` body, and an `overflow-y-auto` Settings content main. Keep the assertion inside the existing Settings shell polish test suite so it runs in the application test manifest. Run the focused test, typecheck, and the design lint/checks that cover the touched TSX.

## Non-goals

- No global `overflow-y` rule.
- No changes to other app surfaces.
- No visual redesign or changed scroll affordances.
