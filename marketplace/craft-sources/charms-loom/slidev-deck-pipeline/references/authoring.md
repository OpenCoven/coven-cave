# Authoring a deck with `fs.writeFileSync`

Long deck bodies MUST be written from a Node script. Shell heredocs and `echo`/`printf`
truncate long content and mangle `<`, `>`, backticks, and escapes. Slidev decks are long
and full of HTML — never trust the shell to carry them.

## Pattern

```js
// write-deck.mjs — run: node write-deck.mjs
import { writeFileSync } from 'node:fs'

const date = '2026-07-15'
const longDate = 'July 15, 2026'

const deck = `---
theme: ../theme
title: Weekly Open Coven — ${longDate}
highlighter: shiki
colorSchema: dark
aspectRatio: 16/9
transition: slide-left
favicon: https://opencoven.ai/favicon.ico
layout: cover
---

# What we shipped.<br/>Where we're going.

<div class="sub">Show'n Spells · 19:00 CST · discord.gg/opencoven</div>

<!-- Welcome. Tonight we walk through what shipped and where we're headed. -->

---
layout: default
---

<div class="label">This week</div>

# The *headline* of the week.

<!-- One or two sentences you'd actually say out loud. -->
`

writeFileSync(new URL('./slides/' + date + '.md', import.meta.url).pathname, deck)
console.log('wrote', date)
```

Run it from the repo root so the relative `slides/` path resolves, or use an absolute path.

## Template variables (when scaffolding via `pnpm new`)

`scripts/new-week.mjs` replaces:

- `{{DATE}}` → `YYYY-MM-DD`
- `{{MONTH_DAY_YEAR}}` → `Month D, YYYY` (e.g. `July 15, 2026`)

So `template.md` uses those tokens; a hand-authored deck writes the literal values.

## After writing

1. `node -e "console.log(require('fs').readFileSync('slides/DATE.md','utf8').length)"` — sanity char count.
2. Confirm every slide has a `<!-- ... -->` speaker note.
3. Run the verifier (see `verify-deploy.md`).
