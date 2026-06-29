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

console.log("charts.test.ts: ok");
