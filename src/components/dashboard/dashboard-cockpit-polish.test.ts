// @ts-nocheck
// Dashboard cockpit polish (cave-m4oq): empty KPI tiles teach instead of
// shrugging, no fake flatlines under missing data, one-accent trend waves,
// and a quiet insight note instead of a heavy banner. The cockpit is split
// across the root (data + layout), cockpit-panels.tsx (presentation), and
// dashboard-cockpit-format.ts (pure labels) — cave-tsoz.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cockpit = readFileSync(new URL("./dashboard-cockpit.tsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("./cockpit-panels.tsx", import.meta.url), "utf8");
const format = readFileSync(new URL("../../lib/dashboard-cockpit-format.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/dashboard.css", import.meta.url), "utf8");

// ── Empty tiles teach the action that fills them ─────────────────────────────
assert.match(format, /fills in after the first retro run/, "Retro tile teaches when empty");
assert.match(format, /fills in once familiars have contracts/, "Contract tile teaches when empty");
assert.match(cockpit, /fills in after growth reviews/, "Confidence tile teaches when empty");
for (const shrug of ["no retro runs", "no contracts", "no scores yet"]) {
  for (const [name, src] of [["cockpit", cockpit], ["panels", panels], ["format", format]]) {
    assert.doesNotMatch(src, new RegExp(`"${shrug}"`), `dead-end sub "${shrug}" is gone from ${name}`);
  }
}

// ── No fake flatline under a metric with no data ─────────────────────────────
assert.match(
  panels,
  /\{value == null \? null : \(\s*\n\s*<Sparkline points=\{series\} color="var\(--accent-presence\)" height=\{22\} \/>/,
  "KPI tiles skip the sparkline while the metric has no data, and use the shared accent",
);

// ── One accent for every trend wave ──────────────────────────────────────────
assert.match(
  panels,
  /<Sparkline points=\{r\.trend\} color="var\(--accent-presence\)" height=\{22\} \/>/,
  "Familiar-insight rows draw one-accent sparklines (identity color stays on the avatar)",
);
assert.match(
  panels,
  /<Sparkline points=\{p\.trend\} color="var\(--accent-presence\)" height=\{20\} \/>/,
  "Agent-panel trends draw one-accent sparklines",
);
assert.doesNotMatch(
  panels,
  /<Sparkline[^>]*color=\{r\.color\}/,
  "No per-row rainbow sparkline remains",
);

// ── Timestamps are semantic <time> elements (cave-tsoz) ──────────────────────
assert.match(
  panels,
  /<time className="cockpit-agendarow__when" dateTime=\{i\.fireAt!\}>/,
  "agenda reminders carry machine-readable datetimes",
);
assert.match(
  panels,
  /<time dateTime=\{r\.lastActiveAt\}>\{relativeTime\(r\.lastActiveAt\)/,
  "insight rows' last-active is a semantic time element",
);
assert.match(
  panels,
  /<time dateTime=\{lastModifiedIso\}>\{relativeTime\(lastModifiedIso\)/,
  "space-usage Updated column is a semantic time element",
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

// ── GitHub empty state names the fix only when it IS the fix ─────────────────
// The cockpit probes /api/github/pat (hasPat only — never the token) and the
// panel offers Connect GitHub solely on a proven-disconnected probe; a failed
// probe keeps the ambiguous copy instead of prescribing a fix that may not apply.
assert.match(cockpit, /getJson<\{ hasPat: boolean \}>\("\/api\/github\/pat"\)/, "cockpit probes token presence");
assert.match(cockpit, /connected=\{ghConnected\}/, "probe result reaches the GitHub panel");
assert.match(panels, /githubEmptyState\(connected\)/, "empty copy derives from the shared truthful helper");
assert.match(
  panels,
  /<a className="cockpit-connect focus-ring" href="\/\?mode=github">Connect GitHub<\/a>/,
  "disconnected empty state carries the connect affordance into the GitHub surface",
);
assert.doesNotMatch(
  panels,
  /No GitHub activity, or no token configured/,
  "the hedged dead-end copy no longer lives in the panel itself",
);

console.log("dashboard-cockpit-polish.test.ts: ok");
