# Beautiful UI

19 AI-native interface primitives vendored from
[beautifului.dev](https://www.beautifului.dev) — MIT, by
[Turbo](https://turbodesign.co/).

- Source: `src/components/ui/beautiful/`
- Token adapter + Tailwind entry point: `src/styles/beautiful-ui.css`
- Gallery: `/aesthetic/beautiful` (sibling of the `/aesthetic` token reference)
- Tracking bead: `cave-qq3dt`

## Read this before you use one

**These are showcase compositions, not drop-in primitives.** 16 of the 19 take
no props at all: they render upstream's own fixture data — an ice-cream
business, complete with Pistachio and Mint Chip — and drive themselves with
built-in demo loops. `LoadingState`, `PromptBar`, `TaskRows` and `ThinkingState`
accept a `variant` string and nothing more.

So "use Beautiful UI's ApprovalCard on the permissions surface" is not an
import; it is a small piece of work: lift the fixture into props, type it, and
thread real data through. That work is deliberately **not** done in the vendor
commit, so the diff against upstream stays legible and re-syncable. Do it per
component, on the surface that needs it, with its own review.

## Where the CSS lives, and why it is not in globals.css

`src/styles/beautiful-ui.css` is **its own Tailwind entry point**, imported by
the gallery route rather than by `src/app/globals.css`.

Tailwind emits the utilities it generates into whichever stylesheet owns the
scan. Adding 19 utility-heavy components to the root scan therefore grows the
root stylesheet that every route downloads. The numbers, measured on this
branch:

| | root CSS |
| --- | --- |
| base (`main`) | 599 KB |
| budget (`BUNDLE_MAX_ROOT_CSS_KB`) | 600 KB |
| with the vendored set in the root scan | 623 KB |

One kilobyte of headroom, and the vendored set costs ~24 KB. Since nothing in
the app uses these components yet, that would be 24 KB on every route to serve
one gallery. So:

- `beautiful-ui.css` imports `tailwindcss/theme.css` and
  `tailwindcss/utilities.css` with `source(none)`, then `@source`s exactly the
  vendored directory and the gallery. Preflight is **not** imported — the root
  sheet already applies it, and a second copy would re-reset the page.
- `src/app/globals.css` carries the matching
  `@source not "../components/ui/beautiful"` so the same utilities are not also
  generated into the root bundle.

When you adopt a component on a real surface, add that surface to the `@source`
list. Once adoption is broad enough that the split is more trouble than the
bytes, delete both directives and raise `BUNDLE_MAX_ROOT_CSS_KB` knowingly.

## What the adapter does

Upstream ships its own token vocabulary (`--ink`, `--surface`, `--line`,
`--accent`, …). Every one is aliased onto a Cave token, under a `bui-` prefix:

| Upstream | Cave |
| --- | --- |
| `--ink` / `-2` / `-3` | `--text-primary` / `--text-secondary` / `--text-muted` |
| `--canvas` | `--bg-base` |
| `--surface` | `--bg-panel` |
| `--field` | `--bg-subtle` |
| `--inset` | `--bg-sunken` |
| `--hover` / `--hover-2` | `--bg-hover` / `--bg-raised` |
| `--line` / `--line-strong` | `--border` / `--border-strong` |
| `--accent` | `--accent-presence` (OpenCoven lavender) |
| `--accent-ink` / `--accent-tint` | `--accent-presence-foreground` / `-soft` |
| `--red` / `--green` / `--orange` | `--color-danger` / `-success` / `-warning` |

Because every alias points at a Cave token rather than a literal, the vendored
components theme for free: all 12 palettes × 2 modes, with no per-palette entry
in `themes.css`. That is what the gallery route is for — switch palette and the
whole page repaints, and anything that hardcoded a colour shows up at once.

**Why the `bui-` prefix.** Registered unprefixed in `@theme`, upstream's generic
names would mint global `text-ink` / `bg-surface` utilities sitting alongside
Cave's own `--text-primary` / `--bg-panel` — two vocabularies for one concept,
reachable from every hand-written component. The prefix keeps the vendored
vocabulary legible as vendored and stops it leaking into Cave code.

## Changes made on the way in

Everything else is upstream verbatim. Each of these is also commented at its
site in the source.

**Dependencies dropped — the port adds none.** Upstream pulls four packages;
all four are replaced with something Cave already has:

| Upstream dependency | Replaced with |
| --- | --- |
| `liveline` (charts, in `InsightCards`) | `TrendChart`, Cave's visx primitive. Both upstream call sites use it `paused`, with their own hover cursor drawn on top, so the only thing it contributed was the polyline. |
| `glimm` (WebGL sweep, in `PromptBar`) | A one-shot accent pulse on the composer shell. The sweep was decorative; the trigger point is kept. |
| `iconoir-react` (10 glyphs, in `SelectionActions`) | Cave's Phosphor registry (`src/lib/icon.tsx`). A second icon package would fork the one registry. |
| `@/components/atoms/*` (site-internal, not published) | `beautiful/atoms.tsx` — `Shimmer` and `StreamText`, ~90 lines. |

**Design-gate conformance.**

- Raw pixel text sizes snapped to the Cave type scale. `pnpm codemod:design`
  handled most (it already maps 10.5/11.5/12.5px); 7px, 8px and 17px were
  off-scale in both directions and were snapped by hand to `--text-2xs` and
  `--text-lg`. The 7/8px cases are single-character badges in a 14px box, where
  10px still fits.
- `TaskRows`' fixed 24px spinner box moved from a style object to `size-6`.
- Reduced-motion coverage added for every vendored animation. Upstream ships a
  story only for the loader; the rest now freeze to a resting state that still
  reads as pending, and streaming/fading text settles fully visible rather than
  stranded at partial opacity.
- The inline-style drift ratchet moved 217 → 281. All 64 are runtime-derived —
  per-item animation delays, measured selection coordinates, per-datum colours
  threaded into custom properties, animated measured widths. That is checked,
  not asserted: `coven-design/no-static-inline-style` reports zero findings
  across the directory.

**One rule disabled, once.** `no-render-hex-color` is disabled for the
`BRANDS` block in `PromptBar.tsx` — the inline Figma, Slack and Gmail marks.
Brand colours are fixed by their owners, do not vary with our palette, and have
no correct token substitute. The disable is scoped to that block, so a new
colour anywhere else in the file is still caught, and the literals were left in
place rather than hoisted into constants, which would have slipped past the
rule without recording a decision.

## Known gaps

- **`text-white` on tinted badges.** A few badges paint white on
  `--color-warning` / `--color-success`. Upstream designed that against two
  modes; Cave has 24 palette/mode combinations, and the light ones are where
  this is thin. Not yet audited — see `cave-qq3dt`.
- **Copy.** Fixture strings are upstream's and do not follow the §10 copy
  contract in `docs/coven-design-language.md`. They should be replaced as part
  of parameterizing a component, not before.

## Re-syncing with upstream

The site is a single Next.js page that embeds each component's source in its
RSC payload. There is no importer script — it was a one-off extraction:
concatenate the `self.__next_f.push` payloads, then read the
`<id>:T<hexlen>,` framed text chunks. Note the length is in **UTF-8 bytes**,
not characters; the sources are full of box-drawing comment rules, so slicing
by character silently runs each file into the next.
