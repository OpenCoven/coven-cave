---
name: dataviz-dashboard-ux
description: Use when building or reviewing any chart, graph, KPI card, dashboard, or analytics view — to pick the right chart type (bar/line/area/scatter/histogram/heatmap/sparkline/small-multiples), lay out KPIs (overview-then-detail, F-pattern), colour data safely (sequential/diverging/categorical, Okabe-Ito & Viridis, never colour-only), design hover/brush/drill-down/cross-filter interactions, handle time-series (zero baseline, time zones, aggregation, missing data), cover loading/empty/error + real-time refresh states, make charts accessible (alt text, data tables, keyboard series nav), export to PNG/PDF/CSV, and choose a React charting library (Recharts vs Nivo vs Victory vs visx vs D3 vs Observable Plot). Reach for it on any request mentioning "chart", "graph", "dashboard", "data viz", "KPI", "metric", "plot", "which chart", "colour palette", or when a PR adds a visualization.
---

# Data-Viz & Dashboard UX

The decision layer of analytical UI: *which* chart, *how dense*, *what colour*, *what interaction*, *which library*, *how accessible/exportable*. Framework-agnostic on principle; React-first on library picks. Grounded in Cleveland–McGill (perceptual accuracy), Tufte (data-ink), Few (dashboards), Munzner (marks/channels).

## Use When
- Picking or reviewing a chart type for a given data question.
- Building a dashboard: KPI hierarchy, layout, small multiples, refresh cadence.
- Choosing/auditing a colour palette (categorical vs sequential vs diverging; CVD-safe).
- Designing chart interactions (tooltip, brush, linked views, drill-down, cross-filter).
- Handling time-series (baseline, time zones, aggregation, gaps), or loading/empty/error/real-time states.
- Making charts accessible or exportable (alt/data-table, keyboard, PNG/PDF/CSV).
- Selecting a React charting library, or reviewing a PR that adds a visualization.

