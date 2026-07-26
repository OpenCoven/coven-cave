# NOTES — empty-loading-error-states

## Why this skill exists
The single most common front-end review finding is **"you only built the happy path."** Teams design the
*ideal* state (data present, looks great in the mock) and discover the other states in production, from
users, as bug reports: a blank screen on slow networks, a first-run screen that looks broken, a raw stack
trace on a 500, a screen reader that says nothing when results load. This skill turns "design all the
states" from a nice principle into a **mechanical checklist** a coding familiar can run on any data-bound
component, with concrete thresholds (Nielsen's 0.1/1/10 s), concrete defaults (TanStack's documented
backoff), and concrete ARIA (SC 4.1.3 role mapping) — so the guidance is *actionable*, not vibes.

## Design decisions / stances
- **Five states, not three.** The classic "three states" (loading/empty/error) misses **partial**
  (pagination, infinite scroll, streaming — real content + trailing loader) and the **ideal/success**
  beat. We keep the memorable "three-states" name (matches the topic + how people search) but bake five
  into the flow, because partial-state bugs (double spinners, layout shift, page-level fallback blocking
  fast regions) are extremely common and rarely discussed.
- **Empty states are four different components, not one.** The most frequent empty-state bug is showing the
  first-run "Create your first project" CTA on a *no-results* search. We force a branch on *why* it's empty.
- **Backoff grounded in a real default, not folklore.** "Use exponential backoff" is everywhere but rarely
  quantified. We cite TanStack Query's *actual documented* default (retry 3, `min(1000*2^n, 30000)`, server
  0) as the concrete reference implementation and add **jitter** + **idempotency** guidance the library
  leaves to you.
- **Critical errors are not toasts.** This is a deliberate, opinionated line. Toasts auto-dismiss, don't
  take focus, and are missed — and auto-dismissing an important message can fail WCAG 2.2.3/2.2.4 (per the
  APG Alert pattern). Toasts are for the transient and recoverable only.
- **Accessibility is in the default flow, not an appendix.** SC 4.1.3 makes "Searching…/18 results/No
  results" announcements a **Level AA requirement**, and the spec literally uses those strings as examples.
  `role="status"` for status, `role="alert"` for errors, `aria-busy` for multi-part loads, plus focus
  management on *replace*. This is the part teams skip most and the part that's cheapest to get right if
  it's in the checklist from the start.

## Trade-offs & tensions
- **Spinner-flash delay vs perceived responsiveness.** Delaying the indicator ~200–500 ms avoids strobe on
  fast responses but risks a bare moment of "nothing" on medium ones. Tune per surface; optimistic UI
  sidesteps it entirely for writes.
- **Skeleton fidelity vs cost.** A skeleton shaped like the real content prevents layout shift but is more
  work to maintain as the layout changes. For small/uncertain regions a spinner is the pragmatic choice.
- **Assertive announcements vs annoyance.** `aria-live="assertive"`/`role="alert"` interrupts the screen
  reader — powerful for genuine errors, "extremely annoying" (MDN's words) if overused. Reserve it.
- **Optimistic UI vs correctness.** Optimistic writes feel instant but require a real rollback path and an
  error surface when the server rejects — more code, and wrong if you skip the rollback.

## When NOT to use this skill
- **Purely static/synchronous UI** with no async data (a marketing page, a settings toggle backed by local
  state) — there's no loading/empty/error to design. (Though even static forms want error states — see the
  `form-ux-patterns` skill.)
- **Deep form validation UX** — field-level timing, required/optional, password UX → use `form-ux-patterns`.
- **General WCAG audit** beyond state-change announcements → use `wcag-a11y-audit`.
- **Motion/animation design** of the transitions themselves (spring physics, layout animation) →
  `framer-motion-patterns`. This skill says *whether/when* to animate a state change (respect
  `prefers-reduced-motion`); it doesn't cover *how* to build the animation.
- **Component-library specifics** (which shadcn/Radix primitive to use) → `shadcn-ui-and-radix`. This skill
  is framework-agnostic; the React snippets are illustrative, and the discipline maps to Vue `<Suspense>` +
  `onErrorCaptured` and SvelteKit `+error.svelte` + `{#await}`.

## Relationship to existing marketplace plugins
- Complements, does not duplicate: `form-ux-patterns` (validation/error *inside forms*), `wcag-a11y-audit`
  (full audit; this is the state-change slice), `shadcn-ui-and-radix` (which primitives), `framer-motion-patterns`
  (how to animate). No overlap with `opencoven-design`, `lit-ui-designer`, `figma`, or `canva`.

## Verification notes (source fidelity)
- Every URL in SKILL.md / synthesis / plugin.json was fetched and confirmed reachable on 2026-07-01.
- **Dropped after 404:** `nngroup.com/articles/error-404/` and `web.dev/articles/optimistic-ui-patterns` —
  replaced with `useOptimistic` + TanStack optimistic-updates docs. NN/g itself now warns that AI tools
  hallucinate NN/g article slugs, which is exactly why each URL was checked rather than assumed.
- **No tweet citations.** The PLAN suggested citing individual designer posts for bad-UX examples; those
  were excluded as unverifiable at write time (per the "no fabricated citations" rule). The anti-pattern
  list is grounded in the durable NN/g + WCAG + APG guidance instead.
- Error boundaries remain class-only in core React (`getDerivedStateFromError` + `componentDidCatch`);
  `react-error-boundary` is the ergonomic wrapper and its own docs use `role="alert"` — reflected verbatim.
