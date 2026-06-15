# Rich Color Picker for Appearance — Design

## Goal

Replace the native OS `<input type="color">` in the Appearance "Customise colors" editor with a full **in-app color picker** — saturation/value square + hue slider + hex field + a quick-pick **swatch strip** (10 theme accents + recent colors) — applied to all three editable slots (Background, Accent, Border). This is the "switcher with many more colors to select" the user wants. Bonus: an in-app picker avoids the flaky native color-dialog-in-Tauri-webview behavior that #529 worked around.

## Context (existing system)

- **Custom editor:** `src/components/theme-color-editor.tsx`.
  - `ColorSlot({ label, description, value, onChange })` (line 98) renders a colored swatch with a native `<input type="color">` overlay (line 138) + a hex text input. Native input only accepts `#rrggbb` (alpha stripped, line 107).
  - `applyColorsToDOM(colors: ThreeColors, mode)` (line 56) writes the chosen colors to `:root` CSS vars live (`--accent-presence`, `--accent-faint`, `--bg-base`, `--bg-raised`, `--bg-card`, `--bg-elevated`, `--border-hairline`, `--border-strong`). `ThreeColors = { bg, accent, border }`.
  - Persists to `localStorage` `coven-custom-theme`; border auto-derived from accent.
- **Editor host:** `src/components/settings-shell.tsx` (Appearance section ~776–831) — preset grid (10 cards) + the editor on preset click.
- **Palettes:** `src/lib/theme-palettes.ts` — `THEME_IDS` (10: coven, tide, grove, ember, bloom, dusk, mist, hex, bane, slate), `THEME_META[id]` with `accentDark`/`accentLight` hex per theme, `getSwatches(id, mode)`.
- **UI primitives:** `src/components/ui/popover.tsx` (anchored popover, focus-trap, Esc/outside-close), `ui/icon-button`, `ui/button`.
- **Tests:** source-text assertion style (`readFileSync` + `assert.match`), run with `node --experimental-strip-types`. `theme-color-editor.test.ts` (logic + getSwatches), `settings-appearance.test.ts`. Every `*.test.ts` must be wired into `package.json` `test:app` (`check:tests-wired` gate). `react-colorful` is **not** currently a dependency.

## Decisions (locked with user)

1. **Full in-app picker** = saturation/value square + hue slider + hex (universal layout, not a wheel).
2. **Implementation: `react-colorful`** (2.8 KB, zero-dep, themeable) — not hand-rolled HSV pointer math.
3. **Swatch strip: theme accents + recents** — a "Themes" row (10 `THEME_META` accents for the current mode) + a "Recent" row (last ~6 used).
4. **Scope: all 3 slots** (Background, Accent, Border) use the new picker.

## Architecture

### 1. New: `src/components/ui/color-picker.tsx`

`ColorPicker({ value, onChange, themeSwatches, recents, mode })`:
- Wraps `react-colorful`'s `HexColorPicker` (SV square + hue slider). Styled to tokens via a scoped CSS class (`.cave-color-picker`) overriding react-colorful's `.react-colorful__*` sizing/radius — match `--radius-control`, `--border-strong`, `--bg-elevated`.
- Hex field: `react-colorful` `HexColorInput` (prefixed `#`, validates) OR reuse the editor's existing hex input pattern — pick `HexColorInput` for consistency with the picker's state.
- **Swatch strip:**
  - "Themes" row: one `<button>` per `themeSwatches` entry (the 10 accents). Click → `onChange(hex)`. Each has `aria-label` (theme name + hex), a selected ring when `hex === value`.
  - "Recent" row: `<button>` per recent hex (omit if empty), same behavior.
- Pure presentational + controlled; no persistence inside (caller owns recents).

### 2. New: `src/lib/recent-colors.ts` (pure, no React)

- `getRecentColors(): string[]` — read `localStorage["coven:recent-colors"]`, parse, return up to 6 normalized `#rrggbb`.
- `addRecentColor(hex: string): string[]` — normalize (lowercase, ensure `#`, strip alpha), dedupe (move-to-front), cap 6, persist, return the new list.
- SSR/`localStorage`-absent safe (try/catch, return `[]`).

### 3. Wire into `theme-color-editor.tsx`

- `ColorSlot` swaps the native `<input type="color">` for: the existing colored swatch button → on click opens `<ColorPicker>` inside a `ui/popover.tsx` anchored to the swatch.
- `ColorPicker.onChange` calls the slot's existing `onChange` → live `applyColorsToDOM` (unchanged drag-to-preview behavior).
- On popover close, `addRecentColor(value)` so committed colors enter the Recent row.
- `themeSwatches` derived from `THEME_META` accents for the current `mode` (`accentDark`/`accentLight`); `recents` from `getRecentColors()` (held in editor state, refreshed on close).
- Keep the hex text path working (the picker's hex field replaces the old one).

### 4. A11y / states

- SV/hue areas are pointer-driven (react-colorful) — the **keyboard path is the hex field + the focusable swatch buttons** (Tab + Enter/Space; arrow-navigation across swatches via roving tabindex optional, not required).
- Popover provides focus-trap + Esc/outside-click close (existing).
- Light/dark: theme-accent swatch row uses `accentLight` vs `accentDark` per current mode.
- `prefers-reduced-motion` respected on any transitions.

### 5. Testing

- `src/lib/recent-colors.test.ts` — node test (`node --experimental-strip-types`): normalize, dedupe move-to-front, cap at 6, persist round-trip, empty/garbage-safe.
- `src/components/ui/color-picker.test.ts` — source-assertion: imports `react-colorful` (`HexColorPicker`/`HexColorInput`), renders the Themes + Recent swatch rows, swatch buttons have `aria-label`, hex field present. **Add to `package.json` `test:app`.**
- Update `theme-color-editor.test.ts`: `ColorSlot` uses `<ColorPicker>` in a popover, no longer `<input type="color">`; still calls `applyColorsToDOM` on change.
- Update `settings-appearance.test.ts` if it asserts the old native-input markup.
- `package.json`: add `react-colorful` to `dependencies` (Frontend build + CodeQL validate).

## Out of scope (YAGNI)

- Alpha/opacity channel; eyedropper; named-color search.
- Expanding beyond the existing 3 editable slots (bg/accent/border) to more tokens.
- Color-format toggles (RGB/HSL) — hex only, matching today.
- Changing the preset grid or palette set.

## Open items to confirm during implementation

- Exact react-colorful CSS override selectors to match token sizing (inspect `.react-colorful` defaults; scope under `.cave-color-picker`).
- Whether `ui/popover.tsx`'s anchor API fits the per-slot swatch trigger, or a lighter inline expansion reads better in the narrow editor column (default: popover; fall back to inline if cramped).
- Recent-colors key collision check (confirm `coven:recent-colors` is unused).
