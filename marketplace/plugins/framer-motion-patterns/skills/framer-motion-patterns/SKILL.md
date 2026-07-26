---
name: framer-motion-patterns
description: Use when implementing UI motion in React with Motion (formerly Framer Motion; npm `motion`, import from `motion/react`): declarative animate/initial/exit, spring-vs-tween transitions, layout & shared-element transitions (layout / layoutId / LayoutGroup), AnimatePresence enter/exit, staggering and imperative sequences (useAnimate / useAnimationControls), cross-device keyboard-aware gestures (hover/tap/focus/pan/drag/Reorder), scroll-linked & scroll-triggered motion (useScroll / useInView / useTransform), motion values as a no-re-render reactive primitive (useMotionValue / useTransform), and production concerns: prefers-reduced-motion a11y (MotionConfig reducedMotion / useReducedMotion), transform-only hardware-accelerated performance, and choosing Motion vs CSS vs React Spring vs GSAP vs the Web Animations API. Includes recipes: modal, drawer/sheet, toast stack, list reorder, page transitions, shared-element hero image, spinner, scroll progress, parallax, stagger-in lists.
---

# Motion (Framer Motion) — Motion Design Patterns

Motion is the default React animation library: MIT-licensed, tree-shakable, and driven by a hybrid
engine (Web Animations API + ScrollTimeline for hardware-accelerated 120fps, JS fallback for spring
physics / interruptible keyframes / gestures). Package is `motion`; import from `motion/react`
(`framer-motion` is the legacy name).

## Use When
- Animating React UI that is tied to **state or props** (toggles, tabs, modals, route changes).
- You need **layout** or **shared-element** transitions (expand card → modal, magic-move tab indicator,
  reorderable list, image → lightbox).
- You need **app-like gestures**: drag, tap, hover, pan, drag-to-reorder — that behave correctly on
  touch, mouse, and pen, and stay keyboard-accessible.
- You need **scroll-linked** motion (parallax, progress bar, reveal-on-scroll) that runs on the compositor.
- You need enter/exit animation for conditionally rendered components (`AnimatePresence`).
- You want 60/120fps animation without per-frame React re-renders (**motion values**).

## Don't Use / Reach Elsewhere When
- **Trivial, self-contained effect** (a hover color change, a simple fade) → use a **CSS transition**;
  don't add a JS dependency. Motion's own docs say so.
- **Vanilla / marketing site with intricate, runtime-mutable timelines**, or heavy SVG/canvas/WebGL
  sequencing → **GSAP** (mature imperative timeline you can mutate mid-playback). If MIT + smaller +
  hardware-accelerated matters and you don't need mid-playback mutation, use Motion's `animate([...])`
  sequence array instead.
- **No framework and you just need a native primitive** → **Web Animations API** (`element.animate`).
- Pure physics springs with a hooks-only API and no layout/gesture needs → **React Spring** is fine, but
  Motion covers this with `useSpring` / spring transitions and gives you layout + gestures too.

## Guardrails
- **Respect `prefers-reduced-motion` — non-negotiable.** Wrap the app in
  `<MotionConfig reducedMotion="user">` (auto-disables transform/layout motion, keeps opacity/color) and
  branch decorative/large motion with `useReducedMotion()`. Large-distance translate/scale and parallax
  trigger nausea for users with vestibular disorders; the reduced-motion fallback should be an **opacity
  crossfade or an instant state change**, never a smaller version of the same big move.
- **Never gate essential information behind motion.** If an animation is the *only* signal a state
  changed, users with reduced motion or assistive tech miss it — always provide a static/textual state.
- **Animate only compositor-friendly properties:** `opacity`, `transform` (`x`/`y`/`scale`/`rotate`),
  `filter`, `clipPath`. Never animate `width`/`height`/`top`/`left`/`margin` directly — use `x`/`scale`
  or the **`layout`** prop (converts a layout change into a scale-corrected transform).
- **Give `AnimatePresence` children a stable, unique `key`.** Missing/duplicate keys break exit tracking.
- **Preserve keyboard focus order.** Animated layout changes must not steal or scramble focus. Use
  `whileFocus` for focus feedback; never strip focus outlines without a replacement. `whileTap` fires on
  **Enter** for focusable elements, so it doubles as keyboard-activation feedback.
