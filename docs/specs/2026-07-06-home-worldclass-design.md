# Home — World-Class Visual Pass Design

**Date:** 2026-07-06
**Surface:** workspace `mode: "home"` → `src/components/home-composer.tsx` + `src/components/home/*` + `src/styles/home-composer.css`
**Goal:** Give the cold-start surface a distinctive, intentional visual identity — hierarchy, warmth, and one memorable signature — without touching the composer's heavily-pinned functional skeleton (destination pills, slash menus, attachments, project/agent pickers, centering math).

## Constraints honored

The home composer carries dense source-regex contracts (`home-composer.test.ts`,
`home-composer-polish.test.ts`, `home-composer-centering.test.ts`,
`home-columns.test.ts`, `home-composer-mobile-gaps.test.ts`). This pass keeps:

- The `.cave-composer-panel` shared chrome and full footer structure.
- The viewport-centering transform/clamp math and the `min(1200px, 100%)` caps.
- The Continue/News two-column footer contracts (resume-first, opt-out news,
  no marquee) and the `home-col-card--primary` treatment.
- The headline copy — "What should we build in {project}?" — now split so the
  project name renders in its own accent-tinted span (test updated to match).

## What changed

1. **Presence eyebrow.** A JetBrains-Mono uppercase greeting ("Good morning" /
   "Good afternoon" / "Good evening" / "Deep night in the cave") with a glowing
   accent dot sits above the headline. The greeting derives from the pure
   `src/lib/home-greeting.ts` (`greetingForHour`) and is sampled **after mount**
   so SSR markup stays deterministic — it fades in via `.is-ready`, with a
   reserved `min-height` so the headline never shifts. The mono eyebrow against
   the Fredoka display face is the surface's deliberate type pairing.

2. **Accent-tinted project name.** The headline's project name renders in a
   `home-composer-headline-project` span mixed toward `--accent-presence` —
   presence lives in the name of the place you're working.

3. **Hearth glow (the signature).** `.home-halo` — a soft radial lavender aura
   behind the composer card, breathing on a 9s scale loop and brightening while
   the composer holds focus. It's the "accent is presence" rule made ambient:
   the cave reads lit because a familiar is home. Static under
   `prefers-reduced-motion: reduce`; damped opacity in light mode.

4. **Structure-as-information pills.** Suggested prompts that resume real board
   tasks (`task:` ids) show a kanban icon in the presence tint; curated
   starters keep the sparkle. Hover states lift toward the accent.

5. **Resume affordance.** The newest session's Continue card gets a
   presence-tinted fill plus an always-visible "Resume →" chip (no hover-only
   reveal, so it reads on touch). The arrow nudges on hover, motion-gated.

6. **Page-load choreography.** One orchestrated entrance: hero → composer →
   pills → columns rise in a 460ms staggered sequence (`home-rise`,
   `backwards` fill), fully collapsed under reduced motion.

7. **Rhythm + empty states.** Cards move to `--radius-card`, column gap 24px,
   and the Continue empty state becomes a centered dashed invitation card.

## Verification

- `pnpm test:app` (543 files) green; new `src/lib/home-greeting.test.ts` wired
  into `scripts/run-tests.mjs`.
- `pnpm typecheck` clean; `pnpm build` within bundle budget.
- Playwright screenshots (prod server, demo mode + mocked
  `/api/sessions/list` & `/api/rss`): dark 1600×1000, light 1600×1000,
  mobile 390×844, focus state; console clean of hydration errors.
