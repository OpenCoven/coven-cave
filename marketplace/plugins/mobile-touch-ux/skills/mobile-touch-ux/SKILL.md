---
name: mobile-touch-ux
description: Use when building, reviewing, or debugging any mobile/responsive web UI (or a PWA / web view meant to feel native) — sizing touch targets, fixing the 100vh/notch/on-screen-keyboard bugs, making layouts adapt with container queries instead of device-pixel breakpoints, choosing bottom-nav vs hamburger / sheet vs modal / action-sheet vs dropdown, wiring the right mobile keyboard (inputmode/enterkeyhint/autocomplete), handling touch gestures with Pointer Events + touch-action, honoring hover-vs-touch, or hitting mobile Core Web Vitals (LCP/INP/CLS) with responsive images and lazy-loading. Reach for it on any cue like "mobile", "touch", "responsive", "breakpoint", "safe area / notch / Dynamic Island", "svh/dvh", "container query", "tap target", "hamburger vs tab bar", "PWA/offline", "keyboard covers input", "swipe/drag", or a PR that ships a phone layout. Framework-agnostic; pairs with wcag-a11y-audit and framer-motion-patterns.
---

# Mobile Touch UX & Responsive Patterns

Framework-agnostic mobile-web / PWA checklist. Mobile ≠ narrow desktop: **imprecise finger** (no hover,
no right-click), **dynamic viewport** (shifting chrome, notch, on-screen keyboard), **slow radio + weak CPU**.
Four disciplines: touch ergonomics · dynamic viewport & safe areas · pointer-adaptive/container-driven layout ·
mobile performance & input.

## Use When
- Building or reviewing a phone/tablet layout, or a PWA / web view meant to feel native.
- Sizing tap targets; fixing `100vh` clipping, notch/Dynamic-Island bleed, or keyboard-covers-input bugs.
- Choosing navigation (bottom-nav vs hamburger), sheet vs modal, action-sheet vs dropdown, drag-to-reorder.
- Deciding breakpoint strategy, or replacing device-width media queries with container queries.
- Wiring mobile inputs (`inputmode`/`enterkeyhint`/`autocomplete`), custom swipe/drag, or hover-vs-touch UI.
- Hitting mobile Core Web Vitals (LCP/INP/CLS) or shipping offline/installable.

## Don't Use For
- Pure desktop-only apps with mouse+keyboard and a fixed large viewport (still mind a11y).
- Full accessibility conformance auditing → **`wcag-a11y-audit`** (this covers only the touch/mobile slice).
- Animation implementation detail (spring configs, AnimatePresence) → **`framer-motion-patterns`**.
- Native Swift/Kotlin engineering — this is web/PWA; native *idioms* are documented only to inform web UX.

## Guardrails
- **Touch target floor is WCAG 2.5.8 = 24×24 CSS px; ship the platform size: 44pt (iOS) / 48dp (Android).**
  Keep visuals small if you must, but expand the *hit area* (padding / `::after { inset: -12px }`). ≥8px apart.
- **Never `100vh` for full-height on mobile.** Use `min-height: 100svh` (fallback `100vh`); use `dvh` only where
  live-tracking helps — it reflows on scroll, so don't animate layout with it.
- **Never block pinch-zoom.** No `user-scalable=no` / `maximum-scale=1` (WCAG 1.4.4). Always ship
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Never hover-lock content.** Any "reveal on hover" needs a tap path; gate hover behind
  `@media (hover: hover) and (pointer: fine)`. Touch has no hover.
- **Container queries for components; media queries for page/global** (layout scaffold, `prefers-*`, print).
  Breakpoints are **content-driven, mobile-first** — device-pixel breakpoints (`iPhone = 390px`) are an anti-pattern.
- **Every drag needs a non-drag single-pointer alternative** (WCAG 2.5.7); every multipoint/path gesture needs a
  **single-tap alternative** (2.5.1); fire on the **up** event so users can slide off to abort (2.5.2).
- **The LCP image is never lazy-loaded.** `loading="lazy"` is for below-the-fold only; preload/`fetchpriority=high` the hero.
- **Reserve image space** (`width`/`height` or `aspect-ratio`) or CLS tanks. Give **instant tap feedback** or INP tanks.
- iOS auto-zooms inputs under **16px** font — keep form inputs ≥16px.

