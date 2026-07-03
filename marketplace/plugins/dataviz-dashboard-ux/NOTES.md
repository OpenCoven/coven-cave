# NOTES — dataviz-dashboard-ux

The "why this exists / trade-offs / when NOT to use" appendix.

## Why this skill exists
Coding familiars ship charts constantly — every dashboard, every analytics page, every "add a graph here." Left to defaults they reach for whatever the library demos show first, which is how we get truncated-baseline bars, red/green deltas that vanish for 1-in-12 men, dual-axis "correlations," pie charts with nine slices, and rainbow heatmaps. This skill encodes the *decision layer* so the familiar picks the right chart, colours it safely, and makes it accessible **before** writing render code. It sits above the framework: `lit-ui-designer`/`opencoven-design` decide how a component *looks*, `tailwind-design-tokens` decides the *token system*, `wcag-a11y-audit` decides *general* accessibility — this skill decides *whether this is even the right chart and colour*.

## Scope boundaries (what it is / isn't)
- **Is:** chart-type selection, data-ink/density, dashboard layout & KPI hierarchy, small multiples, interaction idioms, data-safe colour, time-series handling, the four component states, chart-specific accessibility, export UX, anti-patterns, and a React charting-library decision matrix.
- **Isn't:** a component-styling or token skill (`lit-ui-designer`, `tailwind-design-tokens`, `shadcn-ui-and-radix`), the generic WCAG audit (`wcag-a11y-audit` — this only adds the chart-specific a11y and *defers* the rest), a Figma/Canva asset skill, or 3D/scene work (`threejs-animation`). It is not a maths/statistics skill — it won't tell you *which statistic* to compute, only how to show it honestly.

## Key facts people get wrong
- **Cleveland–McGill ranking is empirical, not taste.** Position > length > angle > area > luminance/saturation comes from a 1984 controlled experiment (JASA). "Bars beat pies" is a *measured* result, not an opinion. Area is perceived at roughly a 0.7 power law, i.e. systematically underestimated — that's why bubble sizes mislead.
- **Zero-baseline applies to BARS/AREA, not lines.** The most common over-correction is forcing line charts to start at zero and burying the signal. Length/area encodings (bars) must start at 0; position/slope encodings (lines/scatter) legitimately may not. Say which and why.
- **Okabe–Ito ≈ Wong.** The 8-colour CB-safe categorical palette in Wong's 2011 *Nature Methods* note is the Okabe–Ito palette. Hexes are stable and worth hardcoding as a default: `#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000`.
- **Viridis ≠ just "the pretty one."** It's *perceptually uniform* and *monotonic in lightness*, so equal data steps look equal and it survives greyscale/print; `cividis` is CVD-tuned. `jet`/rainbow is actively harmful (false luminance boundaries) — this is settled, not stylistic.
- **"Colour-blind safe" is per-palette, not per-tool.** All ColorBrewer *sequential* schemes are CB-safe; only *some* diverging are (BrBG/PuOr/RdBu yes; RdYlGn/Spectral no); *few* qualitative schemes are. Don't assume a palette is safe because it came from ColorBrewer.