## Guardrails
- **Perceptual ranking is the law (Cleveland–McGill):** position on a common scale > length > angle/slope > area > colour luminance/saturation. Map the *most important* attribute to the *most accurate* channel (Munzner's effectiveness principle). Prefer bars over pies; aligned axes over dual axes.
- **Zero baseline for bars/area — always.** Length/area IS the encoding; truncating it lies (Datawrapper). Lines/scatter *may* start non-zero (slope carries meaning) — but label the axis honestly.
- **Never use colour as the sole encoding** (WCAG 1.4.1). Pair with label, shape, line-style, texture, or position. Test with a CVD simulator.
- **Right palette family:** sequential = ordered magnitude; diverging = signed/from-a-midpoint only; categorical = nominal (≤~7 hues). Default categorical = **Okabe–Ito**; default continuous = **Viridis**. Never `jet`/rainbow; never Red-Green diverging.
- **Maximise data-ink, don't fetishise it.** Kill chartjunk (3D, shadows, heavy gridlines, boxed everything) — but a little redundancy/labeling that aids reading is fine (the chartjunk debate). Clarity > asceticism.
- **Overview → zoom/filter → details-on-demand** (Shneiderman). Keep resting charts clean; put precision in tooltips/tables. Every interaction needs an affordance + a reset; announce filter changes to AT.
- **A chart is not accessible until it has a text alternative + (ideally) a data table.** Don't ship hover-only critical info. Defer the general a11y checklist to `wcag-a11y-audit`.
- **Don't over-render.** SVG DOM grows with data; past ~1–10k points switch to Canvas (Nivo/Chart.js) or downsample (LTTB). Real-time = append, don't full-redraw; honour `prefers-reduced-motion`.
- **Every tile has four states:** loading (skeleton in-footprint), empty (explain + action; 0 ≠ empty), error (message + retry, isolated), stale/partial (badge "as of <time>").

## Default Flow

### 1. Frame the question (Munzner What/Why/How)
Name the **data** (categorical / ordered / quantitative; how many series/points) and the **task** (compare, trend, relate, distribute, part-of-whole, look-up). The task picks the chart — not aesthetics.

### 2. Pick the chart (chooser)
- **Compare categories** → **bar** (horizontal if long/many labels), sorted, **zero baseline**.
- **Trend over time** → **line** (baseline optional; cap ~3–5 series or go small-multiples).
- **Cumulative/one-series magnitude over time** → **area** (single series or stacked total only).
- **Relationship** → **scatter** (alpha/hexbin if overplotted).
- **Distribution** → **histogram/density** (annotate bin width); box/violin to compare groups.
- **2 categorical dims × 1 value** → **heatmap** (sequential/diverging scale, meaningfully ordered rows).
- **Inline trend in a table/KPI** → **sparkline** (no axes; current + min/max dot).
- **Same chart across facets** → **small multiples** (shared, sorted scales).
- **Single value vs target** → **big number + delta** or **bullet graph** (not a gauge).
- **Part-to-whole, ≤5 slices, big differences** → **donut/pie**; else a sorted bar. Never 3D/exploded.
- Stuck? Consult FT Visual Vocabulary / Data-to-Viz / Datawrapper Academy.

### 3. Lay out the dashboard
Most important KPI **top-left** (F/Z-pattern). Summary KPI row on top → trend charts → detail/tables (or drill-down). 3–7 primary metrics; group related; align axes across a row so values compare. Monitoring dashboards aim for one no-scroll view (Few); analytical ones may relax. Whitespace/proximity to group; don't box everything.

### 4. Colour it
Choose family by data (sequential/diverging/categorical). Categorical default **Okabe–Ito**:
`#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000`.
Continuous default **Viridis** (`viridis/magma/inferno/plasma/cividis`). Add a **second encoding** (label/shape/dash/texture) so it survives CVD + greyscale. Verify contrast (4.5:1 text, 3:1 marks/boundaries).

### 5. Add interactions (only what earns its keep)
Hover tooltip (details-on-demand; keyboard-reachable) · legend click-to-toggle · brush a range · linked/coordinated views · click-to-cross-filter (Power BI visual interactions / Tableau filter actions) · drill-down/through. Always provide a **reset**; encode filter state in the URL for deep links; announce changes via a polite live region.

### 6. Time-series care
Real time scale on x (not evenly-spaced indices). Store/compute UTC, render in viewer/declared tz, label tz when it matters, mind DST. Aggregate to match the question (raw→min→hour→day…); downsample large series with LTTB; state the interval. **Gaps ≠ zero** — break the line or mark interpolation; never silently connect across missing data.

### 7. Cover the non-happy states
Skeleton (in the chart's footprint, no layout shift) · empty (explain why + action; distinguish from 0) · error (human message + retry, per-tile isolation) · stale/streaming ("Last updated 3s ago" + pause). Auto-update >5s needs pause/stop/hide (WCAG 2.2.2). Announce state changes to AT.

### 8. Make it accessible (chart-specific; see `wcag-a11y-audit` for the rest)
Two-part text alt: short `aria-label` = `"[Chart type] of [data] where [takeaway]"`; long description = title/type/axes(+full-word units)/key values/min-max/trend. Offer **"View as table"** (the best long-desc for data). Keyboard-navigate series/points. A one-line textual summary helps everyone. Colour never sole (§4). Support `forced-colors`/high-contrast (`currentColor`, not vanishing fills). Honour reduced-motion.

### 9. Export
Offer PNG (paste) + SVG (crisp/print) with title/axes/legend/source-timestamp baked in; PDF via `@media print` (strip interactive chrome, expand tooltips→labels, high-contrast). **Always offer CSV/data download** (trust + reuse + doubles as SR table). Copy-link with filter state.

### 10. Pick the React library
- **Recharts** — default React dashboards, standard charts, shadcn `<ChartContainer>` stack.
- **Nivo** — polished + exotic chart types, **Canvas** for large N, SSR.
- **Victory** — same API on **React + React Native**.
- **visx** — low-level primitives (D3 math + React DOM) for **bespoke/design-system** charts; tree-shakeable.
- **D3** — truly novel viz / force / geo / hierarchy; let React own the DOM, use D3 for math/scales.
- **Observable Plot** — fast **exploratory**/embeds, Grammar-of-Graphics, **built-in ARIA** (`ariaLabel`/`ariaDescription`/`ariaHidden`).
- Enterprise a11y-by-contract → **Highcharts** (strongest off-the-shelf accessibility module). Chart.js/ECharts/Plotly/Tremor are valid alternates.

### 11. Reject anti-patterns
No **3D** charts, no **exploding/3D pies**, no **dual y-axes** (use aligned panels or index to 100), no **truncated bar baselines**, no **rainbow/jet** ramps, no **colour-only** encoding, no **>7 categorical colours** or **spaghetti lines** (→ small multiples/highlighting), no **opaque overplotted scatter**, no **over-decorated gauges** (→ bullet graph), no **hover-only critical data**, no **meaningless precision**.

## References
Cleveland & McGill 1984 (http://euclid.psych.yorku.ca/www/psy6135/papers/ClevelandMcGill1984.pdf) · Tufte VDQI (https://www.edwardtufte.com/tufte/books_vdqi) · Munzner VAD (https://www.cs.ubc.ca/~tmm/vadbook/) · Stephen Few / Perceptual Edge (https://www.perceptualedge.com/) · Datawrapper Academy (https://www.datawrapper.de/academy/) & zero-baseline (https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero) · FT Visual Vocabulary (https://ft-interactive.github.io/visual-vocabulary/) · Data-to-Viz (https://www.data-to-viz.com/) · ColorBrewer (https://colorbrewer2.org/) · Wong 2011 Nature Methods / Okabe–Ito (https://www.nature.com/articles/nmeth.1618) · Viridis / matplotlib colormaps (https://matplotlib.org/stable/users/explain/colors/colormaps.html) · Tableau filter actions (https://help.tableau.com/current/pro/desktop/en-us/actions_filter.htm) · Power BI visual interactions (https://learn.microsoft.com/en-us/power-bi/create-reports/service-reports-visual-interactions) · Recharts (https://recharts.org/) · shadcn charts (https://ui.shadcn.com/charts) · Nivo (https://github.com/plouc/nivo) · Victory (https://commerce.nearform.com/open-source/victory/) · visx (https://airbnb.io/visx/) · D3 (https://d3js.org/) · Observable Plot (https://observablehq.com/plot/) & accessibility (https://observablehq.com/plot/features/accessibility) · Chart.js (https://www.chartjs.org/docs/latest/) · Highcharts a11y (https://www.highcharts.com/docs/accessibility/accessibility-module) · W3C WAI Complex Images (https://www.w3.org/WAI/tutorials/images/complex/).