## Default Flow (mobile pass / PR review)

### 1. Viewport & safe areas
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (no zoom lock).
- Full-height: `min-height: 100svh` (fallback `100vh`); `dvh` only where it earns the reflow cost.
- Inset UI out of notch/home-bar: `padding: max(pad, env(safe-area-inset-*))`. Bottom bars must clear
  `env(safe-area-inset-bottom)`. Use `env(x, fallback)`; consider `safe-area-max-inset-*` to avoid reflow.

### 2. Touch targets & spacing
- Interactive controls ≥44px hit area (≥48dp Android feel); never below 24×24 CSS px; ≥8px gaps.
- Small icon → keep visual, expand tappable zone with padding or `::after { position:absolute; inset:-12px }`.

### 3. Pointer-adaptive layout
- Enlarge for fingers: `@media (pointer: coarse){ .btn{ min-block-size:48px } }`.
- Hover reveals only inside `@media (hover: hover) and (pointer: fine)`; always keep a tap path.

### 4. Responsive strategy (mobile-first, container-driven)
- Base styles = smallest screen (single column). Add complexity with `min-width` / component container queries.
- Components: `container-type: inline-size` on the wrapper + `@container (width > …)`; size type with `cqi`.
- Prefer intrinsic layout (`flex-wrap`, `grid repeat(auto-fit, minmax(min(100%,16rem),1fr))`, `clamp()`).
- Add breakpoints where *content* breaks, not at device widths.

### 5. Navigation & surfaces (respect platform muscle memory)
- Primary nav on phones → **bottom tab bar / navigation bar** (thumb-reach), not a hidden hamburger.
  Android: bar → rail → drawer as the window grows. Drawer = secondary/overflow only.
- Choices → **action/bottom sheet** over desktop dropdown. Distinguish **sheet** (contextual/half-height,
  drag-dismiss grabber) from full-screen **modal** (self-contained task).
- iOS: don't hijack the left **back-swipe** edge; support **pull-to-refresh**. Android: don't fight
  **predictive back** (preview-before-commit). Snackbar/toast = transient feedback, not critical errors.
- FAB (Android) for the single primary action.

### 6. Mobile input
- Semantic `type=` first (`email`/`tel`/`url`/`search`/`number`) → sets keyboard **and** behavior.
- Refine keyboard with **`inputmode`** (`numeric`/`decimal`/`tel`/`search`/`none`); e.g. OTP:
  `type="text" inputmode="numeric" autocomplete="one-time-code" enterkeyhint="done"`.
- **`enterkeyhint`**: `next` on chained fields, `search` on search, `send` on chat, `go` on URL.
- **`autocomplete`** tokens (`given-name`, `email`, `postal-code`, `one-time-code`, `shipping`/`billing` prefixes)
  for OS/password-manager autofill. Don't `autocomplete="off"` normal fields.
- Keyboard displacement: `scrollIntoView({block:'center'})` on focus; VisualViewport API or `env(keyboard-inset-*)`
  for sticky CTAs; `navigator.virtualKeyboard.overlaysContent = true` where supported. Inputs ≥16px (iOS).

### 7. Gestures (Pointer Events)
- One `pointerdown/move/up/cancel` stream for mouse/pen/touch; `setPointerCapture` for drags; check `pointerType`.
- Declare intent with **`touch-action`**: `manipulation` (kills tap delay on buttons), `pan-y` (horizontal swipe
  zone that still scrolls), `none` (fully custom).
- Canonical semantics — tap=activate · long-press=context/select · swipe=peer views/row actions · pinch=zoom ·
  edge-swipe=back. Don't overload gestures with surprising meanings.
- **A11y:** non-drag alternative (2.5.7) + single-tap alternative for multipoint/path (2.5.1) + act-on-up (2.5.2).
  Honor `prefers-reduced-motion`. On iOS, native feel = subtle **spring** physics (see `framer-motion-patterns`).

### 8. Performance (Core Web Vitals @ p75, mobile is the hard case)
- Targets: **LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1**.
- Images: `srcset`/`sizes`, AVIF/WebP, explicit dimensions/`aspect-ratio`; preload + `fetchpriority=high` the LCP
  image, **never** lazy-load it; `loading="lazy"` everything below the fold.
