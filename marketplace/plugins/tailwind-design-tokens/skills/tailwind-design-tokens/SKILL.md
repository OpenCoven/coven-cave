---
name: tailwind-design-tokens
description: Use when building or theming a Tailwind CSS v4 (or migrating a v3) UI with design tokens, dark mode, or multi-theme support — covers the CSS-first `@theme` model, OKLCH color scales, the two-tier primitive/semantic token architecture (shadcn `background`/`foreground` pairs bridged with `@theme inline`), class vs media vs `data-theme` dark mode with FOUC-safe toggling, arbitrary values, `@source inline` safelisting, and v3→v4 migration; framework-agnostic (React/Vue/Svelte/Astro/HTML) with shadcn-specific glue called out.
---

# Tailwind Design Tokens, Dark Mode & Theming (v4)

## Use When
- Setting up or restructuring a Tailwind **v4** project's token layer (colors, spacing, type, radii, shadows, motion).
- Adding **dark mode** or **multiple themes** (brand, high-contrast) to a Tailwind app.
- Working in a **shadcn/ui** codebase and touching `--background`, `--primary`, `--ring`, `.dark`, or `components.json`.
- A dynamic class (`bg-${x}-500`) "isn't generating" and you need the correct fix.
- **Migrating v3 → v4**: `tailwind.config.js` → `@theme`, `content` → auto-detection, `safelist` → `@source inline`.
- Authoring or converting a color palette to **OKLCH**.

## Guardrails
- **Components use semantic utilities, never raw primitives or hex.** Write `bg-card text-muted-foreground`, not `bg-zinc-900` or `bg-[#18181b]`. Retheming must be possible by editing only the `:root`/`.dark` token block.
- **`@theme` maps tokens to utilities; `:root` does not.** Use `@theme` when you want `bg-*`/`text-*` to appear; use plain `:root` for variables that shouldn't spawn utilities.
- **Semantic tokens must be bridged with `@theme inline`** (`--color-primary: var(--primary)`), not plain `@theme`, or CSS-variable resolution can pick the wrong value.
- **Author colors in OKLCH** (`oklch(L C H)`), not hex/HSL. Build scales by holding H/C and stepping L. Convert at oklch.com.
- **JIT scans complete static strings only** — never interpolate class names. Prefer `bg-[var(--x)]` or a lookup map; use `@source inline(...)` sparingly (it bloats the bundle) and remember it takes no regex.
- **Dark toggle runs inline in `<head>`** to avoid FOUC. Never let the theme class get set after first paint.
- **Vue/Svelte scoped `<style>` and CSS modules** need `@reference "app.css";` before any `@apply`/`@variant`.
- **Don't reintroduce `tailwind.config.js`** in a v4 project unless bridging a legacy config via `@config` during migration.
- **Don't fabricate directives.** The real set is in the reference table below; if unsure, check the docs, don't guess.

## Default Flow

1. **Confirm version & entry.** v4? Expect `@import "tailwindcss";` (not `@tailwind` directives) and no `content` array. If you see `tailwind.config.js` doing theme work, you're mid-migration — plan the move to `@theme`.

2. **Lay the two tiers.**
   - **Primitives** in `@theme` (OKLCH scales, base `--spacing`, `--radius-*`, `--shadow-*`, `--ease-*`, `--animate-*`). These generate `bg-*`, `rounded-*`, etc.
   - **Semantics** as plain vars under `:root`, overridden under `.dark`, then bridged:
     ```css
     :root   { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0); --radius: 0.625rem; }
     .dark   { --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0); }
     @theme inline {
       --color-background: var(--background);
       --color-foreground: var(--foreground);
       --color-primary: var(--primary);
       --color-primary-foreground: var(--primary-foreground);
       --radius-lg: var(--radius);
       --radius-md: calc(var(--radius) * 0.8);
       --radius-sm: calc(var(--radius) * 0.6);
     }
     ```
   Adopt shadcn's **`X` / `X-foreground` surface/text pairing** even outside shadcn.

