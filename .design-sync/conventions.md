# Building with Coven Cave (OpenCoven)

Coven Cave is a dark, dense, lavender-inked desktop app ("grimoire" aesthetic). Read `guidelines/docs/coven-design-language.md` before composing larger layouts — it defines the density scale, elevation rules, and voice.

## Setup

- **No provider is required** for most components — tokens are global CSS custom properties from `styles.css`. The default theme is **coven dark**: page background is `var(--background)` (near-black lavender). Always place compositions on `var(--background)` — components on a white page look broken.
- Theme switching: set `data-theme` (21 palettes, default `coven`) and `data-mode` (`dark` | `light`) on `<html>`.
- `ConfirmProvider` (+ its `useConfirm` hook) wraps the app when you need confirm dialogs; `LiveRegionProvider` (+ `useAnnouncer`) wraps the app for screen-reader announcements. Both render children unchanged.

## Styling idiom — tokens first, never hardcoded colors

Every color must come from a token (the app ships 21 themes × 2 modes; literals break them):

- Surfaces: `--background`, `--card`, `--popover`; semantic aliases `--bg-base`, `--bg-raised`, `--bg-elevated`, `--bg-hover`, `--bg-panel`, `--bg-sunken` (recessed wells — sticky strips, confirm inputs)
- Text: `--text-primary`, `--text-secondary`, `--text-muted`; `--foreground`
- Borders: `--border-hairline` (decorative), `--border-strong` (interactive, ≥3:1), `--border`
- Accent: `--accent-presence` (lavender presence — status dots, familiar marks; NOT a CTA color); `--primary` for primary actions
- State: `--color-success` / `--color-warning` / `--color-danger` / `--color-info` (+ `-soft` fills). For inline danger alerts, use the pre-mixed trio `--danger-bg` (fill), `--danger-border`, `--danger-text` — the tint recipe already applied, mode-aware: `border: 1px solid var(--danger-border); background: var(--danger-bg); color: var(--danger-text)`
- Radii: `--radius-control` (8px), `--radius-card` (12px), `--radius-panel` (16px), `--radius-pill` (999px — the signature shape for chips, avatars, badges)
- Spacing `--space-1`…`--space-10` (4px grid); type scale `--text-2xs`…`--text-display` (13px body baseline — density is a feature); motion `--duration-fast/base/slow` + `--ease-standard/emphasized/decelerate`; focus `--ring-focus`
- Tint recipe for state fills: `color-mix(in oklch, var(--color-danger) 14%, transparent)` fill with a 30–45% border of the same token — never a second hue.

Tailwind v4 utilities are compiled into the stylesheet — the app's idiom is arbitrary-value classes over tokens, e.g. `className="flex gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[var(--text-primary)]"`.

Fonts: `var(--font-eb-garamond)` display serif (heroes), `var(--font-inter)` body/UI, `var(--font-jetbrains-mono)` code/labels.

## Where the truth lives

- `styles.css` → imports `_ds_bundle.css`: all token definitions, the `.ui-*` component styles, and compiled utilities. Grep it before inventing a class.
- `guidelines/docs/coven-design-language.md`: density, elevation-via-lightness, the pill, disclosure ladder, chrome budget (≤3 visible actions + overflow), voice.
- Per component: `components/<group>/<Name>/<Name>.prompt.md` (usage + examples) and `<Name>.d.ts` (props).

## Icons

Use the `Icon` component with bare Phosphor names from the curated union (~290 names): `<Icon name="sparkle" width={14} />`. Common: `sparkle`, `plus`, `magnifying-glass`, `caret-down`, `gear-six`, `dots-three`, `trash`, `warning`, `check`, `x`, `cat`, `folder-open`. Buttons take `leadingIcon`/`trailingIcon` name props directly.

## Idiomatic example

```tsx
import { Button, EmptyState } from "coven-cave";

<div style={{ background: "var(--background)", padding: 24, borderRadius: "var(--radius-card)" }}>
  <EmptyState
    icon="cat"
    headline="No familiars yet"
    subtitle="Summon your first familiar to start delegating work."
    actions={<Button variant="primary" leadingIcon="sparkle">Summon familiar</Button>}
  />
</div>
```

Voice: terse, sentence case, contractions; domain nouns everywhere (familiar, coven, summon, grimoire, ward) — one flourish per surface, then back to utility.
