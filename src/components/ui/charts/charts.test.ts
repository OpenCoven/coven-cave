// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// ── TrendChart ────────────────────────────────────────────────────────────────
const trend = read("./trend-chart.tsx");
assert.match(trend, /"use client"/, "TrendChart is a client component");
assert.match(trend, /from "@visx\/responsive"/, "TrendChart measures width via ParentSize");
assert.match(trend, /ParentSize/, "TrendChart wraps Inner in ParentSize");
assert.match(trend, /from "@visx\/scale"/, "TrendChart uses visx scales");
assert.match(trend, /LinePath/, "TrendChart draws line paths");
assert.match(trend, /AreaClosed/, "TrendChart can fill the area under the line");
assert.match(trend, /threshold/, "TrendChart supports a threshold marker");
assert.match(trend, /cave-chart__empty/, "TrendChart renders an empty state");
assert.match(trend, /import "@\/styles\/charts\.css"/, "TrendChart imports the scoped css");
assert.match(trend, /export function TrendChart/, "exports TrendChart");
assert.match(trend, /export type TrendSeries/, "exports the TrendSeries type");

// ── BarChart ──────────────────────────────────────────────────────────────────
const bar = read("./bar-chart.tsx");
assert.match(bar, /"use client"/, "BarChart is a client component");
assert.match(bar, /ParentSize/, "BarChart measures width via ParentSize");
assert.match(bar, /scaleBand/, "BarChart uses a band scale for categories");
assert.match(bar, /from "@visx\/shape"/, "BarChart imports visx shapes");
assert.match(bar, /<Bar\b/, "BarChart renders Bar shapes");
assert.match(bar, /cave-chart__bar/, "bars carry the themed class");
assert.match(bar, /cave-chart__empty/, "BarChart renders an empty state");
assert.match(bar, /export function BarChart/, "exports BarChart");
assert.match(bar, /export type BarDatum/, "exports the BarDatum type");

// ── Heatmap ───────────────────────────────────────────────────────────────────
const heat = read("./heatmap.tsx");
assert.match(heat, /"use client"/, "Heatmap is a client component");
assert.match(heat, /ParentSize/, "Heatmap measures width via ParentSize");
assert.match(heat, /scaleBand/, "Heatmap uses band scales for rows and columns");
assert.match(heat, /cave-chart__cell/, "cells carry the themed class");
assert.match(heat, /colorFor/, "Heatmap colors each cell via a caller-supplied function");
assert.match(heat, /cave-chart__empty/, "Heatmap renders an empty state");
assert.match(heat, /export function Heatmap/, "exports Heatmap");
assert.match(heat, /export type HeatCell/, "exports the HeatCell type");

// ── DonutChart ────────────────────────────────────────────────────────────────
const donut = read("./donut-chart.tsx");
assert.match(donut, /"use client"/, "DonutChart is a client component");
assert.match(donut, /ParentSize/, "DonutChart measures width via ParentSize");
assert.match(donut, /<Pie\b/, "DonutChart renders a visx Pie");
assert.match(donut, /innerRadius/, "Pie has an inner radius (donut hole)");
assert.match(donut, /pieValue/, "Pie maps datum to a value");
assert.match(donut, /cave-chart__empty/, "DonutChart renders an empty state");
assert.match(donut, /export function DonutChart/, "exports DonutChart");
assert.match(donut, /export type DonutDatum/, "exports the DonutDatum type");

console.log("charts.test.ts: ok");
