# Gotchas (each of these has bitten a real ship)

## 1. Heredoc/echo truncates deck bodies
Slidev decks are long and HTML-heavy. Shell heredocs and `echo`/`printf` truncate and mangle
`<`, `>`, backticks, quotes. **Always author with Node `fs.writeFileSync`** (see authoring.md).

## 2. PDF export drops early background images
Slidev's PDF exporter has an export-timing bug: it reliably renders only the *last* image slides,
dropping earlier full-bleed backgrounds.
- The live Slidev build (`pnpm dev` and the deployed Vercel URL) renders ALL images correctly —
  the bug is export-only.
- For a clean handout PDF: present from the live URL, OR composite the PDF from high-res
  text-slide renders + the JPEGs placed at their exact page positions.
- NEVER declare a PDF clean without opening it and checking every page.

## 3. Bare-domain links don't render
Image/link URLs must be full `https://`. Bare `show.opencoven.ai` won't unfurl or load.

## 4. Throwaway Vercel projects
Deploy to the EXISTING `open-coven-weekly` project (aliased to show.opencoven.ai). Do not create
new projects (`dist`, `coven-threads-explainer`, …) while wrangling a deploy. If some appear by
accident, delete them so the dashboard stays clean.

## 5. "Standard format" = the house idiom
When Val says "use the standard format" / "rebuild the standard way," she means: `theme: ../theme`,
`.label`/`.card`/`.card-title`, `v-click` reveals, full speaker notes, the standard deck arc, and the
project's own `pnpm build:vercel` pipeline. Do NOT invent a new layout or a standalone deck.

## 6. Latest-deck resolution
The published deck is auto-selected: highest `YYYY-MM-DD`, and on a tie the SHORTER filename wins.
To make a deck live, give it the latest date and the shortest name (bare `YYYY-MM-DD.md`).

## 7. Verify before you claim
Run `pnpm verify` (or `verify-week`) and curl the live URL for 200s + correct title before telling
Val it's done. Structure passing ≠ content correct — spot-check slides and images in the browser.
