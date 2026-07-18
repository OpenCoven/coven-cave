# Verify → deploy → confirm-live

Deterministic tail of the pipeline. Run from the repo root.

## 1. Verify (the gate)

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/open-coven-weekly
pnpm install            # once, or when deps changed
pnpm verify             # test + verify-week + build + build:vercel + verify:dist
```

Or the minimum content check without the full build:

```bash
node scripts/verify-week.mjs
```

`verify-week` enforces, on the **latest dated deck**:
- No blank slide separators, no blank slide bodies.
- A `<!-- ... -->` speaker note on every slide.
- Required strings present: `theme: ../theme`, `layout: cover`, `layout: default`, `discord.gg/opencoven`.
- A frontmatter `title:` line.
- The deck date (`YYYY-MM-DD` or the long form) somewhere in the body.
- The `ApiExplorer.vue` endpoints/errors are intact (theme integrity).

Fix every failure before proceeding. Do not "manually decide" a failure is a false positive
unless you have read `verify-week.mjs` and confirmed exactly why.

## 2. Local preview

```bash
pnpm dev    # opens the latest deck; arrow-key through every slide, confirm each image renders
```

## 3. Commit & push (triggers Vercel deploy)

```bash
git add slides/YYYY-MM-DD.md slides/public/img/<any-new-images>
git commit -m "slides: add YYYY-MM-DD Show'n Spells deck"
git push origin main
```

Commit directly to `main` for weekly decks. For a rebuild:
`git commit -m "slides: rebuild YYYY-MM-DD deck — <brief reason>"`.

## 4. Confirm live

Vercel auto-deploys `open-coven-weekly` → `show.opencoven.ai`. After the deploy finishes:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://show.opencoven.ai/          # expect 200
curl -s https://show.opencoven.ai/ | grep -o "<title>[^<]*</title>"          # confirms latest deck title
for img in /img/threads-showspells.jpg /img/party-poster.jpg; do
  echo -n "$img "; curl -s -o /dev/null -w "%{http_code}\n" "https://show.opencoven.ai$img"
done
```

All 200s + the right title = shipped. Since it's the live Slidev build, every image renders in-browser.

## PDF export (optional)

```bash
pnpm export     # installs Chromium, exports latest deck to PDF
```

⚠️ The export drops early background images (known Slidev timing bug). Open the PDF page-by-page
before handing it out. If early hero images are missing, present from the live URL instead, or
composite the final PDF from text-slide renders + the JPEGs at their exact positions.
