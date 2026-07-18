---
name: slidev-deck-pipeline
description: "Deterministic pipeline for authoring, verifying, exporting, and deploying OpenCoven Slidev decks (the weekly Show'n Spells system and one-off branded decks). Use whenever asked to build, rebuild, update, export, or publish a Slidev slide deck for OpenCoven — weekly meeting decks, launch decks, or explainer decks."
version: 1.0.0
author: Charm
license: MIT
tags: [Slidev, slides, deck, show-n-spells, open-coven-weekly, presentation, vercel, deterministic]
---

# Slidev Deck Pipeline

The single, repeatable path for turning content into a published OpenCoven Slidev deck.
Optimize for **determinism**: same inputs → same deck → same verified `dist` → same deploy.
Author by writing a real `.md` file with Node's `fs.writeFileSync`, then run the repo's own
scripts to verify and build. Never eyeball-ship.

## When to use

| Scenario | Use this skill |
|----------|----------------|
| Weekly Open Coven / Show'n Spells deck | ✅ (the canonical path) |
| One-off launch / explainer deck in the same house style | ✅ |
| Rebuilding an existing deck "the standard way" | ✅ |
| Exporting a deck to PDF | ✅ |
| Deploying a deck to Vercel (`show.opencoven.ai`) | ✅ |
| Non-Slidev copy (tweets, Discord posts) | ❌ use the voice/social skills instead |

## Repo facts (canonical)

- **Repo:** `/Users/buns/Documents/GitHub/OpenCoven/open-coven-weekly`
- **Decks:** `slides/YYYY-MM-DD.md` (a `-slug` suffix is allowed: `YYYY-MM-DD-slug.md`)
- **Template:** `slides/template.md`
- **Theme:** `theme/` = `@opencoven/slidev-theme-coven`; referenced from a deck as `theme: ../theme`
- **Static assets:** `slides/public/` → served at `/` (images live in `slides/public/img/`, referenced as `/img/<name>`)
- **Package manager:** `pnpm`
- **Deploy:** Vercel project `open-coven-weekly`, aliased to `show.opencoven.ai`, auto-deploys on push to `main`

### The scripts (this is the deterministic core — always use them)

| Command | What it does |
|---------|--------------|
| `pnpm new` (`node scripts/new-week.mjs`) | Scaffolds next Sunday's `slides/YYYY-MM-DD.md` from `template.md`, replacing `{{DATE}}` and `{{MONTH_DAY_YEAR}}` |
| `pnpm dev` | Live Slidev preview of the **latest dated deck** (auto-resolved) |
| `pnpm build` | Build with GitHub-Pages base `/open-coven-weekly/` |
| `pnpm build:vercel` | Build with root base `/` → publishes `slides/dist` (this is what Vercel runs) |
| `pnpm export` | Installs Chromium, exports the latest deck to PDF |
| `pnpm verify` | `pnpm test` + `verify-week` + both builds + `verify:dist` — the full gate |
| `pnpm verify:dist` | Confirms built `dist/index.html` contains the latest deck's frontmatter title |

**Deck resolution is automatic and deterministic** (`scripts/deck-utils.mjs`): the latest deck is the
one with the highest `YYYY-MM-DD`; on a date tie, the **shorter filename wins** (so a bare
`2026-07-15.md` beats a slugged `2026-07-15-draft.md`). To make a deck "the live one," give it the
latest date and the shortest name.

## The deterministic loop (follow in order)

1. **Gather content** — merged PRs (`gh pr list --state merged --limit 30`), releases
   (`gh release list`), and any Sage brief. Cluster into topics (one topic ≈ one slide).
2. **Scaffold** — `pnpm new` (or copy the newest deck as a starting idiom for a slugged one-off).
3. **Author the file with Node `fs.writeFileSync`** — NOT shell heredocs/echo (they truncate long
   content and mangle escapes). See `references/authoring.md`.
4. **Verify** — `pnpm verify` (or at minimum `node scripts/verify-week.mjs`). Fix every failure.
   The verifier enforces: no blank slides, a speaker note on every slide, required strings
   (`theme: ../theme`, `layout: cover`, `layout: default`, `discord.gg/opencoven`), a frontmatter
   `title:`, and the deck's date present in the body.
5. **Preview** — `pnpm dev`, spot-check every slide and every image renders in-browser.
6. **Commit & push** — `git add slides/YYYY-MM-DD.md slides/public/img/<new>` then
   `git commit -m "slides: add YYYY-MM-DD Show'n Spells deck"` and `git push origin main`.
   Vercel auto-deploys. Commit directly to `main` for weekly decks.
7. **Confirm live** — curl the production URL, assert HTTP 200 on `index` and every referenced image.

## House slide idiom (match it exactly)

Non-cover slide skeleton:

```md
---
layout: default
---

<div class="label">Section Label</div>

# Title with one *italic* word

<!-- Full presenter sentences, natural spoken tone.
Use <span class="cue">[stage direction]</span> for cues. -->
```

- **Cover:** either `layout: cover` with a `.sub` line (`Show'n Spells · <time> · discord.gg/opencoven`),
  or `layout: full` for an absolute-positioned full-bleed hero (see `references/full-bleed-hero.md`).
- **Theme classes:** `.label` (section kicker), `.card` + `.card-title` (grid cards),
  `.badge-shipped` (green, live/merged), `.badge-wip` (amber, in progress), `.cue` (speaker-note stage direction).
- **Reveals:** `v-click` on cards/list items for progressive reveal.
- **Every slide MUST have a `<!-- ... -->` speaker note.** No exceptions — the verifier rejects blanks.
- **Arc:** Cover → Agenda ("Tonight's Spells") → Shipped (one per cluster) → Live demo stop →
  Open-floor stops (2–3, scattered) → optional Architecture → Outro (Discord CTA + next-week teaser).

## Hard rules (learned the hard way — see references/gotchas.md)

- **Author with `fs.writeFileSync`**, never heredoc/echo for deck bodies.
- **Images:** put files in `slides/public/img/`, reference as `/img/<name>.jpg`. Full URLs must be
  `https://`. In-browser (`pnpm dev` / the live Vercel build) renders all images fine.
- **PDF export drops early background images** (Slidev export-timing bug): it reliably renders only
  the *last* image slides. For a perfect PDF, present from the live URL, or composite the PDF from
  high-res text-slide renders + the JPEGs at their exact page positions. Do NOT claim a clean PDF
  without opening it page-by-page.
- **Deploy target:** reuse the existing `open-coven-weekly` Vercel project. Do NOT spawn throwaway
  projects (`dist`, `coven-threads-explainer`, etc.). If you accidentally do, delete them.
- **"Standard format" means the house idiom above** — theme `../theme`, `.label`/`.card`, `v-click`,
  speaker notes, the standard arc. When Val says "rebuild the standard way," this is what she means.

## References

- `references/authoring.md` — the Node `fs.writeFileSync` authoring pattern + template vars
- `references/full-bleed-hero.md` — the absolute full-bleed image hero recipe (from the Cave party deck)
- `references/verify-deploy.md` — the exact verify → commit → deploy → confirm-live commands
- `references/gotchas.md` — PDF export bug, image auth, throwaway-project trap, heredoc trap
