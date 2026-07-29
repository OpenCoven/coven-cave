// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./daily-report/[date]/page.tsx", import.meta.url);

assert.equal(existsSync(pageUrl), true, "daily report route should exist at /daily-report/[date]");

const page = existsSync(pageUrl) ? readFileSync(pageUrl, "utf8") : "";
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const view = read("../components/daily-report-day.tsx");
const carousel = read("../components/daily-report-carousel.tsx");
const shipped = read("../components/daily-report-shipped.tsx");
const modals = read("../components/daily-report-modals.tsx");

// ── data contract (preserved verbatim through the redesign) ─────────────────
// These pin how the report RESOLVES its facts. The presentation below was
// rebuilt for the "chaptered day" handoff; this half must not drift with it.

assert.match(page, /loadInbox/, "daily report page should load persisted inbox data");
assert.match(page, /daily-summary:\$\{date\}/, "daily report page should resolve the daily summary by auto key");
assert.match(page, /Daily report not found/, "daily report page should have an empty/not-found state");
assert.match(page, /breakdownForDay/, "report should compute the live per-day breakdown");
assert.match(page, /item\.media\?\.report/, "report should read the structured day-in-review facts");
assert.match(page, /media\?\.narrative\?\.text/, "report should lead with the familiar-written narrative when present");
assert.match(
  page,
  /extractNextPaths\(rawNarrative\)\.visible/,
  "narrative render should exclude the piggybacked next-paths suggestions block",
);
assert.match(page, /href="\/dashboard"/, "report should link back to the dashboard");
assert.match(page, /dr-page/, "report should keep the shared daily-report surface styling hook");
assert.match(
  page,
  /item\.media\?\.imageUrl/,
  "the frozen generated card must still reach the share surface",
);
assert.match(
  page,
  /Written by/,
  "narrative should carry a familiar attribution byline",
);

// ── the chaptered day (redesign contract) ──────────────────────────────────

assert.match(page, /buildDayModel/, "page should derive the day model rather than hand-rolling stats");
assert.match(page, /<DailyReportDay/, "page should render the chaptered-day view");
assert.doesNotMatch(
  page,
  /MetricCard|ShippedTable/,
  "the retired metric-card / shipped-table components must not come back",
);

// The week strip navigates by date slug rather than mutating state.
assert.match(view, /\/daily-report\/\$\{day\.slug\}/, "week strip cells link to their day's report");
assert.match(view, /prevWeekSlug|nextWeekSlug/, "week strip pages through weeks");

// Chapters rewrite the page and dim the rest of the spine — the core of 2a.
assert.match(view, /CHAPTERS/, "the rail is labelled CHAPTERS");
assert.match(view, /THE SPINE/, "the written page carries the time spine");
assert.match(view, /data-dim=\{dimmed/, "spine events dim when a chapter is selected");
assert.match(
  view,
  /onClick=\{\(\) => setChapter\(e\.chapterIndex\)\}/,
  "clicking a spine line selects the chapter it belongs to",
);
// A 33-merge day must read as a story, not a changelog.
assert.match(
  read("../lib/daily-report-day.ts"),
  /SPINE_MERGE_DETAIL_LIMIT/,
  "the spine collapses a chapter's merges once there are more than a couple",
);

// Inline overlay panels: Escape and click-away, keyed off the panel markers.
assert.match(view, /data-panel-trigger/, "click-away must ignore clicks on a panel trigger");
assert.match(view, /\[data-panel\]/, "click-away must ignore clicks inside a panel");
assert.match(view, /Escape/, "Escape closes the top-most layer");
assert.match(carousel, /data-panel="carousel"/, "the carousel panel is click-away aware");
assert.match(shipped, /data-panel="shipped"/, "the shipped panel is click-away aware");

// Honest degradation — the report must never invent numbers it does not hold.
assert.match(shipped, /additions == null/, "PRs with no session render — for lines, never +0 −0");
assert.match(carousel, /model\.quiet/, "a quiet day swaps the charts for an empty state");
assert.match(view, /no line counts/, "cast members without line counts say so");

// The share card reuses the frozen image when one exists.
assert.match(modals, /shareImageUrl/, "the share modal renders the frozen generated card");

// ── theme safety ───────────────────────────────────────────────────────────
// This surface ships beside 21 themes × 2 modes. A literal color from the
// mock would break the other 41 combinations, so the sheets must be
// token-only. (`black`/`white` are sanctioned mix anchors, not colors.)

for (const sheet of [
  "daily-report-day.css",
  "daily-report-carousel.css",
  "daily-report-shipped.css",
  "daily-report-modals.css",
]) {
  const css = read(`../styles/${sheet}`);
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hex, [], `${sheet} must not hardcode a hex color`);
  const oklch = css.match(/oklch\(\s*[\d.]/g) ?? [];
  assert.deepEqual(oklch, [], `${sheet} must not hardcode a literal oklch color`);
  assert.match(
    css,
    /:focus-visible/,
    `${sheet} must carry the accent focus ring the design system asks for`,
  );
}

console.log("daily-report-page.test.ts: ok");
