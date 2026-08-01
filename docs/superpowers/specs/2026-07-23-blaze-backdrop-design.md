# Blaze animated backdrop style — design

- **Date:** 2026-07-23
- **Bead:** cave-99s9
- **Branch:** `blaze-backdrop` (worktree `.worktrees/blaze-backdrop`)

## Summary

Add an animated backdrop option to Settings → Appearance → Backdrop: the
Canvas UI **Blaze** effect (fire sparks, smoke, and glow rising from the
bottom of the page), rendered behind Home and Chat in the same fixed layer
the image backdrop uses today. `style` becomes a small extensible option set
(`"image" | "blaze"`) so future animated effects slot in without another
schema shape change.

Source component: <https://canvasui.dev/docs/components/blaze>, shadcn
registry item `https://canvasui.dev/r/blaze-react.json` (`blaze-react`).
It is a single self-contained React + WebGL2 file with **zero dependencies**.
The repo does not adopt shadcn scaffolding (no `components.json`, no base
theme, no new packages) — only the one component file is vendored.

## Decisions (user-confirmed)

1. **Placement:** extend the existing Backdrop system as a *style picker*
   (Image | Blaze) sharing enablement, intensity, and surfaces — not a
   separate setting, not tied to specific themes.
2. **Colors:** derive `smokeColor`/`sparkColor` from the active theme accent
   so the effect stays coherent across all 21 palettes × 2 modes; the
   user's playground values are the fallback when the accent cannot be
   parsed.
3. **Layering:** under content — same fixed `z-0` layer as the image
   backdrop; the existing scrim and glass readability floors stay in force.
4. **Scaffolding:** vendor `Blaze.tsx` only. The shadcn init experiment
   staged in the primary checkout is discarded after this PR lands.

## Components

### 1. Vendored component — `src/components/canvasui/Blaze.tsx`

- Exact registry payload, then the repo's own design auto-fixer
  (`pnpm codemod:design`) applied so the design gates pass (verified: it
  rewrites three static inline style objects to arbitrary-property utility
  classes; ESLint `coven-design/*` and `codemod:design:check` both green).
- A short provenance header comment records the source URL and fetch date
  so future updates can re-diff against upstream.
- No other edits; the component keeps its own reduced-motion handling,
  `IntersectionObserver` pause, `ResizeObserver`, and DPR cap (2).

### 2. Preferences — `src/lib/preferences-schema.ts`

- `BACKDROP_STYLES = ["image", "blaze"] as const`;
  `CaveBackdropPreferences.style: BackdropStyle`, default `"image"`.
- `normalizeCavePreferences`: `oneOf(backdrop.style, BACKDROP_STYLES, "image")`.
- Strict patch path: `"style"` added to the backdrop `assertAllowedKeys`
  list; value validated via the strict-choice helper (unknown values 400).
- Legacy mirror: `cave:backdrop:v1` JSON gains `style`; the legacy import
  path reads it back when valid.

### 3. Client store — `src/lib/cave-backdrop.ts`

- `BackdropPrefs.style: BackdropStyle`, `DEFAULT_PREFS.style = "image"`,
  read/write plumbed through `readAppPreferences`/`updateAppPreferences`
  like the existing fields.

### 4. Layer — `src/components/cave-backdrop-layer.tsx` + new `src/components/cave-backdrop-blaze.tsx`

- When the effective visual is Blaze (`style === "blaze"`, enabled, and no
  familiar image override showing), the layer div renders
  `<CaveBackdropBlaze />` instead of the CSS `background-image`, and the
  app-image byte fetch is skipped.
- A familiar's own backdrop image (explicit per-familiar opt-in) still
  takes over the layer while that familiar is active; per-familiar
  backdrops remain image-only.
- While Blaze is the effective visual, the image `accentSeed` is
  suppressed (`matchAccent: false, accentSeed: null` passed to
  `applyBackdropToDocument`) — the theme accent *drives* Blaze rather than
  the backdrop driving the accent.
