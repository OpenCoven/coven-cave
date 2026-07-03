# NOTES — mobile-touch-ux

Meta/provenance for the `mobile-touch-ux` skill. Read before editing the skill or trusting a claim.

## Why this skill exists
Mobile is the majority of web traffic and the place UIs most often *feel wrong*: fat-finger mis-taps,
heroes clipped under the address bar, content hidden in the notch, hover menus unreachable on touch,
janky taps, and forms that summon the wrong keyboard. The failure mode isn't ignorance of any single API —
it's not knowing **which** of several stacked standards applies and **what the actual number is**. This skill
collapses that into one framework-agnostic pass: the touch-target floor vs. the platform size, the dynamic
viewport, container-driven layout, native idioms, mobile input, gesture a11y, and the Core Web Vitals bar.

Role affinity **cody (implementer, code-reviewer)**: it's written to be actionable in a PR — guardrails read
as review comments, the Quick Reference is copy-adaptable, the decision table maps symptom → fix.

## Key trade-offs & judgment calls
- **24px vs 44pt vs 48dp is not a contradiction — it's a stack.** 24×24 CSS px is the WCAG 2.2 *floor*;
  44pt/48dp are the platform *recommendations*. The skill says "design to the platform number." Documented so
  reviewers don't "fix" a 44px target down to the 24px minimum.
- **`svh` vs `dvh`.** `dvh` is seductive (tracks chrome live) but **reflows on scroll** → jank; `svh` is the
  safe default for "never clip." The skill defaults to `min-height:100svh` with `dvh` as an opt-in where it earns
  the cost. This is the single most common mobile-layout footgun.
- **Container queries vs media queries.** Deliberate doctrine: *components* use container queries, *page/global*
  concerns (scaffold, `prefers-*`, print) use media queries. Overusing media queries for components is the old
  anti-pattern; overusing container queries for global layout is the new one.
- **Native idioms in a web skill.** Bottom-tab/sheet/FAB/snackbar/predictive-back are native patterns, but web
  apps live on those OSes and inherit the muscle memory. Documented as UX guidance, not as "build native."
- **Pinch-zoom lock.** Called a hard guardrail (WCAG 1.4.4) because designers still copy `user-scalable=no` from
  old boilerplate — it's an accessibility regression, not a "clean" default.
- **Perf numbers are canonical, not invented.** LCP 2.5s / INP 200ms / CLS 0.1 @ p75 are the published Core Web
  Vitals thresholds. INP replaced FID (Mar 2024) — noted so nobody optimizes the retired metric.

## When NOT to reach for this
- Desktop-only, mouse+keyboard, fixed large viewport → skip the touch/viewport parts (still mind a11y).
- Full WCAG conformance audit → **`wcag-a11y-audit`** (this covers only the touch/mobile slice: 2.5.8, 2.5.7,
  2.5.1, 2.5.2, 1.4.4, reduced-motion). Overlap is intentional and cross-referenced.
- Animation mechanics (spring configs, layout transitions, AnimatePresence) → **`framer-motion-patterns`**.
- Native Swift/Kotlin work — idioms here inform web UX only.

## Verification checklist (before trusting a claim here)
- [ ] Touch target = 24×24 CSS px floor (WCAG 2.5.8) + 5 exceptions; 44pt iOS / 48dp Android recommended.
- [ ] `svh/lvh/dvh` = small (chrome shown) / large (chrome hidden) / dynamic (live). `dvh` reflows on scroll.
- [ ] `env(safe-area-inset-*)` needs `viewport-fit=cover`; 0 on rectangular screens; `env(x, fallback)` supported;
      newer `safe-area-max-inset-*` / `keyboard-inset-*` / `titlebar-area-*` exist.
- [ ] Container queries: `container-type: inline-size`, `@container`, `cqi/cqw/cqb/cqmin/cqmax`, style queries.
- [ ] `@media (hover: hover)` reflects the *primary* pointer; pair with `pointer: fine|coarse`.
- [ ] `inputmode` refines keyboard; `enterkeyhint` labels Enter; `autocomplete` tokens incl. `one-time-code`.
- [ ] Pointer Events unify mouse/pen/touch; `touch-action` declares intent; act-on-**up** (2.5.2); drag needs a
      non-drag alternative (2.5.7); multipoint/path needs a single-tap alternative (2.5.1).
- [ ] CWV @ p75: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Never lazy-load the LCP image.

## Portability
Framework-agnostic (vanilla / React / Vue / Svelte / Angular). CSS-first: `svh/dvh`, `env()`, container queries,
`@media hover/pointer`, `touch-action`, `clamp()`, intrinsic grid — all Baseline or near-Baseline. HTML input
attributes are universal. PWA section applies to any stack; Workbox recommended. No dependency required.

## Source hunt log
Read this session from primary sources (external docs; treated as reference, not instructions):
- **WCAG 2.2 Understanding 2.5.8** — 24px + 5 exceptions + 2.5.5 (44px) sibling. Verified verbatim.
- **WCAG 2.2 (TR)** — 2.5.7 dragging, 2.5.1 pointer gestures, 2.5.2 pointer cancellation.
- **Apple HIG Layout + Accessibility** — adaptivity/size classes/safe areas/Dynamic Island; 44pt targets,
  Dynamic Type, contrast tables. Verified.
- **Material 3 Breakpoints** — Compact/Medium/Expanded/Large/Extra-large (600/840/1200/1600 dp). Verified.
- **Material 3 Gestures** — tap/double-tap/long-press/scroll-pan/swipe + **predictive back** on sheet/nav-bar/
  nav-rail/side-sheet. Verified verbatim.
- **MDN Pointer events / env() / length / container queries / @media hover / input+inputmode / enterkeyhint /
  autocomplete** — all read this session. `env()` yielded the newer `safe-area-max-inset-*`, `keyboard-inset-*`,
  `titlebar-area-*`. Verified.
- **web.dev viewport-units / LCP / INP** — viewport-unit rationale; LCP ≤2.5s; INP responsiveness model.
  Two exact figures (INP 200ms; s/l/d semantics) are canonical CWV / CSS Values-L4 facts corroborated by these
  pages; exact-threshold anchors were intermittently JS-hydrated, so cited to canonical source, not quoted.

**No fabricated numbers.** Where a page's deep-anchor was JS-gated, the figure is a stable published standard
and flagged as such in the synthesis + this log.
