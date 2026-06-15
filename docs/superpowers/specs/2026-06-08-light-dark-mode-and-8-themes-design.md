# Light/Dark mode + 8 curated default themes

**Date:** 2026-06-08
**Status:** Approved (design); plan pending
**Scope:** Add a Light/Dark mode toggle to Coven Cave and replace the existing 4 dark-only presets (Mood C, Midnight, Orchid, Sky) with 8 curated themes that each ship both a light and a dark palette. Settings-only UI; no chrome controls, no system-preference tracking.

## Why

Coven Cave runs dark-only today. The default palette ("Mood C") lives directly in `:root` of `src/app/globals.css`, and three sibling presets (`midnight`, `orchid`, `sky`) override that palette via `[data-theme="…"]` attribute selectors (`globals.css:2148-2223`). Theme selection persists to `localStorage["coven-theme"]` and is restored before first paint by `src/components/theme-script.tsx`. There is no concept of mode — every preset is dark, and the comment block in `globals.css` explicitly notes "the app runs dark-only" (`settings-shell.tsx:425`, "the app runs dark-only" in the custom-theme apply path).

The user wants a real mode toggle (Light vs Dark) and a wider, more deliberate roster of 8 themes that span the hue wheel. The two changes are tightly coupled: once mode is decoupled from theme, every theme needs both a light and a dark palette.

## Goals

- A user-controlled Light/Dark mode toggle, independent of theme selection.
- Eight curated themes; each ships a light *and* a dark palette tuned for editor-app density.
- Default first-run experience matches today: Coven (the violet replacement for Mood C), Dark mode.
- Existing tweakcn custom-theme import continues to work, and now honors mode (applies `cssVars.light` in light mode, `cssVars.dark` in dark mode).
- Flash-free restoration is preserved: both attributes set before first paint.
- Component CSS that's visible on every screen flips cleanly between modes without visual regressions.

## Non-goals

- **No system-preference tracking.** `prefers-color-scheme` is not read. Mode is explicit and defaults to Dark.
- **No quick toggle in chrome.** No sun/moon icon in the rail, no keyboard shortcut, no command-palette entry. Mode lives only in Settings → Appearance.
- **No per-theme contrast modes** (no high-contrast variant, no theme that ignores mode).
- **No exhaustive light-mode audit of every screen.** Pass 1 covers the always-visible surfaces. The long-tail screens (settings detail, mockup, Library/Board specific styles) get marked with `TODO` comments and tracked as a follow-up issue; they ship working but may have minor light-mode rough edges.
- **No daemon protocol changes.** Theme + mode are purely client state.
- **No migration of existing users' theme selection** beyond rename. If localStorage holds an old preset id (`mood-c`, `midnight`, `orchid`, `sky`), the theme script maps it to the closest new theme id once on load (see Migration section). No data is destroyed.

## Design decisions (locked)

| Decision | Choice | Alternatives considered |
|---|---|---|
| Mode model | **Mode × theme matrix** — mode is a separate toggle; each theme has both palettes | 16 separate presets in one list; theme IS the mode |
| Mode options | **Light / Dark only**, default Dark | Light / Dark / System (with media-query listener); per-theme override |
| Theme roster | **Curated 8 from scratch** — rename and rebuild | Keep 4, add 4; keep 4, propose 4 |
| Aesthetic axis | **Span the hue wheel** — 8 distinct hue families | Match shadcn presets (Zinc/Slate/etc.); match editor schemes (Nord/Dracula/etc.) |
| Toggle location | **Settings → Appearance only** | + global keybinding + cmd palette; + always-visible chrome icon |
| Default state | **Theme: Coven, Mode: Dark** — matches current behavior | Theme: Slate (neutral default); Mode: System |
| Border var strategy | **Derive from `--foreground` via `color-mix`** | Define separate light/dark border tokens per theme |
| Custom theme + mode | **Apply `cssVars.light` in light mode, `cssVars.dark` in dark mode; live re-apply on mode change** | Lock custom themes to a single mode at import time |

## Detailed design

### A. Storage & DOM attributes

**Storage:**

- `localStorage["coven-mode"]` — new. Values: `"light"` or `"dark"`. Absent ⇒ dark (default).
- `localStorage["coven-theme"]` — repurposed. Values: one of the 8 theme ids below, or `"custom"`. Absent ⇒ `"coven"` (default).
- `localStorage["coven-custom-theme"]` — unchanged. JSON of the tweakcn import.

**DOM, on `<html>`:**