3. **Wire dark mode** (pick one):
   - Simple toggle → **class**: `@custom-variant dark (&:where(.dark, .dark *));`
   - System-only → **media** (default, no config).
   - >2 themes → **data attribute**: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` and one `@custom-variant` per extra theme.
   Add the FOUC-safe `<head>` script (toggles `.dark` from `localStorage.theme` / `matchMedia`).

4. **Add a semantic token** (three steps): declare under `:root` + `.dark`, then bridge in `@theme inline` (`--color-warning: var(--warning)`). Now `bg-warning`/`text-warning-foreground` exist.

5. **Handle dynamic classes.** Static full strings only. If a value is runtime-dynamic → `bg-[var(--x)]`. If it's a known finite set → lookup map of full class names. Last resort → `@source inline("{sm:,md:,}grid-cols-{1..12}")`, exact strings only.

6. **Custom CSS interop.** `@apply` to reuse utilities in third-party overrides; `@utility name { }` for a real custom utility that supports variants; `--alpha(var(--color-x) / 50%)` and `--spacing(4)` in hand-written CSS.

7. **Share/scale.** For multi-app or brand systems, extract tokens to a shared `theme.css` and `@import` it (publishable to NPM).

8. **Verify.** Retheme test: change only `:root`/`.dark` and confirm the whole UI shifts. Grep for stray hex / raw primitives in components. Confirm dark toggle has no FOUC.

## v4 Directive & Function Reference
- `@import "tailwindcss";` — entry + import bundling.
- `@theme { }` — tokens → CSS vars **and** utilities (namespace = utility family).
- `@theme inline { }` — utility inlines the value (use for the semantic layer / var-references).
- `@theme static { }` — emit all vars, not just used.
- `@source "path";` — add missed source files; `@source inline("…");` — safelist (brace expansion, no regex).
- `@utility name { }` — custom utility (variant-aware). `@variant dark { }` — apply a variant in CSS.
- `@custom-variant name (&:where(...));` — define dark / theme variants.
- `@apply …;` — inline utilities into custom CSS. `@reference "app.css";` — enable `@apply`/`@variant` in Vue/Svelte `<style>` & CSS modules.
- `--alpha(color / n%)`, `--spacing(n)` — build-time helpers.

## Token Namespaces (what generates what)
`--color-*`→bg/text/border/fill · `--font-*`→font-family · `--text-*`→font-size · `--font-weight-*` · `--tracking-*`→letter-spacing · `--leading-*`→line-height · `--spacing`/`--spacing-*`→padding/margin/size · `--radius-*`→rounded · `--shadow-*`/`--inset-shadow-*`/`--drop-shadow-*` · `--blur-*` · `--aspect-*` · `--breakpoint-*`→responsive variants · `--container-*`→container queries · `--ease-*` · `--animate-*` (keyframes can live in `@theme`).

## Anti-patterns
- Hard-coding hex in components; using primitive utilities where semantic ones belong.
- Interpolating class names (`bg-${c}-500`) and expecting output.
- Plain `@theme` (not `inline`) for the semantic var-reference layer.
- Dark toggle applied after paint (FOUC); shipping both class and media strategies unintentionally.
- Rebuilding `tailwind.config.js` for theming in a v4 project.
- Overstuffing `@source inline` as a crutch for every dynamic class.

## Sources
Tailwind v4 docs: theme (/docs/theme), dark-mode (/docs/dark-mode), functions-and-directives, detecting-classes-in-source-files, upgrade-guide; v4.0 announcement (/blog/tailwindcss-v4). shadcn/ui theming (ui.shadcn.com/docs/theming). OKLCH tool (oklch.com). W3C Design Tokens Community Group format module — draft, vocabulary only (designtokens.org). See companion NOTES.md and the synthesis doc for full URLs and trade-offs.