- **Don't blanket `will-change` in CSS.** Permanent layer promotion wastes GPU memory. Let the animation
  lifecycle manage it (Motion sets it during animation).
- **Import from `motion/react`.** If you see `from "framer-motion"` in older code it still works, but
  standardize on `motion`.
- **Keep UI feedback short** (~100–300ms). Provide a pause affordance for any motion running > 5s
  (WCAG 2.2.2).

## Spring vs Tween — pick fast
- **Spring** (`type: "spring"`, default for `x`/`y`/`scale`/`rotate`/layout): physical, momentum-aware,
  **interruptible without a jump**. Use for anything the user can interrupt or that should feel physical —
  drag release, toggles, drawers, hover, layout shifts. Tune with `bounce` (0 = no overshoot) +
  `visualDuration` (perceptual settle time), or `stiffness`/`damping`/`mass`.
- **Tween** (`type: "tween"`, `duration`, `ease`): deterministic, timeline-friendly. Use for precise
  choreography, page transitions coordinated with routing, and looping decoratives (spinners).
- **Inertia** (`type: "inertia"`): deceleration from velocity — the physics behind drag momentum.

## Default Flow
1. **Install & wrap:** `npm install motion`; wrap the app root in
   `<MotionConfig reducedMotion="user">` once.
2. **Pick the mechanism:**
   - State/prop-driven style change → `motion.*` with `animate` (+ `variants` for orchestration).
   - Mount/unmount → wrap in `<AnimatePresence>` and add `exit`.
   - Size/position change from reflow → add `layout`; cross-component move → `layoutId` (+ `LayoutGroup`).
   - Gesture → `whileHover` / `whileTap` / `drag` / `Reorder`.
   - Scroll → `whileInView` (trigger) or `useScroll` + `useTransform` (linked).
   - 60fps value not worth re-rendering → `useMotionValue` + `useTransform`.
3. **Choose spring vs tween** per the table above.
4. **Add the reduced-motion branch** for any transform/parallax/loop.
5. **Verify performance:** confirm you're animating transform/opacity only; check it holds under load.

## Recipes (copy-adapt)

**Setup — reduced-motion aware root**
```tsx
import { MotionConfig } from "motion/react"
// reducedMotion="user" auto-drops transform+layout motion, keeps opacity/color
export const App = ({ children }) => (
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
)
```

**Modal / dialog (enter+exit, backdrop, spring content)**
```tsx
import { AnimatePresence, motion } from "motion/react"

function Modal({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="backdrop" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", visualDuration: 0.25, bounce: 0.2 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

**Drawer / bottom sheet with drag-to-dismiss**
```tsx
<AnimatePresence>
  {open && (
    <motion.aside
      initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
      transition={{ type: "spring", bounce: 0 }}
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.4 }}
      onDragEnd={(e, info) => { if (info.offset.x > 120 || info.velocity.x > 500) onClose() }}
    />
  )}
</AnimatePresence>
```

**Toast / notification stack (auto-dismiss + reflow on removal)**
```tsx
<AnimatePresence mode="popLayout">
  {toasts.map((t) => (
    <motion.li
      key={t.id} layout
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ type: "spring", bounce: 0.25 }}
    >
      {t.message}
    </motion.li>
  ))}
</AnimatePresence>
// popLayout pops exiting items out of flow so the stack reflows smoothly.
```

**List reorder (drag) — Reorder component**
```tsx
import { Reorder } from "motion/react"
<Reorder.Group axis="y" values={items} onReorder={setItems}>
  {items.map((item) => (
    <Reorder.Item key={item.id} value={item} whileDrag={{ scale: 1.03 }}>
      {item.label}
    </Reorder.Item>
  ))}
</Reorder.Group>
```

**Stagger-in list (variant propagation)**
```tsx
const list = { visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } }
const row  = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }
<motion.ul variants={list} initial="hidden" animate="visible">
  {rows.map((r) => <motion.li key={r.id} variants={row}>{r.text}</motion.li>)}
