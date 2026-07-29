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
assert.match(page, /DailyReportEmpty/, "daily report page should render the no-report state");
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
  /setChapter\(e\.chapterIndex\)/,
  "a spine line that stands for several merges selects the chapter it belongs to",
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

// ── one screen at md and up ────────────────────────────────────────────────
// The report is a single screen from 768px: the page itself must not scroll,
// the columns take their own scrollbars instead. `.dr-page` is its own scroll
// container nested inside `.aps-main`, so the lock has to clamp the day
// variant or the outer pane picks the scroll back up.

{
  const css = read("../styles/daily-report-day.css");
  const md = css.match(/@media \(min-width: 768px\)\s*\{[\s\S]*?\n\}/);
  assert.ok(md, "daily-report-day.css must carry a min-width: 768px block");
  assert.match(md[0], /\.dr-page--day\s*\{[^}]*overflow:\s*hidden/, "the day page must not scroll at md+");
  assert.match(md[0], /\.dr-page--day \.drd\b[^{]*\{[^}]*min-height:\s*0/, "the card must be allowed to shrink");
  assert.match(md[0], /\.dr-page--day \.drd-body[^{]*\{[^}]*(flex|overflow)/, "the body row absorbs the leftover height");
  // Below md the page scrolls normally — that is correct for a phone. Scope
  // the check to the mobile block itself by brace-matching; a loose regex
  // here just reaches forward into the md block and always "passes".
  const blockAt = (source, header) => {
    const start = source.indexOf(header);
    if (start === -1) return "";
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    return "";
  };
  const mobile = blockAt(css, "@media (max-width: 760px)");
  assert.ok(mobile, "the mobile band block should still exist");
  assert.doesNotMatch(mobile, /overflow:\s*hidden/, "the mobile band must keep its normal page scroll");
  assert.match(
    css,
    /@media \(min-width: 1025px\)[\s\S]*?\.dr-page--day \.drd-rail/,
    "from lg each column takes its own scrollbar",
  );
}

// ── the week strip never pages into the future ─────────────────────────────

assert.match(page, /const canGoForward = dateSlug\(day\) < todaySlug/, "forward paging stops at the current week");
assert.match(
  page,
  /dateSlug\(nextWeek\) > todaySlug \? todaySlug : dateSlug\(nextWeek\)/,
  "the last forward step clamps to today rather than overshooting",
);
assert.match(page, /isFuture,/, "week cells know whether they are in the future");
assert.match(view, /canGoForward \?/, "the next-week control is dead on the current week");
assert.match(view, /day\.isFuture \?/, "a future day renders as a dead cell, not a link");
assert.match(
  view,
  /<span(?=[^>]*className="drd-week__step")(?=[^>]*data-disabled)(?=[^>]*aria-disabled="true")[^>]*>/,
  "the disabled next-week branch renders as a non-link step with disabled semantics",
);
assert.match(
  view,
  /aria-label="Next week unavailable: this is the current week"/,
  "the disabled next-week step has an accessible name explaining why it is disabled",
);
assert.match(
  read("../styles/daily-report-day.css"),
  /\.drd-week__step:not\(\[data-disabled\]\):hover/,
  "the disabled next-week step keeps its tooltip without enabled-link hover styling",
);

// ── PR detail reuses the app's own GitHub card ─────────────────────────────
// The report must not grow a second GitHub client, and must not bounce the
// reader to github.com for something the app already renders richly.

{
  const prModal = read("../components/daily-report-pr-modal.tsx");
  assert.match(prModal, /from "@\/components\/github-card"/, "the PR overlay mounts the app's GitHubCard");
  assert.match(prModal, /kind: "pr"/, "it asks the card for a pull request");
  assert.match(prModal, /useFocusTrap/, "the overlay traps focus like the report's other dialogs");
  assert.doesNotMatch(prModal, /api\/github\//, "the overlay must not fetch PR data itself — the card owns that");

  // Shipped rows open it rather than leaving the app.
  assert.match(shipped, /onOpenPr/, "shipped rows can open the in-app PR card");
  assert.match(view, /DailyReportPrModal/, "the report shell mounts the PR overlay");
  assert.match(view, /setPr\(\{ repo: row\.repo/, "a shipped row opens its own PR");
  // Escape unwinds the layer stack top-down.
  assert.match(view, /setPr\(\(current\) => \{/, "Escape closes the PR card before the dialogs and panels");
  // A spine line standing for one merge carries the PR through the model.
  assert.match(
    read("../lib/daily-report-day.ts"),
    /pr\?: \{ repo: string; number: number \}/,
    "the model carries PR identity so surfaces can open the card",
  );
}

// ── the no-report day is recoverable, not a dead end ───────────────────────
// Past days still have their facts on disk (sessions, merged PRs, board
// cards, rituals), so the empty state offers to build the report rather than
// telling the reader it happens automatically — which is only true of today.

{
  const empty = read("../components/daily-report-empty.tsx");
  assert.match(empty, /backfill: !isToday/, "a past day is generated as an explicit backfill");
  assert.match(empty, /\/api\/sessions\/list/, "backfill reuses the enriched session list, not a second query");
  assert.match(empty, /isFuture/, "a day that hasn't happened is never offered a generate button");
  assert.match(empty, /kind: "empty"/, "an honestly empty day says so instead of reporting failure");

  const route = read("../app/api/inbox/daily-summary/route.ts");
  // The midnight-rollover guard must survive: only an EXPLICIT backfill may
  // target another day, and never a future one.
  assert.match(route, /body\.backfill !== true/, "the automatic path keeps the midnight-rollover guard");
  assert.match(route, /requestedSlug > todaySlug/, "a future date is refused");
  assert.match(route, /now: target/, "the report is built for the requested day, not today");
  assert.match(route, /dailySummaryAutoKey\(target\)/, "the item is keyed to the requested day");
  assert.match(route, /fetchMergedPrsForDay\(target\)/, "merged PRs are fetched for the requested day");
}

// ── theme safety ───────────────────────────────────────────────────────────
// This surface ships beside 12 themes × 2 modes. A literal color from the
// mock would break the other 23 combinations, so the sheets must be
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
