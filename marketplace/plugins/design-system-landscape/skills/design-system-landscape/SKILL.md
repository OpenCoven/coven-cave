---
name: design-system-landscape
description: Use when choosing, comparing, or borrowing from an existing design system rather than building components from scratch: a map + decision guide covering Material 3, Fluent 2, Apple HIG, GitHub Primer, IBM Carbon, Ant Design, Chakra UI v3, Mantine, HeroUI (ex-NextUI), Radix + shadcn/ui, and Adobe Spectrum / React Aria (plus SLDS, Atlassian, Polaris, Base Web). Classifies each into four tiers (platform language you conform to / product DS / installable community kit / headless own-code substrate) and states its license, framework support, token architecture, and a11y posture, with a "reach for which DS when" flow and live adoption signals (npm/stars; Polaris repo archived; NextUI to HeroUI; Ant agent docs). Encodes the CovenCave matrix: borrow semantic-first tokens (Primer), a11y discipline (Carbon), and the ownership model (Radix/shadcn); avoid Material dynamic color, Ant density, light-mode-first defaults, and vendor skins. Hands-on building belongs to sibling skills.
---

# Design-System Landscape (2025–2026)

## Use When
- Someone asks **"which UI library / design system should we use?"** or "how does X compare to Y?"
- You're about to **borrow a pattern** (token naming, theming model, a11y approach) from an established DS.
- You need to know a DS's **license, framework support, token architecture, or a11y posture** before adopting.
- You must **map a request onto the OpenCoven house style** and decide adopt / study-only / reject.
- You're deciding whether to **install a styled kit** vs **own component source** (shadcn) vs **conform to a platform language** (HIG/Material/Fluent).

## Guardrails
- **Classify the tier first.** (A) *Platform language* you conform to on its native OS (Apple HIG, Material 3, Fluent 2) — never adopt as a web *skin*; (B) *product DS* (Primer/Carbon/SLDS/Atlassian/Polaris/Spectrum/Base Web) — usually *study*, rarely wholesale adopt; (C) *installable community kit* (Ant/MUI/Mantine/Chakra v3/HeroUI) — `npm i` + theme; (D) *headless own-code* (Radix+shadcn/ui, React Aria, Ark/Zag) — compose + own source. The tier dictates the whole decision.
- **For OpenCoven work, default to Tier D (Radix + shadcn/ui).** Owning source is the only way to enforce the house style (dark-first, dense, minimal, symbolic, controlled purple, `--oc-*` tokens). See `shadcn-ui-and-radix` for the build, `opencoven-design` for the visual law.
- **Take the *system*, never the *skin*.** You may borrow Primer's token *grammar*, Carbon's a11y *rigor*, Ant's token *algorithm* — but never ship the GitHub/IBM/Ant *look*. `opencoven-design` forbids vendor skins, light-mode-primary, dynamic/generated color, gradients, glass/blur, and blue/green/red as brand accents.
- **Semantic-first tokens always.** Name color by intent (`accent`/`danger`/`muted` + `-emphasis`/`-subtle`), not by hue (Primer/Carbon/Atlassian model). Feed implementation to `tailwind-design-tokens`.
- **Prefer CSS variables over runtime CSS-in-JS.** The 2025–2026 trend is away from Emotion/Styletron/Griffel toward CSS vars + Tailwind (RSC + perf). Weigh CIS lock-in as a cost.
- **Escalate hard a11y to React Aria Components** (date pickers, complex tables, drag-drop, i18n/RTL) — deeper than Radix.
- **Verify adoption claims against live APIs** (`api.npmjs.org` downloads, GitHub stars) before quoting numbers — they drift. Note stale facts: **Polaris `polaris-react` repo is archived**; **NextUI renamed to HeroUI**; **Radix consolidated to a single `radix-ui` package**; **Chakra v3 rebuilt on Ark UI/Zag.js**; **Ant v6 ships agent docs (`design.md`/`LLMs.txt`/MCP)**.
- **This skill decides; siblings build.** Do not re-implement shadcn/Radix recipes, token code, motion, or a11y audits here — hand off.

## Default Flow
1. **Classify the target.** Is this a platform language (A), product DS (B), community kit (C), or headless substrate (D)? Native app on iOS/macOS/Android/Windows → conform to A. Web product → almost always C or D.
2. **State the four facts** for each candidate: **license · framework support · token architecture · a11y posture.** (Use the profiles below.)
3. **Apply the ownership question.** Need to enforce a bespoke house look and let AI familiars edit source? → **Tier D: Radix + shadcn/ui** (OpenCoven default). Need to ship a dashboard fast and accept a skin? → **Mantine** (lean) or **Ant** (max breadth). Need Tailwind + a11y with a nice default look? → **HeroUI** (on React Aria). Non-React? → **Ark UI/Zag** (React+Vue+Solid) or shadcn ports.
4. **Borrow the right patterns** (see matrix): semantic tokens ← Primer; a11y discipline + multi-theme dark tokens ← Carbon; ownership/headless ← Radix/shadcn; token-derivation algorithm ← Ant/Material; three token tiers ← everyone.
5. **Reject the wrong patterns**: dynamic/generated color (Material You), Ant density + enterprise skin, light-mode-first defaults, vendor skins, CIS lock-in, non-purple brand accents, glass/gradients.
6. **Cross-check the house law.** Run the choice past `opencoven-design`; if it implies light-primary, a vendor skin, or generated color, stop.
7. **Hand off to builders.** Build → `shadcn-ui-and-radix`; tokens → `tailwind-design-tokens`; motion → `framer-motion-patterns`; a11y audit → `wcag-a11y-audit`; Lit → `lit-ui-designer`.

