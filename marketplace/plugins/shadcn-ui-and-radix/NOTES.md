# NOTES — shadcn/ui + Radix + Tailwind

## Why this skill exists
shadcn/ui is the dominant React component pattern for 2025–2026, and it's the
OpenCoven default stack for React work. Its "open code" model — the CLI **copies
source into your repo** instead of shipping a runtime package — is exactly what
makes it AI-friendly: coding familiars edit real, present source files rather
than guessing at a closed component API. This skill turns that stack into an
operational build guide with verified, current recipes.

## What it deliberately does NOT cover (avoid overlap)
- **Deep design-token theming / dark mode / arbitrary values** → `tailwind-design-tokens`.
  This skill only notes that shadcn components read semantic CSS variables
  (`--primary`, `--ring`, `--radius`, …) and dark mode flips them via `.dark`.
- **Rich motion / spring physics / layout animation** → `framer-motion-patterns`.
  Here we only use `tailwindcss-animate` enter/exit keyed on `data-[state=*]`.
- **Form UX depth** (progressive disclosure, validation timing, error copy) →
  `form-ux-patterns`. This skill covers only the shadcn `Form` *wiring*
  (react-hook-form + zod + Slot-based a11y).
- **Command palette / hotkey idioms** → `command-palette-keyboard-ux`. We note
  Combobox/CommandDialog are built on `cmdk` `Command`, no more.
- **Lit / web components** → `lit-ui-designer`. This skill is React-first.
- **House visual constraints** → `opencoven-design`. **Figma/Canva** assets →
  their own plugins.
- **Broad library survey** (Material 3 / Fluent 2 / Ant / Mantine internals) →
  `design-system-landscape`. Here we give only a *decision matrix* for choosing
  shadcn vs alternatives.

## Trade-offs & sharp edges
- **You own the maintenance.** No auto-upgrades: bug fixes and new features in
  upstream shadcn don't reach you unless you re-`add` (which overwrites) or diff
  manually. Ownership = control + responsibility.
- **Unstyled by default underneath.** Radix ships zero styling; if you strip the
  shadcn Tailwind classes you get bare behavior. That's the point, but it
  surprises people expecting a "themed" library.
- **Two moving substrates (2026).** shadcn now supports **Radix UI AND Base UI**
  backends, and Radix consolidated into a **single `radix-ui` package** (away
  from `@radix-ui/react-*`). Older tutorials/snippets use the scoped packages —
  match the project's existing imports; prefer unified `radix-ui` in new code.
- **`forwardRef` → function components.** Newer shadcn source dropped
  `React.forwardRef` for plain functions typed with `React.ComponentProps<...>`.
  Both work; don't "modernize" a file gratuitously mid-PR.
- **Compositions look like missing components.** No Radix "Combobox"; no
  monolithic "DataTable." Combobox = Popover + `Command`; DataTable = shadcn
  `Table` primitives + TanStack Table v8. Expect to assemble, not import.
- **cva version drift.** `cva@0.7` is the deployed stable line; `cva@1.0` is in
  beta with API tweaks. Check the installed version before using v1-only syntax.
- **tailwind-merge must know your tokens.** Custom Tailwind theme scales can
  confuse conflict resolution; extend `tailwind-merge` config if you use
  non-standard class groups, or overrides may not win.

## When NOT to use shadcn at all
- **Non-React** app → use the community port (shadcn-vue/svelte/solid) with the
  equivalent headless lib (Bits UI/Melt UI/Kobalte); the cva/Tailwind *pattern*
  carries over, the `radix-ui` package does not.
- **Team wants a shipped, themed package** (config over owning code) → HeroUI
  (Tailwind, on React Aria), Chakra v3, Mantine, MUI, or Ant.
- **Hardest headless a11y** (complex date pickers, tables, drag-drop, deep i18n)
  → React Aria Components (Adobe), then style it yourself.
- **Not using Tailwind** → shadcn assumes Tailwind; fighting that is not worth it.

## Verification notes (2026-07-01)
All source snippets in SKILL.md/synthesis were pulled **verbatim** from the live
`shadcn-ui/ui` repo (`apps/v4/registry/new-york-v4/{ui/button.tsx, ui/dialog.tsx,
lib/utils.ts}`) and cross-checked against `ui.shadcn.com/docs` and the Radix
Primitives docs. Two commonly-stale facts were corrected against primary sources:
(1) the **unified `radix-ui` package** import path, and (2) the **dual
Radix/Base UI** backends. Full evidence + source list:
`research/synthesis/2026-07-01-shadcn-ui-and-radix.md`.
