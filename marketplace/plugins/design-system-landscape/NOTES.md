# NOTES — Design-System Landscape

## Why this skill exists
Coding familiars and CovenCave designers repeatedly face two questions this skill
answers: **"which design system do we reach for?"** and **"which patterns should
we borrow (and which should we refuse)?"** It is a *landscape + decision* skill,
deliberately **not** a build guide — the hands-on work lives in siblings. Its job
is to (a) classify any DS into the right tier so the decision is obvious, (b) give
the four load-bearing facts per system (license · frameworks · token architecture ·
a11y), and (c) encode the CovenCave house verdict so nobody re-litigates it per PR.

## What it deliberately does NOT cover (avoid overlap)
- **Hands-on shadcn/Radix building** (CLI, recipes, cva, compound components) →
  `shadcn-ui-and-radix`. Here we only place Radix/shadcn on the map and name it
  the OpenCoven default *substrate*.
- **Token implementation** (CSS-var scales, dark-mode wiring, arbitrary values) →
  `tailwind-design-tokens`. Here we only compare *token architectures* (Primer
  semantic naming, Ant Seed→Map→Alias, Material HCT roles, Carbon role tokens).
- **Motion** → `framer-motion-patterns`. We only note Material 3's motion physics
  as a directional trend.
- **A11y auditing** (WCAG 2.2 AA checklist) → `wcag-a11y-audit`. We compare a11y
  *posture* per DS; the audit procedure is the sibling.
- **Lit / web components** → `lit-ui-designer`. We mention `material-web` and
  Carbon web-components only as landscape points.
- **The house visual law** (dark-first, dense, purple, `--oc-*`, rituals) →
  `opencoven-design`. This skill *applies* that law to DS choices; it doesn't
  define it. If they conflict, `opencoven-design` wins.
- **Figma/Canva** asset work → their own plugins.

## Trade-offs & sharp edges
- **"Design system" is four different things.** The single biggest mistake is
  comparing a *platform language* (HIG) to an *installable kit* (Ant) as if
  they're the same choice. Always classify tier first.
- **Adoption metrics lie if read naively.** MUI's ~7.9M/wk and Ant's ~3.3M/wk
  npm include massive install bases + transitive deps; Primer/SLDS/Carbon
  *undercount* because first-party internal use never hits public npm the same
  way. shadcn has zero npm package yet the most GitHub stars — because it's a
  *distribution pattern*, not a library. `react-aria-components` (~3.3M/wk) is
  huge precisely because it's invisible infrastructure under HeroUI et al. Read
  numbers **directionally**, and always re-fetch (they drift weekly).
- **Take the system, never the skin.** It's tempting to `npm i antd` and ship —
  but the Ant/Material/IBM *look* violates `opencoven-design`. Borrow token
  grammar and a11y rigor; render bespoke.
- **The behavior layer commoditized; pick your substrate deliberately.** Radix
  (React), React Aria (React, deepest a11y), Ark UI/Zag (React+Vue+Solid) are the
  three real headless choices. shadcn now rides Radix *or* Base UI. Chakra v3 is
  really Ark/Zag + a styled layer.
- **Runtime CSS-in-JS is a cost, not free.** Base Web (Styletron), Fluent
  (Griffel), legacy Chakra v2/MUI (Emotion) impose runtime + RSC friction. The
  2025-2026 tide is CSS vars + Tailwind. Weigh lock-in.
- **Dynamic color is a trap for fixed brands.** Material You's generated palettes
  are brilliant for user-personalized OS surfaces and *actively harmful* to a
  brand with one controlled accent (CovenCave purple). Don't be seduced.
- **Ant's density and enterprise skin.** Ant is the most *complete* React kit and
  the most *wrong-looking* for a minimal/symbolic product. Mine its token
  *algorithm*; don't inherit its data-cram defaults.

## Stale-fact corrections verified this run (2026-07-01/02)
- **Shopify `polaris-react` GitHub repo is ARCHIVED** (archived=true, last push
  Jan 2026). Polaris lives on as first-party + docs; public React component dev
  stopped. Don't assume a live OSS cadence.
- **NextUI → HeroUI** (page title: "HeroUI v3 (Previously NextUI)"). Packages
  moved from `@nextui-org/react` (~63k/wk, winding down) to `@heroui/react`
  (~421k/wk).
- **Radix consolidated to a single `radix-ui` package** (away from
  `@radix-ui/react-*` scoped packages).
- **Chakra v3 is a rewrite on Ark UI + Zag.js** state machines (not the v2
  Emotion architecture).
- **Ant v6 (v6.5.0) ships first-class agent docs** — `for-agents`, `design.md`,
  `LLMs.txt`, an MCP server, and a CLI. Design systems are now packaging for
  coding agents; this skill pack is CovenCave's answer to that trend.

## When NOT to use this skill
- You're **already building** with a chosen stack → go straight to the build
  sibling (`shadcn-ui-and-radix` / `tailwind-design-tokens` / etc.).
- You need the **house visual rules** → `opencoven-design`.
- You need a **WCAG audit** → `wcag-a11y-audit`.
- The question is **"how do I theme dark mode / arbitrary values"** →
  `tailwind-design-tokens`.

## Verification notes
Every system's docs were HTTP-checked live (13× 200); token vocabularies quoted
(Primer `--fgColor-*`/`--bgColor-*-emphasis|muted`, Ant Seed→Map→Alias, Material
HCT/roles/3-contrast, Carbon `$text-primary`) came from the primary pages listed
in `sourceRefs`; all stars/downloads pulled from GitHub + npm APIs on
2026-07-01/02. Comparison blog posts were used only for framing (flagged as
untrusted external content), never as fact sources. Full evidence + adoption
tables + the CovenCave positioning matrix:
`research/synthesis/2026-07-01-design-system-landscape.md`.
