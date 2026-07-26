---
name: pretext
description: Use when measuring or laying out multiline text in a web UI WITHOUT triggering DOM reflow (getBoundingClientRect / offsetHeight / measuring a hidden clone) — the @chenglou/pretext library (pure JS/TS, works across all languages, renders to DOM/Canvas/SVG/WebGL and soon server-side). Covers the prepare()/layout() split (one-time analysis + canvas measurement vs the cheap pure-arithmetic hot path; never re-run prepare() on resize), height + lineCount measurement for list virtualization/occlusion, layout-shift prevention when text loads late, dev/CI-time button/label overflow checks (browser-free), and userland masonry/JS-flexbox layout; manual line layout via prepareWithSegments + layoutWithLines / walkLineRanges / measureLineStats / measureNaturalWidth / layoutNextLine(Range) / materializeLineRange (multiline shrink-wrap, balanced text, text flowed around a float, canvas/SVG/WebGL rendering); the @chenglou/pretext/rich-inline helper for inline chips/mentions/code-spans with break:'never' + caller-owned extraWidth; options whiteSpace normal|pre-wrap (textarea-like), wordBreak normal|keep-all (CJK/Hangul), letterSpacing px, soft-hyphen break points, setLocale/clearCache. Encodes the load-bearing caveats — the canvas `font` string AND the `lineHeight`/`letterSpacing` you pass MUST match the element's CSS; `system-ui` is unsafe for layout() accuracy on macOS (use a named font); requires Intl.Segmenter + Canvas 2D; empty string returns {lineCount:0} (clamp with Math.max(1,lineCount)); it is horizontal-only and NOT a full CSS inline/bidi formatting engine.
---

# Pretext — DOM-free Text Measurement & Layout

**Pretext** (`@chenglou/pretext`) is a pure JS/TS library that measures and lays out multiline text
**without ever touching the DOM**. Reading `getBoundingClientRect()` / `offsetHeight` (or measuring a
hidden clone) forces **layout reflow** — one of the most expensive things a browser does, and a classic
"I read a size in a loop and the page janked" bug. Pretext implements its own line-breaking using the
browser's **canvas font engine as ground truth**, so you get the wrapped **height + line count** (or the
actual per-line ranges) from **pure arithmetic**. It works across scripts (Latin, CJK, Arabic, emoji…) and
can drive **DOM, Canvas, SVG, WebGL, and eventually server-side** rendering. It is *AI/agent-friendly*:
correctness is checkable against the real browser without a full render pass.

The library is small and sharp. The whole skill is: **use `prepare()` once, `layout()`/walk many times,
keep `font`/`lineHeight`/`letterSpacing` in lock-step with your CSS, and never confuse it for a full CSS
inline engine.**

## Use When
- You need a paragraph/label's **wrapped height or line count** and you must **not** cause reflow — list
  **virtualization/occlusion**, sticky headers, autosize rows, JS-driven masonry/flexbox-like layout.
- You want to **prevent layout shift**: reserve the exact space before late-loading text arrives (re-anchor
  scroll position).
- You want a **browser-free / CI-time guard** that a button label, chip, or truncation target doesn't wrap
  to N+1 lines (verify overflow in a unit test — no headless browser).
- You are **rendering text yourself** to Canvas / SVG / WebGL / server and need correct line breaks per
  width (including **variable width per line** — e.g. text flowing around a floated image).
- You want **multiline shrink-wrap** (tightest width that still fits) or **balanced text** — things CSS
  can't express cleanly.
- You need **inline flow** for chips / mentions / code-spans (`@chenglou/pretext/rich-inline`).

## Don't Use / Reach Elsewhere When
- You just need **one static single-line width** → call `ctx.measureText(text).width` on a canvas directly;
  you don't need the wrapping machinery.
- You want **full CSS inline formatting** — nested markup trees, `vertical-align`, ruby, floats-as-CSS,
  precise bidi/Arabic **x-coordinate reconstruction**. Pretext is **line-breaking + horizontal widths**, not
  a general inline formatting/shaping engine. (`segLevels` is exposed for *your own* bidi rendering, but the
  break APIs don't reconstruct glyph x-positions.)
- Your runtime lacks **`Intl.Segmenter`** or a **Canvas 2D** `measureText` and you can't polyfill → currently
  unsupported.
- You're happy to let the browser lay out and you **never read a measurement back synchronously** (no reflow
  hazard) → you may not need Pretext at all.