## Trade-offs & judgement calls
- **Data-ink minimalism vs memorability.** Tufte says erase non-data-ink; the "chartjunk debate" (Bateman et al. 2010, defended vs Few) showed *some* embellishment can aid recall. The skill's stance: default to high data-ink for analytical/monitoring dashboards where speed-of-read matters; allow tasteful redundancy for explanatory/marketing charts. Clarity is the goal, not asceticism — don't strip a chart so bare it's unreadable.
- **Gauge vs bullet graph.** Few's bullet graph is objectively more information-dense than a speedometer gauge, but stakeholders *love* gauges. Offer the bullet graph; if a gauge is mandated, at least make it flat, un-decorated, single-value, with the target marked.
- **SVG vs Canvas.** SVG (Recharts/Victory/visx/Plot) gives crisp, inspectable, stylable, accessible-by-default marks but the DOM grows with N and chokes in the thousands-to-tens-of-thousands range. Canvas (Nivo canvas variants, Chart.js) scales but you lose per-mark DOM/ARIA and must build accessibility yourself. Rule of thumb: SVG under ~1–5k marks, Canvas or downsampling (LTTB) above.
- **Declarative React libs vs D3.** D3 is the most powerful but imperatively owns the DOM, which fights React's VDOM. The modern pattern (visx, and the useRef+useEffect Plot pattern) is *React renders, D3 computes* (scales, shapes, layouts). Reach for raw D3 only for genuinely novel viz (force, geo, custom hierarchies).
- **Dual axes.** Sometimes a stakeholder genuinely wants two series of different units on one chart. The honest alternatives are (a) two aligned small-multiple panels, or (b) index both to a common base (e.g. =100 at t0). If dual axes are unavoidable, make the relationship explicit and never imply the crossings mean anything.
- **Accessibility depth vs effort.** A perfect keyboard-navigable, screen-reader-narrated chart is real work. The 80/20 that this skill insists on: a good two-part text alternative **and** a "view as data table" toggle **and** never colour-only. Those three cover most users for a fraction of the cost of full ARIA series navigation (which Highcharts/Plot can give you off-the-shelf if it's contractual).

## When NOT to use
- Pure component-styling, token, or layout-chrome work with no data encoding (use `lit-ui-designer` / `tailwind-design-tokens` / `shadcn-ui-and-radix`).
- Deciding *which statistic/metric* to compute (that's an analytics/domain question, not a viz one).
- 3D/WebGL scene or generative-art work (`threejs-animation`) — though the "no 3D for *data encoding*" rule still stands.
- A one-off number with no comparison — just render the number; a chart of one value is chartjunk.
- Formal accessibility certification — this informs it but `wcag-a11y-audit` + real AT/user testing is the authority.

## Interlocks with other skills in this batch
- **`wcag-a11y-audit`** — owns the general a11y checklist; this skill adds chart-specific text-alt/data-table/keyboard-series/colour rules and defers everything else to it. Coordinate on the live-region announcement of filter/state changes.
- **`empty-loading-error-states`** — owns the generic three (four) states; this skill specialises them for charts (skeleton in the chart footprint, "0 ≠ empty", per-tile error isolation, streaming/stale badges).
- **`shadcn-ui-and-radix`** — shadcn's `<ChartContainer>` wraps Recharts; when the stack is shadcn, that's the default library path.
- **`tailwind-design-tokens`** — chart colours should be wired to design tokens (CSS vars) so palettes theme with dark mode; the Okabe–Ito/Viridis values become token sets.
- **`command-palette-keyboard-ux`** — the keyboard-navigation posture for interactive charts (arrow through series, Esc to clear filter) aligns with its hotkey conventions.
- **`form-ux-patterns`** — dashboard filter panels are forms; validation/affordance guidance carries over.

## Library-recommendation freshness
- **Recharts** had a v3 line of work through 2026; the shadcn charts docs track it. **Nivo** lives at nivo.rocks (bot-protected to headless fetches — 402 — so the plugin cites the `github.com/plouc/nivo` repo as the stable anchor). **Victory** is maintained by Nearform (docs under commerce.nearform.com). **visx** is Airbnb's (airbnb.io/visx). **Observable Plot** is actively developed by the D3 team; its ARIA support (`ariaLabel`/`ariaDescription`/`ariaHidden`) was verified in the live docs this run. Re-check version-specific API before quoting exact props; the *selection heuristics* age far slower than the APIs.

## Maintenance / freshness
- All source URLs verified reachable **2026-07-01** except `nivo.rocks` (402 to headless — bot protection, not dead; repo cited instead) and `tableau.com/blog` (403 — replaced with the stable `help.tableau.com` filter-actions doc). Canon references (Cleveland–McGill PDF, Tufte, Munzner VAD, Wong/Nature Methods, ColorBrewer, matplotlib colormaps) are stable long-term anchors.
- Watch for: WCAG 3 / APCA contrast (still draft — don't audit charts against APCA and call it WCAG 2.2); shifts in the React charting ecosystem (Tremor, Plotly-React, ECharts-for-React gaining share); and Observable Plot maturing its interaction/tooltip story (which is its current production weak spot).