- `data-theme="<id>"` — always set after first paint, even for the default theme. (Today the default theme uses *absence* of the attribute; the new scheme always sets it so CSS selectors are uniform and the active state in settings is unambiguous.)
- `data-mode="light" | "dark"` — always set.

### B. Theme ids

```ts
type ThemeId =
  | "coven"   // violet (was "mood-c")
  | "tide"    // blue   (was "sky")
  | "grove"   // green
  | "ember"   // amber
  | "bloom"   // rose
  | "dusk"    // magenta (was "orchid")
  | "mist"    // teal
  | "slate";  // neutral (was "midnight")
type Mode = "light" | "dark";
type ActiveTheme = ThemeId | "custom";
```

### C. CSS structure (`src/app/globals.css`)

Three layers, in order:

```css
/* 1. Agnostic tokens — radii, spacing, motion, type scale, icon sizes, focus ring widths.
      Unchanged from today. */
:root {
  --radius: 0.625rem;
  --space-1: 4px;
  /* … all the agnostic tokens that already exist … */
}

/* 2. Default theme (Coven) — DARK palette in :root, LIGHT palette in :root[data-mode="light"].
      Coven is the default so we keep its palette in :root for cheap selectors and
      cleaner specificity. */
:root {
  --background: oklch(0.07 0.004 293);
  --foreground: oklch(0.985 0 0);
  /* … rest of the current dark Mood C palette, renamed in comments to "Coven dark" … */
}
:root[data-mode="light"] {
  --background: oklch(0.99 0.003 293);
  --foreground: oklch(0.18 0.006 293);
  /* … full Coven light palette … */
}

/* 3. Other themes — DARK palette in [data-theme="X"], LIGHT palette in [data-theme="X"][data-mode="light"]. */
[data-theme="tide"] { /* dark tide vars */ }
[data-theme="tide"][data-mode="light"] { /* light tide vars */ }
/* …repeat for grove, ember, bloom, dusk, mist, slate */
```

**Border-var derivation.** Today `--border`, `--border-strong`, and `--input` are defined as `oklch(1 0 0 / N%)` (literal white at alpha). That breaks in light mode. Change them once in `:root`:

```css
:root {
  --border: color-mix(in oklch, var(--foreground) 12%, transparent);
  --border-strong: color-mix(in oklch, var(--foreground) 22%, transparent);
  --input: color-mix(in oklch, var(--foreground) 18%, transparent);
}
```

These now auto-invert when `--foreground` flips between dark text (light mode) and light text (dark mode). Per-theme overrides of `--border` etc. stay possible but become rare.

**Selector specificity sanity check.** `:root[data-mode="light"]` is `(0,1,1)` — beats `:root` `(0,0,1)` but loses to `[data-theme="X"][data-mode="light"]` `(0,2,0)`. Order in the file: agnostic → default dark → default light → per-theme dark → per-theme light. Cascade resolves correctly because each layer's specificity strictly increases (or for same-specificity selectors, source order wins).

### D. The 8 themes — palette spec

All palettes use `oklch` so lightness/chroma changes between modes are perceptually uniform. Hue is anchored per theme. Chroma is *low on surfaces* (≤ 0.012 on backgrounds, ≤ 0.020 on raised surfaces) so the editor stays neutral; chroma is *high on the accent* (`--accent-presence` and `--ring`) so the theme reads clearly without staining the chrome.

Lightness ladder (dark mode): panel 0.055 → base 0.07 → card 0.115 → muted 0.17 → hover 0.21 → text-muted 0.66 → text-secondary 0.78 → foreground 0.985.

Lightness ladder (light mode): panel 1.0 → base 0.99 → card 0.97 → muted 0.93 → hover 0.89 → text-muted 0.55 → text-secondary 0.38 → foreground 0.18.

Per-theme hue + accent table:

| Id | Name | Hue | Accent (dark) | Accent (light) | Notes |
|----|------|-----|---------------|----------------|-------|
| `coven` | Coven | 293 | `#9A8ECD` | `#6F62A8` | Default. Lavender — matches existing OpenCoven brand. Replaces Mood C. |
| `tide` | Tide | 245 | `#6DA9FF` | `#3D7DD8` | Cool slate-blue, daybreak accent. Replaces Sky. |
| `grove` | Grove | 145 | `#6DCB8E` | `#2F8C58` | Forest green. New. |
| `ember` | Ember | 60 | `#E8A85C` | `#B5752A` | Warm amber. New. Focused-work feel. |
| `bloom` | Bloom | 15 | `#E88FA5` | `#C25A78` | Soft rose. New. Friendly. |
| `dusk` | Dusk | 330 | `#D26BFF` | `#9F3FCE` | Magenta. Replaces Orchid. |
| `mist` | Mist | 195 | `#5DD0CB` | `#1E938E` | Teal/cyan. New. Clinical. |
| `slate` | Slate | 270 | `#A0A0AB` | `#5C5C66` | Zero-chroma neutral. Replaces Midnight (which was already near-zero chroma). |

