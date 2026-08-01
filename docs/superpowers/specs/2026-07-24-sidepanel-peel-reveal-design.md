# Sidepanel peel-reveal (collapsed nav) — design

- **Date:** 2026-07-24
- **Bead:** cave-3vgd
- **Branch:** `peel-sidepanel-reveal` (worktree `.worktrees/peel-sidepanel-reveal`)

## Summary

Progressive enhancement for the collapsed left sidepanel: when the desktop
nav sits at its 56px icon rail, moving the cursor toward the left edge of
the detail pane **peels the page back like paper** (WebGL page-curl),
revealing the sidebar underneath; reaching the rail hands off to the
existing interactive frosted hover-peek at the same 232px, so the revealed
sidebar "becomes real". The effect renders only on browsers with Chromium's
experimental **HTML-in-canvas** API (`drawElementImage` + `requestPaint` +
`layoutsubtree`); everywhere else — the Tauri desktop shell (WKWebView),
Safari, Firefox, stock Chrome — behavior and DOM cost are unchanged.

Source component: Canvas UI **Peel**, shadcn registry item
`@canvas-ui/peel-react` (`components/canvasui/Peel.tsx`, single
self-contained React + WebGL2 file, zero dependencies, same author and
license as the already-vendored `Blaze.tsx`). Per the Blaze precedent the
repo does **not** adopt shadcn scaffolding — the install uses a transient
`components.json` that is deleted before commit; only the component file is
vendored.

## Decisions (user-confirmed)

1. **Strategy: progressive enhancement.** The existing rail hover-peek
   (`navPeeking` / `shell-nav--peek`) remains the functional, interactive
   reveal path everywhere. The peel is a purely decorative additive layer.
2. **Approach A:** cursor-driven peel on the detail pane with the sidebar
   as the `under` layer — not a replacement for the peek (rejected: `under`
   is never clickable), not install-only.
3. **Install via `npx shadcn@latest add @canvas-ui/peel-react`** (verified
   working against a minimal non-Tailwind `components.json`; the registry
   item pins its target to `components/canvasui/Peel.tsx`). The
   `components.json` is transient and removed before commit.
4. **Options:** `side="left"`, `mode="cursor"` (progressive curl as the
   pointer nears the edge), `reveal: 232` (matches the peek overlay width),
   `zone: 120` (narrower than the 200 default so casual mouse travel does
   not trigger it), `shineColor: "auto"` (follows theme — must look
   intentional across all 21 palettes × 2 modes), remaining options at
   vendor defaults.

## Components

### 1. Vendored component — `src/components/canvasui/Peel.tsx`

- Exact registry payload, then the repo's design auto-fixer
  (`pnpm codemod:design`) applied once. Verified against the payload: it
  reports exactly 4 static inline style objects (under layer, native
  content wrapper, fallback content wrapper, output canvas) which the
  codemod rewrites to arbitrary-property utility classes — the same
  mechanical treatment `Blaze.tsx` received. ESLint `coven-design/*` and
  `codemod:design:check` both green afterward; the container's
  `style={{ position: "relative", ...style }}` spread is runtime-derived
  and allowed.
- A short provenance header comment records the source registry URL and
  fetch date so future updates can re-diff against upstream.
- No other edits (vendor-verbatim, per cave-kbh1 precedent). The existing
  `src/components/canvasui/UPSTREAM_LICENSE.txt` (MIT + Commons Clause,
  same upstream author) already covers the directory; no license change.
- Component facts the design relies on: `supported` is probed via
  `useSyncExternalStore` with a `false` server snapshot (SSR-safe); when
  not native it renders children in a plain fallback wrapper with no
  canvases active; `under` is rendered only in native mode; the output
  canvas is `aria-hidden` + `pointer-events: none`; a `ResizeObserver`
  keeps geometry current; `setOptions` applies live option changes without
  re-mount.

### 2. Wrapper — `src/components/shell-peel-reveal.tsx` (new)

Client component modeled on `cave-backdrop-blaze.tsx`:

