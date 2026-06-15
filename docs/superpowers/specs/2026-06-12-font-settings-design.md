# Typography settings — design

**Date:** 2026-06-12
**Status:** Approved (Val, 2026-06-12)

## Goal

Consistent, professional typography across Coven Cave, plus user control: selectable UI (sans) font, selectable mono font, adjustable base font size, 21 bundled font options, and the ability to add custom fonts.

## Decisions (confirmed with Val)

1. **Two font slots**: UI/sans (whole app + chat) and mono (code, terminal). Fredoka stays as the fixed brand/decorative font.
2. **Bundled via `next/font/google`**, compiled at build (self-hosted, offline-safe). **Custom fonts** = any font family installed on the user's machine, typed by name.
3. **Font size**: stepper 12–20px on the body baseline (default 14), independent of screen-magnification zoom.

## Architecture

Follows the established appearance-settings pattern (screen magnification: `src/lib/screen-magnification.ts` + controller + localStorage + CSS var + pin tests).

### 1. Font catalog — `src/app/fonts.ts` + `src/lib/font-catalog.ts`

- `fonts.ts`: declares all `next/font/google` instances with `variable:` CSS vars. Defaults (Geist, Geist Mono) keep `preload: true`; the other 19 use `preload: false` — `@font-face` is lazy, so unselected fonts' files are never downloaded.
- All `.variable` classes added to `<body>` in `layout.tsx` so every font var is addressable.
- `font-catalog.ts`: registry `{ id, label, slot: "sans" | "mono", cssVar, fallback }`.

**Bundled sans (13):** Geist (default), Inter, Roboto, Open Sans, Lato, Source Sans 3, Noto Sans, IBM Plex Sans, Work Sans, DM Sans, Manrope, Figtree, Public Sans.
**Bundled mono (8):** Geist Mono (default), JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono, Roboto Mono, Space Mono, Inconsolata.

### 2. Persistence + application — `src/lib/font-settings.ts` + `src/components/font-settings-controller.tsx`

- localStorage keys: `cave:font-sans` (font id or `custom:<family>`), `cave:font-mono` (same), `cave:font-size` (12–20 int), `cave:custom-fonts` (JSON array of `{ family, slot }`).
- `applyFontSettings()` sets on `<html>`:
  - `--app-font-sans: var(--font-<id>), <fallback stack>` (or `"<family>", <default stack>` for custom)
  - `--app-font-mono: …` (same shape)
  - `--cave-font-size: <N>px`
- Controller mounted in `layout.tsx` next to `screen-magnification-controller`: applies on mount, re-applies on a custom event + storage events (cross-tab).

### 3. CSS — `src/app/globals.css`

- `body { font-size: var(--cave-font-size, 14px); font-family: var(--app-font-sans, var(--font-geist-sans)), … }`
- `:root { --cave-font-scale: 1 }` (unitless). The controller sets **both** `--cave-font-size: <N>px` and `--cave-font-scale: <N/14>` (computed in JS — CSS `calc()` cannot derive a unitless ratio from two lengths). Type-scale tokens become `--text-sm: calc(12px * var(--cave-font-scale))` etc. (all tokens `--text-2xs`…`--text-display`), so the hierarchy scales proportionally with the baseline.
- `@theme inline` `--font-sans`/`--font-mono` route through the new app vars so Tailwind utilities follow the selection.

### 4. Settings UI — Typography block in Settings → Appearance (`settings-shell.tsx`)

Placed above theme presets:
- **UI font** dropdown + **Mono font** dropdown — each option label renders in its own font family for preview.
- **Font size** stepper (12–20, default 14) with a live preview line.
- **Add custom font…** per slot: text input for an installed family name; validated best-effort with `document.fonts.check("16px <family>")` — warn when not found but allow saving (fallback stack covers it). Saved entries appear in the picker with a remove affordance.
- **Reset typography** button → defaults (Geist / Geist Mono / 14).

### 5. Consistency sweep

- `bottom-terminal.tsx` (2 sites): hardcoded `ui-monospace, "SF Mono", …` → `var(--app-font-mono, ui-monospace, …)` chain.
- `library-graph-3d.tsx` / `trace-graph-3d.tsx` canvas label fonts: read the computed body font-family instead of hardcoded `system-ui` stacks.

## Error handling

- Unknown stored font id → silently fall back to default (apply nothing for that slot).
- Custom family not installed → browser falls through to the fallback stack natively.
- Corrupted `cave:custom-fonts` JSON → treated as empty; corrupted size → clamp to 12–20 or default.

## Testing

Pin tests in the style of `settings-appearance.test.ts`:
- Catalog has 15–25 entries spanning both slots; defaults are Geist/Geist Mono.
- `globals.css` consumes `--app-font-sans`/`--app-font-mono`/`--cave-font-size` with Geist fallbacks; type-scale tokens multiply by `--cave-font-scale`.
- `layout.tsx` mounts the controller and spreads all font variable classes.
- `bottom-terminal.tsx` no longer hardcodes a mono stack.
- Settings shell renders the Typography block (dropdowns, stepper, custom input, reset).

Live verify: worktree dev server + Playwright — select a font + size, assert `getComputedStyle(document.body).fontFamily/fontSize`, screenshot.

## Out of scope

- Per-surface fonts (separate chat reading font) — single UI font covers chat.
- Runtime Google Fonts fetching.
- Font weight/line-height controls.