## Mental model — `prepare()` once, `layout()` many
- **`prepare(text, font, options)`** does the **one-time expensive work**: normalize whitespace, segment via
  `Intl.Segmenter`, apply glue/break rules, **measure segments with canvas**, and return an **opaque handle**
  (`PreparedText`). It is **horizontal-only** — `lineHeight` is *not* baked in here.
- **`layout(prepared, maxWidth, lineHeight)`** is the **cheap hot path**: **pure arithmetic** over cached
  segment widths → `{ height, lineCount }`. No DOM, no reflow.
- **Rule:** *do not re-run `prepare()` for the same text+config* — that throws away its precomputation. On
  **resize**, re-run only `layout()` (or the walk APIs). **Cache `prepared` by `(text, font, options)`.**
- For manual layout, swap `prepare` → **`prepareWithSegments`** (returns the richer `PreparedTextWithSegments`
  handle the line-walking APIs consume).

## Install
```sh
npm install @chenglou/pretext
```
```ts
import { prepare, layout } from '@chenglou/pretext'
import { prepareWithSegments, layoutWithLines, walkLineRanges, measureLineStats } from '@chenglou/pretext'
import { prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'
```
Requires **`Intl.Segmenter`** and **Canvas 2D `measureText`** at runtime.

## The two jobs

### Job 1 — Height/line-count, no DOM (`prepare` → `layout`)
```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀', '16px Inter')
const { height, lineCount } = layout(prepared, 320, 20) // 320px max width, 20px line-height → arithmetic only
```

### Job 2 — Lay out the actual lines yourself (`prepareWithSegments` → `layoutWithLines` / walkers)
```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('AGI 春天到了. بدأت الرحلة 🚀', '18px "Helvetica Neue"')
const { lines } = layoutWithLines(prepared, 320, 26)
for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].text, 0, (i + 1) * 26)
```

## API map

| API | Handle | Returns | Reach for it when |
|---|---|---|---|
| `prepare(text, font, opts?)` | — | `PreparedText` (opaque) | one-time analysis + measurement for Job 1 |
| `layout(prepared, maxWidth, lineHeight)` | `PreparedText` | `{ height, lineCount }` | **the height hot path** (virtualize, reserve space) |
| `prepareWithSegments(text, font, opts?)` | — | `PreparedTextWithSegments` | one-time analysis for **manual** layout |
| `layoutWithLines(p, maxWidth, lineHeight)` | segments | `{ height, lineCount, lines[] }` | you need the **line strings** at a fixed width |
| `walkLineRanges(p, maxWidth, onLine)` | segments | line count; per-line `{ width, start, end }` | shrink-wrap / speculative width probing, **no string alloc** |
| `measureLineStats(p, maxWidth)` | segments | `{ lineCount, maxLineWidth }` | cheapest "how many lines + widest line" |
| `measureNaturalWidth(p)` | segments | `number` | widest **forced** line (hard breaks count) when width isn't the wrap cause |
| `layoutNextLine(p, start, maxWidth)` | segments | `LayoutLine \| null` | **variable width per line** (with strings) |
| `layoutNextLineRange(p, start, maxWidth)` | segments | `LayoutLineRange \| null` | variable width per line, **no string alloc** |
| `materializeLineRange(p, range)` | segments | `LayoutLine` | turn one range from the walkers back into text |
| `clearCache()` / `setLocale(locale?)` | — | `void` | release caches / change locale (setLocale also clears) |

`@chenglou/pretext/rich-inline`: `prepareRichInline(items)` → `layoutNextRichInlineLineRange` /
`walkRichInlineLineRanges` / `materializeRichInlineLineRange` / `measureRichInlineStats`. A `LayoutCursor`
is `{ segmentIndex, graphemeIndex }` — a segment/grapheme cursor, **not** a raw string offset.

## Recipes