- `const Peel = dynamic(() => import("@/components/canvasui/Peel"), { ssr: false })`
  — the ~22 KB WebGL file stays out of the main bundle and off the network
  for every non-enhanced environment.
- **Local support probe** (3-line `drawElementImage`/`requestPaint` check
  behind `useSyncExternalStore`, server snapshot `false`) duplicated in the
  wrapper so the probe itself never imports the vendored module.
- `usePrefersReducedMotion()` — reduced motion is **never enhanced**: no
  peel, no WebGL, no vendored download.
- Props: `{ active: boolean; under: ReactNode; children: ReactNode }`.
- **Non-enhanced path** (`!supported || reducedMotion` — every current
  production environment): children render inside
  `<div className="shell-peel-reveal shell-peel-reveal--plain">` with
  `display: contents`, contributing zero layout impact. The wrapper element
  is structurally stable; children are never re-parented by `active`
  toggling. (A mid-session reduced-motion change re-parents once — rare,
  accepted; Blaze unmounts similarly.)
- **Enhanced path** (`supported && !reducedMotion`): `<Peel>` is mounted
  **permanently** (not gated on `active`) so ⌘B / rail toggles never
  re-parent the detail tree. `active` switches the option set instead:
  `{ reveal: 232, zone: 120 }` when the rail is collapsed vs
  `{ reveal: 0, zone: 0 }` when the nav is open — geometry collapses to
  nothing via the vendor's live `setOptions`. Zero-value behavior is
  asserted during implementation on a flag-enabled Chromium (see Testing);
  if zeroing proves visually leaky, fall back to CSS
  `visibility: hidden` on the output canvas via a wrapper class — vendor
  file still untouched.
- **`under` layer:** rendered only while `active`; wrapped in
  `<div className="shell-peel-under" aria-hidden inert>` so the duplicate
  nav render is invisible to AT, unfocusable, and non-interactive. Backed
  by opaque `var(--bg-raised)` with a `var(--border-hairline)` right edge,
  232px wide — visually congruent with the peek overlay that takes over.
- **Scroll contract:** in enhanced mode the vendor's native content wrapper
  is `overflow: hidden`, so the wrapper adds its own inner
  `<div className="shell-peel-scroll">` reproducing `.shell-detail`'s
  scroll behavior (`height: 100%; overflow-y: auto; display: flex;
  flex-direction: column; min-height: 0`) around children. In the plain
  path this div also renders (stable tree) but as `display: contents`, so
  today's scroll behavior is byte-identical.
- **WebGL context-loss recovery:** capture-phase `webglcontextlost`
  listener on the wrapper bumps a `key` epoch to re-mount the vendored
  component, capped at `MAX_CONTEXT_RESTARTS = 3` — copied from
  `cave-backdrop-blaze.tsx` (cave-kbh1).

### 3. Shell wiring — `src/components/shell.tsx`

Inside `<main className="shell-detail">`, wrap the existing children
(banner triggers, `ShellBannerStrip`, `DetailSplitHost`):

```tsx
<ShellPeelReveal active={navPeekEnabled} under={nav}>
  …existing children…
</ShellPeelReveal>
```

- `navPeekEnabled` is the existing derivation
  (`navPolicy === "remembered" && !isMobile && !navOpen`) — the peel arms
  exactly when the interactive hover-peek is armed. No new state, no
  changes to the peek's handlers, classes, or CSS.
- `nav` is the same node the nav `<aside>` renders; the duplicate render
  exists only in enhanced+active mode and sits inert. Any `id` collisions
  from the duplicate are mitigated by `inert` + `aria-hidden` (decorative
  clone); audited during implementation for observable breakage (e.g.
  `aria-labelledby` targets resolving to the clone).

### 4. CSS — `src/styles/globals/shell-navigation.css`

Tokens only; no new colors, no off-grid values:

