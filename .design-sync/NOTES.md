# design-sync notes — coven-cave

- **App repo, not a library**: no dist/, no Storybook. Synth-entry mode with `entry: "./dist/index.js"` deliberately pointing at a nonexistent path — that anchors PKG_DIR at the repo root (the entry-override walk-up) while still triggering synth-entry. Do not "fix" the path.
- **Component discovery is fully enumerated** in `componentSrcMap` (41 components): with no `.d.ts` exports, any single pin suppresses `deriveComponentsFromSrc`, so the map must name every component. New ui/ primitives must be added there to sync.
- **Icon ships via `extraEntries`** (`./src/lib/icon.tsx`) — it lives outside `srcDir` so the synth entry doesn't include it. The `[EXPORT_COLLISION] Icon` warn at build is a false positive (the "main package" side is the component-list entry, not a real binding); Icon's only real binding comes from extraEntries.
- **CSS must be pre-compiled through Tailwind v4**: `src/app/globals.css` is a CSS-first Tailwind entry (`@import "tailwindcss"`) and ui/ primitives use utility classes. `buildCmd` = `node .design-sync/build-css.mjs` → `.design-sync/.cache/globals.compiled.css` (cssEntry). The script resolves `postcss` through `@tailwindcss/postcss`'s dep tree (pnpm exposes only direct deps).
- **Fonts**: the app injects `--font-*` via next/font at runtime. `.design-sync/fonts.css` (authored, prepended by build-css.mjs) defines all 25 `--font-*` vars + Google Fonts remote @import for the canonical trio (EB Garamond / Inter / JetBrains Mono) + Plus Jakarta Sans + IBM Plex Mono. Validate reports `[FONT_REMOTE]` — expected, families load at runtime.
- **Playwright**: repo pins playwright@1.61.1 (chromium-1228, matches local `~/Library/Caches/ms-playwright`). pnpm doesn't hoist it to root `node_modules`, so it's installed into `.ds-sync/` (`npm i playwright@1.61.1` there). Re-do on fresh clone.
- **Icon bare-name fix**: the app renders `<Icon name="cat">` with BARE names but the iconify subset registers under prefix `ph` — in the standalone bundle every bare lookup misses (empty `<span>`; the live app has some runtime affordance that makes it work). Fix: `.design-sync/icon-bootstrap.tsx` in `extraEntries` re-registers the subset with `prefix: ""` so simple-name storage/lookup are symmetric. Without it, every icon in every preview is invisible.
- **Preview authoring recipe**: wrap each cell in a `Surface` div with `background: var(--background)`, padding, `borderRadius: var(--radius-card)` — default palette is coven DARK and card bodies are white, so unwrapped components float on white. Import from `"coven-cave"`. Use domain copy (familiar/summon/grimoire) and real icon names from `src/lib/icon.tsx` ICON_NAMES.
- Themes are attribute-driven: `data-theme` (21 palettes) × `data-mode` (dark|light) on `<html>`; tokens all defined in globals.css `:root` + theme blocks. Default with no attributes = coven dark.

## Component preview quirks (folded from wave 1 learnings)

- **Overlay open-state recipes** (all render statically): components owning their open state (OverflowMenu, AvatarLightbox) → host div ref + `useEffect(() => ref.current?.querySelector("button")?.click(), [])`; ConfirmProvider → child calls `useConfirm()` on mount, never resolves; Popover → `useState(true)` + Button (forwardRef) as anchor; ContextMenu → static `{x,y}`; UndoToast → `durationMs={60000}` so the countdown bar is still full; SeparatorHandle dragging → pass `className="ui-sep-handle--dragging"`.
- **Icon names**: both bare ("trash") and `ph:`-prefixed forms resolve at runtime (bootstrap registers both); the app's TS types want `ph:`-prefixed for some props (SearchInput default is `"ph:magnifying-glass"`) — esbuild preview compile doesn't typecheck, so bare names pass.
- **TextInput/TextArea have no standalone chrome** — all label/error styling comes from Field context; preview them inside Field only. Field's `error` prop cascades invalid styling automatically.
- **IconButton `danger` is hover-only** (no at-rest tint) — static captures show it identical to plain; real behavior.
- **RelativeTime** flips to absolute dates past ~a week — keep preview timestamps within days of now.
- **TrendChart y-domain is 0-anchored** — high-baseline metrics (88–99%) pin to the top; use counts/queue-depth data.
- **PulseBars collapses to 0 width in a bare flex row** (grid-auto-columns:1fr) — needs fixed-width wrappers.
- **Sparkline's `.spark`/`.spark-tip` CSS lives in `src/styles/dashboard.css`**, not imported by the component → absent from the bundle. Static render fine (SVG attrs); hover tooltip would be unpositioned.
- **SettingControlRow** is a bundle export (same file as Segmented) but not carded — covered via the SettingsGroup preview.
- Charts wrap themselves in ParentSize — a width-constrained parent suffices.
- Skipped-by-design states: hover reveals, focus rings, shimmer/pulse animations, ColorPicker drag, Popover keyboard-clamp placements.

## Known render warns

- Chart cards may screenshot as "No data yet" in validate's full sweep: @visx `useParentSize` applies measurements via `requestAnimationFrame`, and occluded/backgrounded headless pages get rAF throttled/starved — nondeterministic per page load; live/visible pages render in ~1 frame (the debounce has a leading-edge call, so `debounceTime` is irrelevant). Not a bundle defect. Mitigate in screenshot harnesses with `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-timer-throttling`, or triage the warn against this note.
- `[TOKENS_MISSING]` (~14 vars): `--toast-accent` (set at runtime via inline style by inbox-toast), `--x` (JS-set), `--accent-rose`, `--bg-sunken`, `--danger-bg/-border/-text`, `--accent-contrast` etc. — referenced by app surfaces (inbox-toast, craft-dossier, projects-view) but never defined in the repo either; pre-existing app quirk, not a bundle defect.
- `[EXPORT_COLLISION] Icon` — false positive, see above.

## Re-sync risks

- `.design-sync/fonts.css` enumerates the next/font variables by hand — if `src/app/fonts.ts` adds/renames families, the map goes stale ([TOKENS_MISSING] on new `--font-*` names is the signal).
- `componentSrcMap` is a hand enumeration — new/renamed ui/ components silently don't sync until added.
- Google Fonts remote @import is a network dependency at render time.
- Tailwind compile scans the whole repo for utility usage (base = repo root); output changes when any app source adds new utility classes — harmless but expect `_ds_bundle.css` churn.
