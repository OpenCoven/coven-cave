# NOTES — tailwind-design-tokens

The "why this exists / trade-offs / when NOT to use" appendix. Read alongside `SKILL.md` and `research/synthesis/2026-07-01-tailwind-design-tokens.md`.

## Why this skill exists
Tailwind CSS v4 (shipped 2025-01-22) fundamentally moved theming from JavaScript (`tailwind.config.js`) into CSS (`@theme`). A lot of institutional knowledge — including most blog posts and half of Stack Overflow — is still v3-shaped. Coding familiars kept reaching for `theme.extend` and `content` arrays that no longer apply. This skill encodes the **v4 CSS-first mental model** plus the **two-tier token discipline** (primitive → semantic) that keeps UIs re-themeable, and the shadcn/ui bridge (`@theme inline`) that is now the dominant React recipe.

It deliberately complements, not duplicates:
- **`opencoven-design`** — that's house brand constraints (`--oc-*`, dark/dense/symbolic). This skill is the *generic Tailwind theming mechanism*; when working on OpenCoven surfaces, `opencoven-design` + `DESIGN.md` win on conflicts.
- **`lit-ui-designer`** — Lit component work. This is CSS-token layer, framework-agnostic.
- **`figma` / `canva`** — design-source and asset tools, not code theming.

## Key trade-offs & decisions

### Primitive vs semantic — why two tiers, not one
Single-tier (components use `bg-blue-500` directly) is faster to write but **impossible to retheme** — dark mode or a brand swap means editing every component. Two-tier costs an indirection (`--primary` → `--color-primary` → `bg-primary`) but retheming becomes a single `:root`/`.dark` edit. For anything with dark mode or >1 brand, two tiers is non-negotiable. For a throwaway prototype with no theming, single tier is fine.

### Why `@theme inline` for semantics (subtle but load-bearing)
Plain `@theme { --color-primary: var(--primary); }` makes the *utility* reference the theme variable, and CSS resolves `var()` at the point of definition — which can grab the wrong value when `--primary` is overridden deeper in the tree (`.dark`). `@theme inline` inlines the value into the utility rule, so `.dark { --primary: … }` actually wins. This is exactly why shadcn uses `@theme inline` for its color bridge. Getting this wrong produces "dark mode partially works" bugs that are maddening to debug.

### OKLCH over hex/HSL
OKLCH's perceptually-uniform `L` makes color scales and contrast predictable; HSL lightness lies (yellow at 50% L looks far brighter than blue at 50% L). Cost: OKLCH is less human-memorable and needs a converter (oklch.com) for legacy colors. Browser support is now broad (all evergreens); for truly ancient targets you'd need sRGB fallbacks via `@supports`, which is rarely worth it in 2026. v4's own default palette is OKLCH, so you're swimming with the current.

### Class vs media vs data-theme dark mode
- **media** — zero JS, but user can't override the OS. Fine for content sites.
- **class** — the standard for an app with a toggle. One extra `@custom-variant` line + a tiny script.
- **data-theme** — the only clean path to **>2 themes** (light/dark/midnight/high-contrast). Slightly more verbose.
Do **not** ship media + class simultaneously by accident — you get double-applied dark styles.

### The JIT static-string constraint
This is the single most common Tailwind support question and it never fully goes away. The engine is a text scanner, not a JS evaluator. The hierarchy of fixes (var-arbitrary > lookup map > `@source inline` > server-gen > inline style) is ordered by bundle-cleanliness. `@source inline` is a real tool but every entry is CSS you ship whether used or not; treat it like a `// eslint-disable` — justified, localized, commented.

## When NOT to use this skill
- **Non-Tailwind projects.** Vanilla CSS custom properties, CSS Modules-only, styled-components, Panda CSS, vanilla-extract — the token *philosophy* transfers but the `@theme`/`@custom-variant` mechanics do not.
- **Tailwind v3 projects that won't migrate.** v3 theming lives in `tailwind.config.js` (`theme.extend`, `darkMode: 'class'`, `safelist`). This skill's directives (`@theme`, `@theme inline`, `@source inline`, `@custom-variant`) are v4-only. Use the upgrade guide first, or stay on v3 docs.
- **OpenCoven-branded surfaces** — start from `opencoven-design` + `DESIGN.md`; use this only for the underlying Tailwind mechanics, and defer to house tokens on any conflict.
- **Pure design-handoff / asset tasks** — that's `figma`/`canva`.

## Framework-agnosticism note
Everything except the dark-mode toggle glue (JS) and shadcn's `components.json` is plain CSS + class strings, so it works in React, Vue, Svelte, Astro, and static HTML. Vue/Svelte have one extra rule: `@reference "app.css";` at the top of a scoped `<style>` (or CSS module) before any `@apply`/`@variant`, or those directives fail silently.

## Verification checklist (for code review)
1. No hex literals or raw primitive color utilities inside components (grep `bg-\[#`, `text-zinc-`, etc.).
2. Semantic layer uses `@theme inline`, not plain `@theme`.
3. Retheme test: editing only `:root`/`.dark` restyles the whole app.
4. Colors are OKLCH.
5. Dark toggle is inline in `<head>` (no FOUC); exactly one dark strategy in play.
6. Any interpolated/dynamic class is handled by var-arbitrary, lookup map, or a commented `@source inline`.
7. v4 project has no live `tailwind.config.js` doing theme work (except a documented `@config` migration bridge).

## Open follow-ups / watch list
- W3C DTCG format module is still a **draft** (2025.10, "do not implement / do not cite as authoritative"). Track for when it stabilizes — a `.tokens.json` → `@theme` build step could become standard tooling (Style Dictionary already targets this shape).
- Watch Tailwind minor releases for `@source inline` syntax changes (landed ~v4.1) and any new namespaces.
- shadcn `base-*` styles and `baseColor` set (Neutral/Stone/Zinc/Mauve/Olive/Mist/Taupe) evolve; re-verify the default scaffold when a project pins a newer shadcn.