- JS: route/interaction code-splitting, break up long tasks, yield to main thread; JS is the #1 INP killer.
- Long lists: `content-visibility: auto`. Give instant visual feedback on tap.

### 9. PWA / offline (if installable)
- Manifest (`name`, `short_name`, `start_url`, `display: standalone`, theme/bg color, 192/512 + maskable icons)
  + service worker + HTTPS = installable.
- Cache patterns: **cache-first** (versioned static assets) · **network-first** (fresh HTML/API, cache fallback)
  · **stale-while-revalidate** (feeds/avatars). **Precache the app shell**; provide an offline fallback page.
- Use **Workbox** rather than hand-rolling invalidation. Apply §1 safe-area insets (no browser chrome in standalone).

## Quick reference
```html
<!-- viewport: adaptive, edge-to-edge, zoom NOT blocked -->
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```
```css
/* Full-height without the 100vh mobile clip */
.screen{ min-height:100vh; min-height:100svh; }
@supports (height:100dvh){ .app-shell{ height:100dvh; } }

/* Notch / home-indicator safe insets */
.header{ padding-top:max(1rem, env(safe-area-inset-top)); }
.bottom-nav{ padding-bottom:max(.5rem, env(safe-area-inset-bottom)); }

/* Finger-sized target + expanded hit area for a tiny icon */
.icon-btn{ min-block-size:44px; min-inline-size:44px; display:inline-grid; place-items:center; }
.tiny{ position:relative; } .tiny::after{ content:""; position:absolute; inset:-12px; }

/* Pointer-adaptive: enlarge for touch, hover only where real */
@media (pointer:coarse){ .btn{ min-block-size:48px; } }
@media (hover:hover) and (pointer:fine){ .card:hover .card__actions{ opacity:1; } }

/* Component responsiveness via CONTAINER, not viewport */
.grid{ container:cards / inline-size; }
@container cards (width > 480px){ .card{ grid-template-columns:160px 1fr; } }
h2{ font-size:clamp(1.1rem, 4cqi, 1.8rem); }

/* Intrinsic layout kills most breakpoints */
.auto{ display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%,16rem),1fr)); gap:1rem; }

/* Custom swipe area that still scrolls vertically; fast taps on buttons */
.swipe{ touch-action:pan-y; } .btn{ touch-action:manipulation; }
```
```html
<!-- Mobile-friendly inputs -->
<input type="email"  autocomplete="email"        enterkeyhint="next">
<input type="text"   inputmode="numeric"         autocomplete="one-time-code" enterkeyhint="done" maxlength="6">
<input type="search" autocomplete="off"          enterkeyhint="search">
<!-- Responsive, CLS-safe, non-lazy hero image -->
<img src="hero-800.avif" srcset="hero-400.avif 400w, hero-800.avif 800w, hero-1600.avif 1600w"
     sizes="(max-width:600px) 100vw, 50vw" width="1600" height="900" fetchpriority="high" alt="…">
```

## References
WCAG 2.2 target-size 2.5.8 (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · WCAG 2.2 dragging/gestures 2.5.7/2.5.1/2.5.2 (https://www.w3.org/TR/WCAG22/) · Apple HIG Layout (https://developer.apple.com/design/human-interface-guidelines/layout) · Apple HIG Accessibility (https://developer.apple.com/design/human-interface-guidelines/accessibility) · Material 3 Breakpoints (https://m3.material.io/foundations/layout/breakpoints) · Material 3 Gestures (https://m3.material.io/foundations/interaction/gestures) · MDN Pointer events (https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) · MDN env() (https://developer.mozilla.org/en-US/docs/Web/CSS/env) · MDN length/viewport units (https://developer.mozilla.org/en-US/docs/Web/CSS/length) · web.dev viewport units (https://web.dev/blog/viewport-units) · MDN Container queries (https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries) · MDN @media hover (https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover) · MDN inputmode/input (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input) · MDN enterkeyhint (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint) · MDN autocomplete (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete) · web.dev LCP (https://web.dev/articles/lcp) · web.dev INP (https://web.dev/articles/inp).
