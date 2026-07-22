// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab — Analytics section (design-handoff rebuild).
//
// Pins the honesty contract of the section: it reuses the existing familiar
// analytics data layer (no parallel fetch stack), renders no fabricated
// numbers (the design mock's "268k tokens" KPI has no backing API and must
// not survive), feeds the "Needs a human" card from the model's real
// self-heal requests, and keeps carousel slides mounted behind a visibility
// toggle so the visx charts never re-measure between slides.

const src = readFileSync(new URL("./familiar-tab-analytics.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab-analytics.css", import.meta.url), "utf8");

test("reuses the shared analytics data layer — no parallel fetch stack", () => {
  assert.match(
    src,
    /import \{[\s\S]*?loadFamiliarAnalyticsData[\s\S]*?\} from "@\/components\/familiar-analytics-data"/,
    "loads through loadFamiliarAnalyticsData",
  );
  assert.match(src, /buildFamiliarAnalyticsModel\(data\)/, "derives the shared model");
  assert.doesNotMatch(src, /\bfetch\(/, "no hand-rolled fetch — the loader owns all requests");
  assert.match(src, /usePausablePoll\(\(\) => void load\(\{ quiet: true \}\), 60_000\)/, "60s pausable poll like the analytics page");
  assert.match(src, /const generation = useRef\(0\)/, "generation counter retires stale loads");
});

test("no token KPI and no fabricated numbers", () => {
  assert.doesNotMatch(src, /[Tt]okens/, "there is no token API, so there is no token KPI");
  assert.doesNotMatch(src, /\b\d+k\b/, "no '268k'-style literal metric values");
  assert.doesNotMatch(src, /"\+\d+%"|"−\d+%"|"-\d+%"/, "no hardcoded delta strings");
  // The design mock shipped literal chart series ([6, 8, 7, 9, …]); every
  // series here must come from model data, never a numeric literal array.
  assert.doesNotMatch(src, /\[\s*\d+\s*,\s*\d+\s*,\s*\d+/, "no literal numeric data arrays");
  assert.match(src, /pulseTotal\(sessionPulse\)/, "Sessions KPI counts the real pulse window");
  assert.match(src, /pulseDelta\(sessionPulse\)/, "delta compares real pulse halves");
  assert.match(
    src,
    /delta\.current \+ delta\.previous > 0\s*\?/,
    "delta note renders only when the window has anything to compare",
  );
  assert.match(src, /attempted > 0 \? `\$\{Math\.round\(\(outcomes\.completed \/ attempted\) \* 100\)\}%` : "—"/,
    "success rate guards divide-by-zero with an em dash");
});

test("needs-a-human card renders the model's real self-heal requests", () => {
  assert.match(src, /const \{ sessionPulse, recentSessions, healRequests \} = model/, "healRequests come off the model");
  assert.match(src, /aria-label="Needs a human"/, "card is labeled per the design");
  assert.match(src, /\{healRequests\.length\}/, "count pill shows the real count");
  assert.match(
    src,
    /familiar-analytics-tab__count-pill--warning/,
    "warning tint exists for a non-zero count",
  );
  assert.match(
    src,
    /healRequests\.length > 0 \? " familiar-analytics-tab__count-pill--warning" : ""/,
    "zero requests keep the pill neutral, not warning",
  );
  assert.match(src, /Nothing waiting on you\./, "quiet empty line when nothing is pending");
  assert.match(src, /\{request\.title\}[\s\S]{0,200}\{request\.detail\}/, "rows render real request title + detail");
});

test("carousel slides stay mounted and toggle visibility (no re-measure)", () => {
  assert.match(src, /function Slide\(\{ hidden, children \}/, "shared grid-stack slide wrapper");
  assert.match(src, /hidden \? " is-hidden" : ""/, "hidden slides get a class, not an unmount");
  assert.match(src, /aria-hidden=\{hidden \|\| undefined\}/, "hidden slides are hidden from AT too");
  // Slides must not be conditionally unmounted by index.
  assert.doesNotMatch(src, /\{trendIdx === \d+ \? </, "trend slides never unmount");
  assert.doesNotMatch(src, /\{chartIdx === \d+ \? </, "chart slides never unmount");
  assert.match(css, /\.familiar-analytics-tab__slide \{[^}]*grid-area: 1 \/ 1/, "slides stack on one grid cell");
  assert.match(css, /\.familiar-analytics-tab__slide\.is-hidden \{[^}]*visibility: hidden/, "hidden = visibility, not display");
});

test("carousel chrome: caret IconButtons + labeled dot buttons", () => {
  assert.match(src, /icon="ph:caret-left"[\s\S]{0,120}?aria-label="Previous trend"/, "trend prev caret");
  assert.match(src, /icon="ph:caret-right"[\s\S]{0,120}?aria-label="Next trend"/, "trend next caret");
  assert.match(src, /icon="ph:caret-left"[\s\S]{0,120}?aria-label="Previous chart"/, "chart prev caret");
  assert.match(src, /icon="ph:caret-right"[\s\S]{0,120}?aria-label="Next chart"/, "chart next caret");
  assert.match(src, /<button[\s\S]{0,200}?aria-label=\{label\}/, "dots are real buttons with per-slide labels");
  assert.match(src, /aria-current=\{i === index \|\| undefined\}/, "active dot exposed to AT");
});

test("charts derive from real model fields with honest empty state", () => {
  assert.match(src, /recentSessions\.length === 0 \?[\s\S]{0,300}?Charts appear once this familiar has run a session\./,
    "one honest empty state replaces the whole charts area");
  assert.match(src, /sessionOutcome\(session\.status\)/, "outcomes classified from real session statuses");
  assert.match(src, /heatmapFromSessions\(recentSessions\)/, "heatmap bucketed from real created_at timestamps");
  assert.match(src, /barsByProject\(recentSessions\)/, "bars split by real project_root basenames");
  assert.match(src, /color-mix\(in oklch, var\(--accent-presence\) \$\{pct\}%, transparent\)/,
    "heat ramp mixes accent-presence per the design");
  assert.match(src, /\$\{cell\.value\} session\$\{cell\.value === 1 \? "" : "s"\}/, "cell titles name real counts");
});

test("recent runs preserve the /#chat- drill-through and real timing", () => {
  assert.match(src, /href=\{`\/#chat-\$\{encodeURIComponent\(session\.id\)\}`\}/, "rows drill into the chat thread");
  assert.match(src, /relativeTime\(session\.updated_at\)/, "'when' column is the real timestamp");
  assert.match(src, /function runDuration\(session: SessionRow\)/, "duration derived from created_at→updated_at");
  assert.match(src, /if \(ms < 1000\) return null/, "degenerate durations are omitted, not faked");
  assert.match(src, /<LifecycleBadge lifecycle=\{lifecycle\} \/>/, "status renders through the shared badge");
});

test("styling: new stylesheet, non-colliding BEM prefix, tokens only", () => {
  assert.match(src, /import "@\/styles\/familiar-tab-analytics\.css"/, "component imports its own stylesheet");
  assert.doesNotMatch(css, /\.familiar-analytics__/, "does not collide with the dashboard analytics prefix");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded hex colors — tokens only");
  assert.match(css, /\.familiar-analytics-tab__kpi-label \{[^}]*text-transform: uppercase/, "uppercase KPI labels");
  assert.match(css, /minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/, "1.6fr/1fr card grid per the design");
});
