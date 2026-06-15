# Font Picker UI — Design

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation plan

## Goal

Let the user choose a UI (sans) font and a code/terminal (mono) font from the
bundled catalog, applied live and persisted across reloads. The runtime is
already wired (`src/app/fonts.ts` declares every catalog `cssVar` as a
`next/font/google` instance on `<html>`; `src/lib/font-catalog.ts` provides
`FONT_OPTIONS`, `fontStack`, `fontOptionById`, `DEFAULT_FONT_ID`). This adds the
selection UI and the application/persistence layer.

## Decisions

- **Location:** a "Typography" block inside the existing **Appearance** section
  of `settings-shell.tsx`, extracted into its own component to keep the shell
  file focused.
- **Persistence:** `localStorage` (consistent with theme/mode/scale prefs).
- **Application:** the clean refactor — the app reads canonical
  `--font-sans` / `--font-mono` vars; the picker overrides those on `<html>`.
- **UI:** two `<select>` dropdowns (sans, mono) each with a live preview line,
  plus a reset-to-default control.

## Architecture

### 1. `src/lib/font-storage.ts` (new)

Mirrors `src/lib/theme-storage.ts`.

- Keys: `cave:font:sans`, `cave:font:mono` — each stores a catalog `id`.
- `readFontPref(slot: FontSlot): string` — returns the stored id, or
  `DEFAULT_FONT_ID[slot]` if absent/unknown (validated against `fontOptionById`;
  garbage never throws).
- `writeFontPref(slot: FontSlot, id: string): void`.
- `applyFont(slot: FontSlot, id: string): void` — resolves the option and:
  - non-default → `documentElement.style.setProperty(varFor(slot), fontStack(option))`
  - default id → `documentElement.style.removeProperty(varFor(slot))` (falls back
    to the `:root` default; never leaves a stale inline style).
  - where `varFor("sans") === "--font-sans"`, `varFor("mono") === "--font-mono"`.
- All functions guard `typeof window`/`document` for SSR safety.

### 2. CSS refactor — canonical vars

`:root` already defines `--font-sans: var(--font-geist-sans)` and
`--font-mono: var(--font-geist-mono)` (defaults). Make the app consume them:

- Replace `var(--font-geist-sans)` → `var(--font-sans)` and
  `var(--font-geist-mono)` → `var(--font-mono)` across the 5 CSS files that read
  them directly: `globals.css` (2 sans, 8 mono), `styles/home-composer.css`,
  `styles/board.css`, `styles/cave-chat.css`, `styles/sidebar-minimal.css`.
- **Do not** touch the `:root` default definitions or `src/app/fonts.ts` (the
  raw `--font-geist-*` registrations stay — they remain the default's source).
- Each read keeps its existing literal fallback chain
  (`var(--font-sans), ui-sans-serif, …`), so an undefined var still degrades
  gracefully.

Behavior is identical to today until a non-default font is selected.

### 3. No-FOUC boot — `theme-script.tsx`

Extend the existing inline boot script (runs before first paint) to also read
`cave:font:sans` / `cave:font:mono` and `setProperty` the vars when non-default,
mirroring how it applies the persisted theme. Prevents a Geist flash on reload
for users with a non-default font.

### 4. `src/components/settings-fonts.tsx` (new) — `<FontSettings />`

Rendered inside `AppearanceSection`. Local state seeded from `readFontPref` on
mount. Two rows (sans, mono):

- A `<select>` populated from `FONT_OPTIONS.filter(o => o.slot === slot)`,
  value = current id.
- A preview line below it rendered with inline `fontFamily: fontStack(option)`
  — sans sample `The quick brown fox jumps over 0123`, mono sample
  `const x = 42; // 0123`. (Applying the stack triggers the lazy `preload:false`
  font load.)
- On change: `setState` → `writeFontPref(slot, id)` → `applyFont(slot, id)` —
  instant and live.

A "Reset to default" button restores both slots to `DEFAULT_FONT_ID`, writes,
and applies (removeProperty).

Styling follows the existing settings/`gh-select` idiom (compact native select
with a custom chevron).

## Data flow

```
mount        : readFontPref(slot) → select value
user picks   : onChange → writeFontPref → applyFont → setProperty(--font-sans|mono)
                 → all CSS reading var(--font-sans|mono) re-renders instantly
reload       : theme-script boot reads keys → setProperty before paint (no FOUC)
reset        : DEFAULT_FONT_ID → write + applyFont(removeProperty) → :root default
```

## Error handling

- Unknown/garbage stored id → `DEFAULT_FONT_ID[slot]`; never throws.
- SSR / missing `window` → storage + apply functions no-op.
- A catalog `cssVar` that lacks a runtime declaration is already guarded by the
  existing `font-wiring.test.ts`; the picker only offers `FONT_OPTIONS`, all of
  which are declared.

## Testing

1. **Refactor completeness** (extends the `font-wiring` test family): grep the 5
   CSS files, assert **zero** `var(--font-geist-sans|mono)` reads remain outside
   the `:root` default definitions.
2. **`font-storage` unit test:** stubbed `localStorage` + `documentElement`;
   write→read round-trip; `applyFont` non-default → `setProperty(fontStack)`;
   default → `removeProperty`; garbage id → default, no throw.
3. **`<FontSettings />` source test** (mirrors `settings-appearance.test.ts`):
   a select per slot sourced from `FONT_OPTIONS`, a reset control, onChange wired
   to `writeFontPref`/`applyFont`.
4. **Boot-script test:** `theme-script.tsx` reads the two font keys and sets the
   vars.
5. **Live verification (Playwright, manual pre-PR):** pick non-default sans+mono
   → `getComputedStyle(body).fontFamily` changes app-wide; reload → persists, no
   Geist flash; reset → default + override cleared. Screenshot.

CI (`test:app`) covers 1–4; e2e (5) is run manually before the PR per repo
convention.

## Out of scope

- Per-surface font overrides (one global sans + one global mono only).
- Font size / weight / line-height controls.
- Custom/uploaded fonts beyond the bundled catalog.
- A font-picker entry point outside Settings → Appearance.
