// @ts-nocheck
// Dashboard cockpit polish (cave-m4oq): empty KPI tiles teach instead of
// shrugging, no fake flatlines under missing data, one-accent trend waves,
// and a quiet insight note instead of a heavy banner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cockpit = readFileSync(new URL("./dashboard-cockpit.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/dashboard.css", import.meta.url), "utf8");

// ── Empty tiles teach the action that fills them ─────────────────────────────
assert.match(cockpit, /fills in after the first retro run/, "Retro tile teaches when empty");
assert.match(cockpit, /fills in once familiars have contracts/, "Contract tile teaches when empty");
assert.match(cockpit, /fills in after growth reviews/, "Confidence tile teaches when empty");
for (const shrug of ["no retro runs", "no contracts", "no scores yet"]) {
  assert.doesNotMatch(cockpit, new RegExp(`"${shrug}"`), `dead-end sub "${shrug}" is gone`);
}

// ── No fake flatline under a metric with no data ─────────────────────────────
assert.match(
  cockpit,
  /\{value == null \? null : \(\s*\n\s*<Sparkline points=\{series\} color="var\(--accent-presence\)" height=\{22\} \/>/,
  "KPI tiles skip the sparkline while the metric has no data, and use the shared accent",
);

// ── One accent for every trend wave ──────────────────────────────────────────
assert.match(
  cockpit,
  /<Sparkline points=\{r\.trend\} color="var\(--accent-presence\)" height=\{22\} \/>/,
  "Familiar-insight rows draw one-accent sparklines (identity color stays on the avatar)",
);
assert.match(
  cockpit,
  /<Sparkline points=\{p\.trend\} color="var\(--accent-presence\)" height=\{20\} \/>/,
  "Agent-panel trends draw one-accent sparklines",
);
assert.doesNotMatch(
  cockpit,
  /<Sparkline[^>]*color=\{r\.color\}/,
  "No per-row rainbow sparkline remains",
);

// ── Insight banner reads as a quiet note ─────────────────────────────────────
assert.match(
  css,
  /\.coven-insight \{[\s\S]{0,400}?padding: 9px 13px; border-radius: 10px; font-size: 12\.5px;/,
  "Insight note is compact",
);
assert.match(
  css,
  /\.coven-insight--good \{ border-color: color-mix\(in oklch, var\(--color-success\) 18%, var\(--border-hairline\)\); background: color-mix\(in oklch, var\(--color-success\) 4%, var\(--bg-raised\)\); \}/,
  "Good-tone note is a wash over hairline, not a heavy green banner",
);

console.log("dashboard-cockpit-polish.test.ts: ok");