</motion.ul>
```

**Page / route transition (wait for exit)**
```tsx
<AnimatePresence mode="wait" initial={false}>
  <motion.main
    key={routeKey}
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.2, ease: "easeInOut" }}
  >
    {page}
  </motion.main>
</AnimatePresence>
```

**Shared-element hero image → detail (magic move)**
```tsx
// Grid thumbnail and the detail view share a layoutId; Motion animates between them.
<motion.img layoutId={`photo-${id}`} src={src} />        {/* in the grid */}
<motion.img layoutId={`photo-${id}`} src={src} />        {/* in the opened detail/lightbox */}
// Wrap the switching region in <AnimatePresence> so mount/unmount is tracked.
```

**Loading spinner (tween loop, reduced-motion safe)**
```tsx
import { useReducedMotion, motion } from "motion/react"
function Spinner() {
  const reduce = useReducedMotion()
  if (reduce) return <div role="status" aria-label="Loading" className="pulse" /> // opacity pulse via CSS
  return (
    <motion.div role="status" aria-label="Loading"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: "linear", duration: 0.9 }}
    />
  )
}
```

**Scroll progress bar (hardware-accelerated)**
```tsx
import { motion, useScroll } from "motion/react"
function ProgressBar() {
  const { scrollYProgress } = useScroll()      // 0..1
  return <motion.div className="bar" style={{ scaleX: scrollYProgress, transformOrigin: "0%" }} />
}
```

**Parallax hero (scroll-linked, disabled under reduced motion)**
```tsx
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react"
function Parallax({ children }) {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, -120])
  return <motion.div style={{ y }}>{children}</motion.div>
}
```

**Reveal on scroll (trigger once)**
```tsx
<motion.section
  initial={{ opacity: 0, y: 24 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.4 }}
  transition={{ duration: 0.4 }}
/>
```

**Imperative sequence on an event (success/error choreography) — useAnimate**
```tsx
import { useAnimate } from "motion/react"
function Form() {
  const [scope, animate] = useAnimate()
  async function onError() {
    await animate(scope.current, { x: [0, -8, 8, -6, 6, 0] }, { duration: 0.4 }) // shake
  }
  return <form ref={scope} onSubmit={/* ... */}>...</form>
}
```

**Motion value + transform (no re-render reactive style)**
```tsx
import { motion, useMotionValue, useTransform } from "motion/react"
function DragOpacity() {
  const x = useMotionValue(0)
  const opacity = useTransform(x, [-150, 0, 150], [0, 1, 0]) // derived, no re-render
  return <motion.div drag="x" style={{ x, opacity }} />
}
```

## Quick reference — API map
- **Component:** `motion.div|button|...` with `initial`, `animate`, `exit`, `whileHover`, `whileTap`,
  `whileFocus`, `whileInView`, `whileDrag`, `variants`, `transition`, `layout`, `layoutId`, `style`.
- **Enter/exit:** `<AnimatePresence mode="sync|wait|popLayout" initial={false} onExitComplete>`.
- **Layout coordination:** `<LayoutGroup id>`, `layout | "position" | "size"`, `layoutId`.
- **Gestures:** `drag`, `dragConstraints`, `dragElastic`, `dragMomentum`, `dragTransition`,
  `dragSnapToOrigin`; `<Reorder.Group values onReorder>` / `<Reorder.Item value>`.
- **Scroll:** `useScroll({ target, container, offset })` → `scrollYProgress`; `useInView(ref, opts)`;
  `whileInView` + `viewport`.
- **Values:** `useMotionValue`, `useTransform`, `useSpring`, `useVelocity`, `useMotionTemplate`,
  `useMotionValueEvent`.
- **Imperative:** `useAnimate()` → `[scope, animate]` (+ sequence arrays with `at`);
  `useAnimationControls()` → `controls.start/stop`.
- **Orchestration:** parent variant `transition`: `staggerChildren`, `delayChildren`, `staggerDirection`,
  `when`; `stagger(dur, { from, startDelay })`.
- **A11y:** `<MotionConfig reducedMotion="user|always|never">`, `useReducedMotion()`.
- **Transition types:** `spring` (`stiffness`/`damping`/`mass` or `bounce`+`visualDuration`), `tween`
  (`duration`/`ease`/`repeat`/`repeatType`), `inertia`.