- `CaveBackdropBlaze` (client component, loaded via `next/dynamic` with
  `ssr: false` so the ~22 KB WebGL file stays out of the main bundle):
  - Skips mounting under `usePrefersReducedMotion()`.
  - Reads computed `--accent-presence` from `document.documentElement`,
    parses it with the existing `parseThemeColor` (`theme-contrast.ts`),
    converts to `[r, g, b]` in 0–1.
  - **Color recipe (single-token derivation, per the design language):**
    `smokeColor = accent`;
    `sparkColor = accent × 0.3 + [0.66, 0.66, 0.66] × 0.7` (per channel,
    i.e. 70% toward neutral grey) — reproducing the playground's
    smoke↔spark relationship (vivid smoke, desaturated pale sparks).
  - **Fallback:** parse failure → the exact playground colors
    `sparkColor [0.6314, 0.6314, 0.6902]`, `smokeColor [0.5451, 0.3608, 0.9647]`.
  - All other options exactly as configured in the playground:
    `height 0.75, distortion 0.5, distortionScale 1, speed 0.5, sparks 0.75,
    sparkDensity 0.75, sparkSize 0.75, layers 5, smoke 1, glow 0.5`.
  - Owns a `MutationObserver` on `data-theme`/`data-mode` and re-derives
    colors live via the instance's `setOptions` (no re-mount) — the effect
    must look intentional in all 42 theme × mode combinations.
  - Renders `<Blaze>` with no children: in normal browsers the
    experimental HTML-in-canvas capture is unsupported, the source canvas
    stays empty, and the output canvas shows pure fire/smoke/glow — which
    is exactly the backdrop visual. No content is ever routed through the
    component.

### 5. CSS — `src/styles/backdrop.css`

- The layer div gains `data-backdrop-style` so CSS can target styles.
- `.cave-backdrop-blaze` fills the layer (absolute inset 0); the canvas is
  `aria-hidden` and `pointer-events: none` (from the vendored component),
  and the layer itself is already `pointer-events: none`.
- Existing intensity (`--cave-backdrop-opacity` on the layer), the
  bg-base scrim `::after`, the `data-backdrop-on` glass/translucency
  contract, and the `prefers-reduced-transparency` hide-rule all apply
  unchanged — they are style-agnostic.
- New rule: `@media (prefers-reduced-motion: reduce)` hides the layer when
  `data-backdrop-style="blaze"` (belt to the component-level skip's
  suspenders; no frozen fire frame, no GPU spend).

### 6. Settings — `src/components/backdrop-settings.tsx`

- A labeled `Segmented` style picker (Image | Blaze) at the top of the
  Backdrop card.
- Choosing **Blaze**: `writeBackdropPrefs({ style: "blaze", enabled: true })`
  — works with no stored image; announce via `useAnnouncer`.
- Choosing **Image**: `enabled` becomes `true` iff a stored image exists
  (otherwise the card shows the chooser and stays off until one is picked).
- Image chooser, Clear, and "Match accent to the image" rows render only
  for the Image style; Intensity renders for both styles whenever enabled.
- Card hint copy updated to cover both styles, following the §10 copy
  contract (vocabulary, placeholder grammar not applicable here).

## Error handling

- **No WebGL2 / context lost:** `createBlaze` returns `null`; the layer
  stays quietly empty. No error surface — the backdrop is decorative.
- **Accent parse failure:** exact playground colors (above).
- **Reduced motion:** layer hidden + component not mounted.
- **Offscreen / backgrounded:** the component's own `IntersectionObserver`
  stops the RAF loop.
- **Server-side validation:** unknown `style` values rejected by the
  strict patch path; normalization coerces bad stored values to `"image"`.

## Testing

Repo's node source-contract style, extending existing suites:

- `preferences-schema.test.ts` — style default + normalization, strict
  patch accepts `"blaze"` / rejects unknown, legacy mirror round-trip.
- `cave-backdrop.test.ts` — `DEFAULT_PREFS.style`, write plumbing.
- New contract test (blaze layer) — reduced-motion guard, lazy
  `next/dynamic` import, playground fallback constants, exact option
  values, `backdrop.css` reduced-motion rule for the blaze layer.
- Settings a11y contract — labeled segmented control, announcements.
- Gates: `pnpm lint` (design ESLint + codemod check),
  `design-token-drift.test.ts`, app test suite, `pnpm build`.

## Delivery

1. Branch `blaze-backdrop` in `.worktrees/blaze-backdrop`, signed commits,
   PR to `main`; required checks (Frontend build, Rust check, CodeQL,
   E2E (Playwright)) green, then squash-merge and delete the branch;
   remove the worktree; close bead cave-99s9.
2. **Post-merge cleanup of the primary checkout** (user-approved): discard
   the staged shadcn experiment — `components.json`, the `globals.css`
   shadcn theme dump, the `layout.tsx` Inter font change, the
   `package.json`/`pnpm-lock.yaml` dependency additions, `__shoot2.mjs`,
   and the staged registry copy of `Blaze.tsx` — then `pnpm install` to
   prune. `src-tauri/src/sidecar_discovery.rs` and `.beads/*` are left
   untouched (other sessions' work).

## Out of scope

- Per-familiar Blaze overrides (per-familiar backdrops stay image-only).
- Additional animated styles (the option set makes room; none ship here).
- Content heat-distortion via the experimental HTML-in-canvas API (never
  routed; the backdrop renders fire only).