### 1 — Virtualized list row heights (no reflow)
```ts
import { prepare, layout } from '@chenglou/pretext'

const FONT = '16px Inter'   // ← MUST equal the row's CSS `font` (size + family + weight)
const LINE_HEIGHT = 22      // ← MUST equal the row's CSS `line-height`, in px
const COL_WIDTH = 360       // ← content-box width in px (subtract horizontal padding yourself)

// Precompute once per item; cache the handle by (text, font). Reuse across scroll AND resize.
const prepared = prepare(item.body, FONT)
const { height } = layout(prepared, COL_WIDTH, LINE_HEIGHT)
// feed `height` into react-window / TanStack Virtual / your own occlusion math — no hidden clone, no reflow.
```

### 2 — Prevent layout shift (reserve space before text loads)
```ts
const { lineCount } = layout(prepare(text, FONT), COL_WIDTH, LINE_HEIGHT)
const reserved = Math.max(1, lineCount) * LINE_HEIGHT // empty string → lineCount 0; a real block still shows 1 line
container.style.minHeight = `${reserved}px`           // no jump when the real text mounts
```

### 3 — Browser-free overflow guard (unit test / CI)
```ts
import { prepare, layout } from '@chenglou/pretext'

export function assertFits(label: string, font: string, innerWidth: number) {
  const { lineCount } = layout(prepare(label, font), innerWidth, 20)
  if (lineCount > 1) throw new Error(`Label wraps to ${lineCount} lines at ${innerWidth}px: "${label}"`)
}
// Run in `node --test` — verify buttons/chips/nav labels don't overflow without spinning up a headless browser.
```

### 4 — Multiline shrink-wrap (tightest width that still fits)
```ts
import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext'

const prepared = prepareWithSegments(text, FONT)
let maxW = 0
walkLineRanges(prepared, maxWidth, line => { if (line.width > maxW) maxW = line.width })
// maxW = the narrowest container width that keeps the SAME wrapped line count — the multiline "shrink wrap"
// the web never had. (For a single number when width isn't the wrap cause, use measureNaturalWidth.)
```

### 5 — Balanced text (binary-search a nice width, then lay out once)
```ts
import { measureLineStats, layoutWithLines } from '@chenglou/pretext'

const target = measureLineStats(prepared, maxWidth).lineCount // don't add lines while balancing
let lo = 0, hi = maxWidth
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1
  if (measureLineStats(prepared, mid).lineCount <= target) hi = mid
  else lo = mid
}
const { lines } = layoutWithLines(prepared, hi, LINE_HEIGHT) // widths evened out at the same line count
```
`measureLineStats` allocates no line strings, so probing many widths is cheap. Do the **one**
`layoutWithLines` only after you've picked a satisfying width.

### 6 — Variable width per line (flow text around a floated image)
```ts
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'

const prepared = prepareWithSegments(article, BODY_FONT)
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth // narrower beside the float
  const range = layoutNextLineRange(prepared, cursor, width)
  if (range === null) break
  ctx.fillText(materializeLineRange(prepared, range).text, 0, y)
  cursor = range.end
  y += 26
}
```
This is how you reach Canvas / SVG / WebGL / server — one row at a time, each with its own width.

### 7 — Rich inline flow: chips & mentions (`/rich-inline`)
```ts
import { materializeRichInlineLineRange, prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'

const prepared = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 }, // atomic chip; 22px = padding+border
  { text: "'s rich-note", font: '500 17px Inter' },
])
walkRichInlineLineRanges(prepared, 320, range => {
  const line = materializeRichInlineLineRange(prepared, range) // fragments keep source itemIndex, slice, gapBefore, cursors
})
```
Intentionally narrow: raw inline text in (boundary spaces collapse like the browser), `extraWidth` for pill
chrome, `break:'never'` for atomic items, **`white-space: normal` only**. Not a nested markup tree, not a
general CSS inline formatting engine.

## Options (pass to `prepare` / `prepareWithSegments`)
- **`whiteSpace: 'pre-wrap'`** — textarea-like: ordinary spaces, `\t` tabs, and `\n` hard breaks stay visible.
  Default is `'normal'` (collapse). Use `pre-wrap` when you measure a `<textarea>`/`pre` value.