```css
.shell-peel-reveal--plain,
.shell-peel-reveal--plain > .shell-peel-scroll { display: contents; }
.shell-peel-reveal--live { flex: 1; min-height: 0; position: relative; }
.shell-peel-reveal--live .shell-peel-scroll { height: 100%; overflow-y: auto;
  display: flex; flex-direction: column; min-height: 0; }
.shell-peel-under { position: absolute; inset: 0 auto 0 0; width: 232px;
  background: var(--bg-raised); border-right: 1px solid var(--border-hairline); }
```

(Exact selectors settle during implementation; the contract is: plain mode
is layout-invisible, live mode reproduces `.shell-detail`'s scroll, the
under backing is opaque `--bg-raised` + hairline, width matches the 232px
peek overlay.)

## Interaction & accessibility

- The peel is **decorative only**: output canvas `pointer-events: none`,
  under layer `inert` + `aria-hidden`. Keyboard, screen-reader, and click
  behavior are identical in all modes; opening the sidebar remains rail
  hover-peek / rail click / ⌘B.
- `prefers-reduced-motion: reduce` → non-enhanced path entirely (the
  motion story is "no motion").
- `prefers-reduced-transparency` is unaffected: the under backing is
  already opaque; the peek overlay's existing opaque fallbacks stay in
  force.
- Color is never the only channel for anything (nothing is communicated by
  the peel that the peek doesn't also communicate interactively).

## Error handling

- **Probe false / SSR:** plain path; server HTML never contains canvases.
- **`createPeel` returns null** (no WebGL2 despite probe): vendor sets
  `failed`, renders the children fallback; wrapper stays live-classed —
  content still visible and scrollable via `.shell-peel-scroll`; one-time
  re-parent accepted on this exotic path.
- **Context lost:** epoch re-mount, ≤ 3 attempts, then quietly plain
  (matches Blaze).
- **Split/secondary tiles, banners:** all live inside `children` and peel
  together as one sheet — no per-surface special cases.

## Testing

Repo's node source-contract style:

- New `src/components/sidepanel-peel-reveal.test.ts`:
  - `shell.tsx` wires `<ShellPeelReveal active={navPeekEnabled} under={nav}>`
    inside `shell-detail`, and the existing peek regexes
    (`sidepanel-nav-peek.test.ts`) remain untouched/green.
  - Wrapper contract: `dynamic(..., { ssr: false })`, local probe with
    `false` server snapshot, `usePrefersReducedMotion` gate, permanent
    mount + option-zeroing on `active` (never conditional-mount on
    `active`), `inert` + `aria-hidden` under layer, context-loss epoch cap.
  - Vendored file: provenance header present; codemod-clean (the 4
    rewritten style objects stay as utility classes).
  - CSS contract: plain mode `display: contents`; live scroll rule;
    under-layer tokens.
- Gates: `pnpm lint` (codemod check + design ESLint), app test suite
  (includes `design-token-drift.test.ts`), `pnpm test:bundle`,
  `pnpm build`; PR required checks (Frontend build, Rust check,
  E2E (Playwright), Cross-environment required, Sidecar runtime required,
  CodeQL).
- **Manual native-path verification:** Chromium with
  `--enable-experimental-web-platform-features` (HTML-in-canvas): peel
  renders and follows the cursor at the left edge when collapsed; nav-open
  zeroing shows no residual effect; hand-off into the frosted peek reads
  continuous; theme swap re-tints the shine; no Playwright automation of
  the flag path in CI (out of scope).

## Delivery

1. Transient `components.json` → `npx shadcn@latest add
   @canvas-ui/peel-react` → delete `components.json` → provenance header →
   `pnpm codemod:design` → commit vendored file.
2. Wrapper, shell wiring, CSS, and contract test; signed commits; PR to
   `main`; required checks green; squash-merge; delete branch; remove
   worktree; close bead cave-3vgd.

## Out of scope

- Replacing or restyling the frosted hover-peek (it remains the only
  interactive reveal).
- `mode="hover"` full-snap variant (rejected as approach B).
- Peeling the list pane or any other edge/surface.
- Enabling the effect in the Tauri shell (WKWebView lacks the API).
- Committed shadcn scaffolding or new runtime dependencies.
- CI automation of the experimental-flag browser path.