## Tier Cheat-Sheet (reach for which)
- **Enforce bespoke dark/purple house style, AI-editable source** → **Radix + shadcn/ui** (Tier D) ← *OpenCoven default*
- **Hardest a11y (date pickers, tables, i18n/RTL, drag-drop)** → **React Aria Components** (Adobe; ~3.3M/wk)
- **Ship a dashboard fast, batteries-included, restrained look** → **Mantine** (React; CSS vars)
- **Max component breadth (tables/forms/pickers), accept a skin, study the token algorithm** → **Ant Design** (v6; Seed→Map→Alias)
- **Tailwind-native styled kit with real a11y underneath** → **HeroUI** (ex-NextUI, on React Aria)
- **Multi-framework headless (React+Vue+Solid)** → **Ark UI / Zag.js** (Chakra v3's substrate)
- **Native iOS/macOS** → **Apple HIG** + SwiftUI (semantic system colors, Dynamic Type)
- **Native Android / cross-platform Google** → **Material 3** (Compose; MUI on web) — *but reject dynamic color for fixed brands*
- **Windows / Office / Teams** → **Fluent 2** (`@fluentui/react-components`)
- **Enterprise a11y + dark themes reference to imitate** → **IBM Carbon** (Apache-2.0; `$text-primary` role tokens)
- **Semantic-token grammar reference to imitate** → **GitHub Primer** (`--fgColor-*`, `--bgColor-*-emphasis/muted`)
- **Study-only / cautionary**: SLDS (BEM+utility, Salesforce-coupled), Atlassian (per-component pkg sprawl), Polaris (repo archived Jan 2026), Base Web (Overrides API; slowing).

## Compressed profiles (license · frameworks · tokens · a11y)
- **Material 3 / You** — Apache-2.0 (libs) / MIT (MUI) · Android(Compose), web(MUI/material-web Lit), Flutter · ref→sys→comp, HCT color roles, dynamic color, motion physics · strong contrast (3 levels). *Reject dynamic color for CovenCave.*
- **Fluent 2** — MIT · React(v9), WinUI, web components · global→alias→control, Griffel atomic CIS, theme objects · strong (Windows HCM). Enterprise-skewed.
- **Apple HIG** — proprietary (conform) · SwiftUI/UIKit/AppKit · semantic system colors + Dynamic Type · best-in-class (VoiceOver/Dynamic Type/Reduce Motion). Native only.
- **GitHub Primer** — MIT · React/CSS/Rails · **semantic-first CSS vars** (`--fgColor-accent`, `--bgColor-danger-muted`, state tokens) · strong. *Closest philosophical match — study #1.*
- **Salesforce SLDS** — BSD-3/permissive · CSS(BEM+utility) + LWC · design tokens + styling hooks (`--slds-c-*`) · strong (508). Salesforce-coupled.
- **Atlassian** — Apache-2.0 · React (`@atlaskit/*`) · semantic dot-namespaced tokens (`color.text`, `elevation.surface`) + dark · strong. Package sprawl.
- **Shopify Polaris** — MIT · React · semantic commerce tokens (`--p-color-*`) · strong. **`polaris-react` repo archived (Jan 2026).**
- **IBM Carbon** — Apache-2.0 · React/WebComponents/Angular · role tokens (`$text-primary`, `$support-error`) × 4 themes (incl. true-dark Gray 90/100) · **best a11y rigor + charts**. *Study #2.*
- **Ant Design** — MIT · React (Vue/Angular ports) · **Seed→Map→Alias + preset algorithms** (default/dark/compact) + component tokens; ships agent docs · a11y improving (not top). *Study the algorithm; reject the density + skin.*
- **Chakra UI v3** — MIT · React (on Ark/Zag) · tokens + recipes + snippets · good (state-machine ARIA). v2→v3 churn.
- **Mantine** — MIT · React · CSS-vars theme + 100+ comps/50+ hooks · good. React-only, batteries-included.
- **HeroUI (ex-NextUI)** — MIT · React · Tailwind (`tailwind-variants`) on **React Aria** · strong (inherits React Aria). Rebrand churn.
- **Radix + shadcn/ui** — MIT · React (unified `radix-ui`; shadcn also supports Base UI) · unstyled behavior + your Tailwind/tokens · excellent. *Study #3 / OpenCoven default (see `shadcn-ui-and-radix`).*
- **Base Web (Uber)** — MIT · React (Styletron) · token theme + **Overrides API** · solid. Slowing; CIS lock-in.
- **Adobe Spectrum / React Aria** — Apache-2.0 · React · Spectrum tokens; **React Aria (~3.3M/wk)** behavior layer · **best-in-class a11y + i18n/RTL**. *A11y escalation target.*

See NOTES.md for trade-offs and when NOT to use, and the full synthesis with adoption tables and the CovenCave positioning matrix at
`research/synthesis/2026-07-01-design-system-landscape.md`.