- **`wordBreak: 'keep-all'`** — CSS `word-break: keep-all` for CJK/Hangul and no-space mixed Latin/numeric/CJK
  runs. Still falls back to `overflow-wrap: break-word` for overlong runs. Default `'normal'`.
- **`letterSpacing: n`** — CSS `letter-spacing` as a **numeric px** value. **Must match your CSS.**
- **Soft hyphens** — insert `­` yourself *before* `prepare()`; Pretext treats them as optional break
  points. Unchosen soft hyphens stay invisible; a chosen break materializes a **trailing `-`**. Prefer
  conservative, locale-aware insertion; automatic hyphenation is **not** built in.
- **`setLocale(locale?)`** — sets locale for future `prepare()`/`prepareWithSegments()` (also clears caches;
  existing handles are unaffected). **`clearCache()`** — release the shared caches if you cycle many fonts.

## Guardrails — the load-bearing rules (get these wrong and heights lie)
- **`font` MUST match the element's CSS `font`.** Same format as `ctx.font` (`16px Inter`, `700 13px "SF Pro"`).
  Wrong size/family/weight → wrong widths → wrong wraps. Only the **canvas `font` shorthand** is modeled.
- **`lineHeight` and `letterSpacing` MUST match your CSS too.** `lineHeight` is a **layout-time** arg (px);
  `letterSpacing` is a `prepare()` px option. Keep both in lock-step with `line-height` / `letter-spacing`.
- **Never re-run `prepare()` for the same text+config.** It's the expensive precompute. On resize/reflow,
  re-run only `layout()` / the walkers. **Cache the handle** keyed by `(text, font, options)`.
- **`system-ui` is unsafe for `layout()` accuracy on macOS — use a named font** (`Inter`, `"Helvetica Neue"`,
  …). See the repo's `PLATFORM_BUGS.md` for the underlying Chrome/Firefox issues.
- **Empty string:** `layout('')` → `{ lineCount: 0, height: 0 }`, but browsers still size an empty block to
  one line-height. Clamp with **`Math.max(1, lineCount) * lineHeight`** when you want that default.
- **`Intl.Segmenter` + Canvas 2D are required.** Pretext sidesteps DOM *layout*, but still measures via a
  canvas 2D `measureText`. Runtimes without `Intl.Segmenter` are unsupported.
- **Not modeled:** `font-optical-sizing`, `font-feature-settings`, standalone `font-variation-settings`.
  Variable-font axes only count when reflected in the font string (e.g. weight). `tab-size` is fixed at **8**.
- **Horizontal-only widths, not glyph positions.** Segment widths are canvas widths for *line breaking*, not
  exact glyph x-coordinates — don't use them for custom Arabic/mixed-direction x-reconstruction. Hard breaks
  count toward `measureNaturalWidth`. A won soft hyphen adds a visible trailing `-` to materialized text.

## Supported CSS surface (from the README "Caveats")
`white-space: normal | pre-wrap` · `word-break: normal | keep-all` · `overflow-wrap: break-word`
(very narrow widths break inside words, but only at **grapheme** boundaries) · `line-break: auto` ·
numeric `letter-spacing` · `tab-size: 8`. Anything outside the canvas `font` shorthand is not separately
modeled (see Guardrails).

## Verified facts (from the pretext README, 2026-07-03)
- Package: **`@chenglou/pretext`**; subpath **`@chenglou/pretext/rich-inline`**. Primary language TypeScript.
- Two jobs: (1) `prepare()`→`layout()` height/lineCount without DOM; (2) `prepareWithSegments()` + line
  walkers for manual layout to DOM/Canvas/SVG/WebGL/(soon)server.
- Caveats are quoted directly: `system-ui` unsafe on macOS; `Intl.Segmenter` + Canvas 2D required; empty
  string → `{ lineCount: 0 }`; only canvas `font` shorthand modeled; `tab-size: 8`; horizontal-only.
- Live demos: `chenglou.me/pretext`. Predecessor/credit: Sebastian Markbåge's `text-layout` (canvas
  `measureText` shaping, pdf.js bidi, streaming line breaking).

See `NOTES.md` for trade-offs, the reflow-cost rationale, and when this skill defers to a sibling.
