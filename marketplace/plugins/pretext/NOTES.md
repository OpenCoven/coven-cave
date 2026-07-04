# NOTES — Pretext (DOM-free text measurement & layout)

## Why this skill exists
Reading text size back from the DOM (`getBoundingClientRect`, `offsetHeight`, or measuring a hidden clone)
forces **layout reflow** — one of the most expensive browser operations and a recurring source of jank in
virtualized lists, autosizing rows, and "measure-then-paint" loops. `@chenglou/pretext` computes wrapped
**height / line count / per-line ranges** from **pure arithmetic** over a one-time canvas measurement pass,
so familiars can build correct virtualization, layout-shift prevention, shrink-wrap, balanced text, and
canvas/SVG/server text rendering **without ever reflowing**. It's also unusually agent-friendly: results are
checkable against the real browser font engine, so an AI can iterate on layout code with a browser-free test.

## The one mistake that makes it "wrong"
`prepare()` measures against the **canvas `font` shorthand**, and `layout()` takes `lineHeight`/`letterSpacing`
as inputs. If any of `font`, `lineHeight`, or `letterSpacing` **drift from the element's actual CSS**, every
height is subtly wrong and you'll chase a "pretext is inaccurate" ghost. It isn't — the config desynced from
CSS. Treat these three as a contract with your stylesheet. Corollary: `system-ui` is **unsafe** for
`layout()` accuracy on macOS — always name the font.

## Trade-offs & sharp edges
- **`prepare()` is the cost; `layout()` is free.** The whole performance story collapses if you re-run
  `prepare()` per frame/resize. Cache the opaque handle by `(text, font, options)`; on resize call only
  `layout()` / the walk APIs.
- **Horizontal-only.** `lineHeight` is a layout-time multiplier, not baked into `prepare()`. Segment widths
  are for **line breaking**, not glyph x-positions — Pretext will not reconstruct custom Arabic/bidi
  x-coordinates. `segLevels` is exposed for *your* bidi renderer; the break APIs ignore it.
- **Not a full inline/CSS engine.** No nested markup trees, `vertical-align`, ruby, or CSS floats. The
  `rich-inline` helper is deliberately narrow: inline-only, `white-space: normal` only, atomic items via
  `break:'never'`, chrome via `extraWidth`. Reach for real DOM/CSS when you need true inline formatting.
- **Runtime floor.** Needs `Intl.Segmenter` + Canvas 2D `measureText`. It avoids DOM *layout*, not the canvas
  measurement primitive — SSR needs a canvas-measuring shim, and "soon, server-side" is aspirational in the
  README, not a shipped guarantee. Verify before betting an SSR path on it.
- **Unmodeled CSS.** `font-optical-sizing`, `font-feature-settings`, standalone `font-variation-settings` are
  not modeled; variable-font axes only count if reflected in the font string. `tab-size` is pinned at 8.
- **Empty-string clamp.** `layout('')` returns `lineCount: 0`; browsers show one line-height for an empty
  block. Clamp `Math.max(1, lineCount)` when you want the browser default.

## When NOT to use this skill (reach elsewhere)
- **One static single-line width** → `ctx.measureText().width` directly; the wrapping machinery is overkill.
- **True CSS inline formatting** (nested spans, vertical-align, ruby, precise bidi x-layout) → real DOM/CSS or
  a shaping engine (HarfBuzz-class); Pretext is line-breaking + horizontal widths.
- **Picking a UI library / design system** → `design-system-landscape`. **House visual law** →
  `opencoven-design`. **Empty/loading/error states** → `empty-loading-error-states`. Pretext is a measurement
  primitive those skills' components can *use*, not a replacement for them.
- **Runtime without `Intl.Segmenter`/Canvas 2D** and no polyfill available.

## Verification notes
Facts and the API surface were taken from the pretext `README.md` (and its API glossary + Caveats section)
fetched live on 2026-07-03; direct quotes preserved for the caveats (`system-ui` unsafe on macOS,
`Intl.Segmenter`/Canvas 2D required, empty-string `lineCount:0`, canvas `font` shorthand only, `tab-size: 8`,
horizontal-only). Code recipes are adapted from the README's own examples (virtualization/height, manual
line layout, float flow, rich-inline) plus derived patterns (CI overflow guard, balanced-text binary search)
built only from documented APIs. `sourceRefs` point at the upstream repo, npm package, live demos, and
`PLATFORM_BUGS.md`. Re-fetch the README before quoting version numbers or the server-side status — the
library is young and moving.
