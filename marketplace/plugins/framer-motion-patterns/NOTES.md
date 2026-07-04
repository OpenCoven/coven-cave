# NOTES — framer-motion-patterns

The "why this exists / trade-offs / when NOT to use" appendix. Read alongside `SKILL.md`.

## Why this skill exists
Coding agents repeatedly need to add motion to React UIs, and the two
common failure modes are (1) shipping inaccessible motion (no `prefers-reduced-motion` handling; motion
as the *only* state signal) and (2) reaching for the wrong tool (heavy imperative GSAP inside React, or
animating layout properties that thrash). This skill gives a decision tree + a verified recipe library so
a familiar can implement correct, performant, accessible motion on the first pass.

It **complements, not duplicates**, the existing marketplace plugins:
- `threejs-animation` — 3D/WebGL scene animation; this skill is 2D DOM/UI motion.
- `opencoven-design` / `lit-ui-designer` / `figma` / `canva` — design constraints, Lit components,
  design context, and asset creation respectively. This skill is the *implementation* layer for React
  UI motion and is intentionally framework-leaning (React) where those are broader.

## The rebrand (important context)
- *Framer Motion* → **Motion** in 2024. npm package `framer-motion` → **`motion`**; canonical import is
  **`motion/react`**. The old package/import still resolve, so legacy code with `from "framer-motion"`
  keeps working — but new code should use `motion`.
- `www.framer.com/motion/` **301-redirects to `motion.dev`** (verified). Docs: `motion.dev/docs`.
- Motion is now **independent + MIT** (irrevocable), sponsored by Framer/Figma/Sanity/Tailwind/
  LottieFiles + Motion+ sales. This matters for procurement/licensing decisions vs GSAP.

## Trade-offs & sharp edges
- **Layout animations animate `transform`.** Anything that distorts under scale — `borderRadius`,
  `boxShadow`, text during a size change — needs care: use `layout="position"`, drive the property as a
  motion value, or animate a wrapper. Elements must be **rendered** (not `display:none`) to be measured.
- **`AnimatePresence` keys.** The #1 bug source: children need stable, unique `key`s. Reused/index keys
  make exit animations misfire.
- **`mode` selection is not cosmetic.** `wait` serializes exit→enter (page transitions), `popLayout`
  removes exiting nodes from flow so neighbors reflow immediately (lists/toasts). Default `sync` overlaps.
- **Reduced-motion fallback must change *kind*, not degree.** Shrinking a big translate to a smaller
  translate still moves and can still trigger vestibular symptoms. The correct fallback is opacity
  crossfade or an instant state change. `<MotionConfig reducedMotion="user">` does this globally for
  transform/layout while keeping opacity/color; use `useReducedMotion()` to also disable custom loops,
  parallax, and autoplay carousels.
- **Motion values don't re-render.** That's the point (perf), but it means React state derived from them
  needs `useMotionValueEvent`/`.on("change")` or `useState` bridging — don't expect a `useTransform`
  output to trigger a component re-render.
- **Timelines are immutable (for now).** Motion's `animate([...])` sequence array is declarative and
  readable but **cannot** be mutated mid-playback (add/remove tracks). GSAP can. If a design needs
  runtime-mutable timeline choreography, that's the one place GSAP still wins outright.
- **`will-change` is managed by the animation lifecycle.** Don't hardcode `will-change` broadly in CSS —
  permanent GPU layer promotion wastes memory and can *hurt* perf.
- **Vendor benchmarks.** The "2.6/18/23.5kb", "2.5×/6× faster than GSAP", and "120fps" figures come from
  motion.dev's own comparison page — directionally reliable (tree-shaking + WAAPI acceleration are real
  architectural advantages) but treat exact multipliers as marketing. The legacy "~119kb minified" figure
  is a 2023 third-party measurement of the old monolithic package and is historical, not current.

## When NOT to use Motion
- **A CSS transition suffices** (hover color, single-property fade) — don't add ~18kb+ of JS. Motion's
  own docs recommend CSS for trivial self-contained effects.
- **Non-React site needing intricate, runtime-mutable timelines**, or heavy SVG/canvas/WebGL sequencing →
  **GSAP** (or Motion's vanilla `animate()`/timeline if MIT + hardware-accel matters and you don't need
  mutation).
- **You only need a native primitive with zero deps** → **Web Animations API** (`element.animate`).
- **Pure physics springs, hooks-only, no layout/gesture needs** → **React Spring** is a reasonable pick,
  though Motion covers this too (`useSpring`, spring transitions).

## Verification / testing checklist for a familiar
- [ ] App wrapped in `<MotionConfig reducedMotion="user">`.
- [ ] Every transform/parallax/loop has a reduced-motion branch (test with OS "Reduce motion" ON).
- [ ] No essential info conveyed *only* by animation (static/text state also present).
- [ ] Animating `opacity`/`transform`/`filter`/`clipPath` only (no `width`/`top`/`margin`).
- [ ] `AnimatePresence` children have stable unique keys; correct `mode`.
- [ ] Keyboard: focus order intact after layout animations; focus ring preserved; Enter activates.
- [ ] Any motion > 5s has a pause/stop affordance (WCAG 2.2.2).
- [ ] Imports use `motion/react`.

## Framework portability
Concepts port across React/Vue/Svelte:
- Motion has first-class **Vue** (`motion-v`) and **vanilla** (`motion`) APIs; spring-vs-tween, reduced
  motion, transform-only, and WAAPI/ScrollTimeline acceleration are identical there.
- For **Svelte**, Svelte's built-in `transition:`/`animate:` + `svelte/motion` (`spring`, `tweened`)
  cover most of this; the *principles* in Guardrails (reduced motion, transform-only, no motion-gated
  info) still apply verbatim.

## Primary sources
All URLs in `plugin.json` `x-coven.sourceRefs` were fetched/verified on 2026-07-01. Full annotated list
with what each confirms lives in `research/synthesis/2026-07-01-framer-motion-patterns.md`.