For each theme the dark palette is built as: surfaces inherit hue at chroma ~0.005–0.012, accent uses the table value, and `--ring-focus` is `color-mix(in oklch, <accent> 55%, transparent)`. The light palette mirrors the structure: surfaces hold the same hue with chroma ~0.003–0.008, foreground is dark text, accent is the slightly-darker "light accent" column for AA contrast against light surfaces.

A reference palette generator (a 30-line TypeScript function) lives in `src/lib/theme-palettes.ts` and is used by the spec script and the settings preview swatches; the actual CSS lives in `globals.css` (handwritten, not generated at build time, so it's diffable and reviewable).

### E. Theme script (`src/components/theme-script.tsx`)

Rewrite the inline script body. Pseudocode of the new logic:

```js
(function () {
  try {
    var theme = localStorage.getItem("coven-theme") || "coven";
    var mode  = localStorage.getItem("coven-mode")  || "dark";

    // Migration: old preset ids map to new ones.
    var rename = { "mood-c": "coven", "sky": "tide", "orchid": "dusk", "midnight": "slate" };
    if (rename[theme]) {
      theme = rename[theme];
      localStorage.setItem("coven-theme", theme);
    }

    var html = document.documentElement;
    html.setAttribute("data-theme", theme);
    html.setAttribute("data-mode", mode);

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var cssVars = data && data.cssVars;
      if (!cssVars) return;
      // Apply mode-agnostic group + the group matching the current mode.
      applyGroup(html, cssVars.theme);
      applyGroup(html, mode === "light" ? cssVars.light : cssVars.dark);
    }
  } catch (e) {}
})();
```

Key changes from today:

- Always sets both `data-theme` and `data-mode`, including for the default.
- Reads `coven-mode` and respects it for custom themes.
- Runs the one-shot id-rename migration so existing users don't lose their preference.

### F. Settings UI (`src/components/settings-shell.tsx`)

Three changes inside the existing `AppearanceSection`:

**1. Mode toggle (new), above the theme grid:**

```tsx
<SettingsGroup label="Mode">
  <ModeToggle value={mode} onChange={handleSetMode} />
</SettingsGroup>
```

`ModeToggle` is a small segmented control (Light | Dark) styled with existing tokens. `handleSetMode` writes localStorage, sets `data-mode` on `<html>`, and if `activeTheme === "custom"` re-applies the custom theme's mode-specific cssVars group live.

**2. Theme grid (replace, not extend):**

Replace the existing `PRESETS` array with the 8 new entries. Render as a CSS grid: 2 rows × 4 columns on wide settings panes, 1 column on narrow. Each `ThemePresetCard` shows three swatches (background, accent, border) read from the *active* mode — so when you flip the mode toggle, all 8 preview cards re-swatch live. Implementation: a `getSwatches(themeId, mode)` helper that returns the right tuple from a static table; the table lives next to the `PRESETS` array.

**3. Custom theme reapply on mode change:**

If `activeTheme === "custom"` when the user flips mode, immediately call `applyCustomVars(customData.cssVars, newMode)` with the new mode so the live preview matches. `applyCustomVars` gains a second arg and picks `cssVars.light` or `cssVars.dark` accordingly.

### G. Component CSS audit — two passes

Sizing pass run during brainstorming: `src/` contains roughly 200 hardcoded color refs that assume dark mode (white-alpha borders, rgba-white text, rgba-black scrims, hex whites). Most are in `globals.css` itself (24 of the `oklch(1 0 0 …)` refs); the rest are spread across `src/styles/*.css` and a smaller number of inline JSX `style=` props.

**Pass 1 — in this spec.** Audit only the surfaces visible on every screen so the default light-mode experience is correct:

- `src/styles/sidebar-minimal.css`
- `src/styles/cave-chat.css`
- `src/styles/home-composer.css`
- `src/styles/sessions-view.css`
- Familiar avatar rail block in `globals.css` (~`globals.css:2225-` onward)
- Status bar / footer indicator block
- Any inline JSX `style=` in `src/components/{chat-view,home-composer,sidebar-*,familiar-avatar-rail,onboarding-overlay}.tsx`

For each: replace hardcoded `oklch(1 0 0 / N%)` and `rgba(255,255,255,…)` with `color-mix(in oklch, var(--foreground) N%, transparent)`; replace hardcoded `rgba(0,0,0,…)` scrims with `var(--backdrop-scrim)` (which we'll redefine to derive from `--background` similarly). Expected: ~60–80 of the ~200 refs migrated. Verify in browser by flipping mode on every visible-on-startup screen.

**Pass 2 — follow-up issue, not in this spec.** Long-tail screens:

- `src/styles/library.css`
- `src/styles/board.css`
- `src/app/mockup/mockup.css` (the mockup page; intentionally frozen)
- Settings detail screens beyond the main panel
- Plugin/Familiar Studio drawer internals

Each remaining hardcoded ref gets a `/* TODO: light-mode-audit */` comment so the follow-up issue can grep them. Light mode ships looking ~95% right on these surfaces; visible regressions tracked in the follow-up.

### H. Default-state and migration

**Fresh install:** no `coven-mode` or `coven-theme` in localStorage. Theme script defaults to `theme="coven"`, `mode="dark"`. Visual result is identical to today's first-paint Mood C (palette is the same, just renamed).

**Existing user with `coven-theme === "mood-c" | "sky" | "orchid" | "midnight"`:** theme script's one-shot rename map (`mood-c → coven`, `sky → tide`, `orchid → dusk`, `midnight → slate`) writes the new id back to localStorage on first run. Mode defaults to `dark`. Visual result is the new theme's dark palette, which is a tuned-up version of the old palette — minor color drift expected and documented in the PR description.

**Existing user with `coven-theme === "custom"`:** unchanged. Custom data still loads; mode defaults to dark; on first mode flip the custom theme's `cssVars.light` group activates.

### I. Files touched

**Modified:**

- `src/app/globals.css` — restructure into agnostic → default-theme-dark → default-theme-light → 7× (per-theme dark + per-theme light) blocks; rewrite `--border*` and `--input` to derive from `--foreground`.
- `src/components/theme-script.tsx` — new logic per §E.
- `src/components/settings-shell.tsx` — `PRESETS`, swatch helper, `ModeToggle` component, custom-theme reapply path.
- Pass-1 component CSS files listed in §G.

**New:**

- `src/lib/theme-palettes.ts` — type definitions, theme metadata, and the swatch tuple table consumed by settings.

**Removed:** none. No file deletions; just rewrites.

## Testing strategy

Manual:

1. Fresh install → confirm `data-theme="coven"`, `data-mode="dark"`, visually identical to today's startup.
2. Pick each of the 8 themes in dark mode → confirm palette change, no flash on refresh.
3. Flip to Light mode → confirm palette flips, all 8 swatches in the grid re-render to light-mode previews, no console errors.
4. Pick each of the 8 themes in light mode → confirm distinct palettes, AA-readable text on every visible-on-startup screen.
5. Import a tweakcn theme with both `light` and `dark` groups → flip mode → confirm live re-apply.
6. Hard refresh in light mode → confirm flash-free restoration (both `data-*` attrs set before first paint).
7. Manually set `localStorage["coven-theme"] = "mood-c"`, reload → confirm one-shot rename to `coven`.

Automated:

- Unit test for the id-rename map in a small extracted module (refactor the rename map out of the inline script for testability).
- Unit test for `getSwatches(themeId, mode)` returning the expected tuple for each of the 16 combinations.
- Existing snapshot tests for components touched in Pass 1 — re-record under both modes if the snapshots include color values.

## Open risks

- **Pass-2 surfaces look worse in light mode until the follow-up lands.** Mitigation: ship the follow-up issue with the spec so it can't be silently dropped.
- **OkLCH browser support edge cases.** Chrome/Safari/Firefox all support it as of 2025, but `color-mix(in oklch, …)` is newer. Existing code already uses both freely; no new risk.
- **Tweakcn themes that ship only one mode group.** Today's import requires either `theme`, `light`, or `dark`. New behavior: if user is in light mode and the import only has `dark`, fall back to applying `dark` (with a non-blocking notice in the import UI). Symmetric for the reverse case.
- **Localstorage migration is one-shot.** If a user has the app open in two tabs (Tauri shouldn't, but the web `next dev` build can), the rename runs in both. Idempotent — second tab finds the already-renamed id and no-ops.
