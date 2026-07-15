// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./dashboard/page.tsx", import.meta.url);
assert.equal(existsSync(pageUrl), true, "dashboard route should exist at /dashboard");
const page = readFileSync(pageUrl, "utf8");

assert.match(page, /loadInbox/, "dashboard should load persisted inbox data");
assert.match(page, /buildDashboardModel/, "dashboard should build the view-model");
assert.match(page, /DashboardCockpit/, "dashboard should render the power cockpit");
assert.match(page, /dr-page/, "dashboard should use the shared surface styling");

const cockpitUrl = new URL("../components/dashboard/dashboard-cockpit.tsx", import.meta.url);
assert.equal(existsSync(cockpitUrl), true, "DashboardCockpit component should exist");
// The cockpit is split across the data/layout root, the presentational panel
// layer, the pure label helpers (cave-tsoz), and the contract-fetch hook
// (cave-hwux) — this contract covers the whole surface, so read the split as
// one source.
const cockpit = [
  readFileSync(cockpitUrl, "utf8"),
  readFileSync(new URL("../components/dashboard/cockpit-panels.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../lib/dashboard-cockpit-format.ts", import.meta.url), "utf8"),
  readFileSync(new URL("../lib/use-familiar-contracts.ts", import.meta.url), "utf8"),
].join("\n");

// The cockpit folds the original triage/summary zones in…
assert.match(cockpit, /ActionInbox/, "cockpit keeps the action inbox (triage) panel");
assert.match(cockpit, /TodaySummary/, "cockpit folds in today's daily summary");
assert.match(cockpit, /RecentReports/, "cockpit keeps recent daily reports");
// …and pulls the full set of live data sources for a power cockpit.
assert.match(cockpit, /\/api\/board/, "cockpit pulls the board snapshot");
assert.match(cockpit, /\/api\/familiars/, "cockpit pulls the familiar roster");
assert.match(cockpit, /\/api\/github/, "cockpit pulls GitHub activity");
assert.match(cockpit, /\/api\/sessions\/list/, "cockpit pulls sessions for usage analytics");
assert.match(cockpit, /\/api\/coven-memory/, "cockpit pulls coven memory so confidence/freshness are real");
assert.doesNotMatch(cockpit, /\/api\/library\/reading/, "integrated cockpit should not pull the feature-branch Library queue");
assert.match(cockpit, /cockpit-kpis/, "cockpit renders the vitals KPI rail");

// World-class additions
assert.match(cockpit, /DonutChart/, "board status uses a donut chart");
assert.match(cockpit, /familiarMiniProfiles/, "familiars panel shows per-familiar trends");
assert.match(cockpit, /familiarLoadSeries/, "renders a familiar-load trend panel");
assert.match(cockpit, /usePausablePoll/, "cockpit polls for live updates");
assert.doesNotMatch(cockpit, /\?view=evals/, "dead ?view=evals link removed");

// Predictive signals strip + confidence heatmap (deferred from #2098).
assert.match(cockpit, /dashboardSignals/, "cockpit derives predictive signals");
assert.match(cockpit, /case "signals"/, "a Signals panel is wired into the layout switch");
assert.match(cockpit, /case "confidence"/, "a Confidence/performance panel is wired into the layout switch");
assert.match(cockpit, /Heatmap/, "confidence renders the visx heatmap primitive");
assert.match(cockpit, /deriveConfidenceScore/, "confidence reuses the shared scoring helper");
assert.match(cockpit, /deriveGrowthReport/, "confidence composes the growth report for scoring");
assert.match(cockpit, /\/api\/retro-runs/, "confidence pulls the shared retro-runs snapshot");
assert.match(cockpit, /\/api\/familiars\/\$\{encodeURIComponent\(id\)\}\/contract/, "confidence pulls each familiar's contract");
assert.match(
  readFileSync(cockpitUrl, "utf8"),
  /useFamiliarContracts\(data\.familiars\)/,
  "the root sources contracts/retro through the extracted hook (cave-hwux), not an inline effect",
);

// ── Insights reframe: the dashboard leads with coven-wide analytics ──

// Plain-language coven read + coven-wide aggregations (pure, unit-tested).
assert.match(cockpit, /deriveCovenVitals/, "cockpit rolls per-familiar rows into coven vitals");
assert.match(cockpit, /deriveCovenInsight/, "cockpit derives the plain-language coven insight");
assert.match(cockpit, /covenSessionsSeries/, "cockpit builds the coven usage-over-time series");
assert.match(cockpit, /CovenInsightBanner/, "the coven insight is rendered as a banner");
assert.match(cockpit, /buildFamiliarCardStats/, "per-familiar activity stats feed the insight rows");

// The centerpiece: a scannable per-familiar insights table (confidence, health,
// usage, contract) — beginners scan it; power users drill each row through.
assert.match(cockpit, /FamiliarInsightsTable/, "renders the familiar insights table");
assert.match(cockpit, /cockpit-fam/, "the insights table has its own layout class");
assert.match(cockpit, /case "usage"/, "a usage-over-time panel is wired into the layout switch");

// Vitals KPIs are analytics figures, not just workload queues.
assert.match(cockpit, /Coven confidence/, "a coven-confidence vital is surfaced");
assert.match(cockpit, /Active familiars/, "an active-familiars vital is surfaced");
assert.match(cockpit, /Sessions · 7d/, "a weekly-sessions usage vital is surfaced");
assert.match(cockpit, /Retro accept rate/, "a retro accept-rate performance vital is surfaced");
assert.match(cockpit, /Contract health/, "a contract-health performance vital is surfaced");
assert.match(cockpit, /Needs you/, "the attention vital is kept");
assert.match(cockpit, /contractFetchPartial/, "capped contract/confidence KPI coverage is explicitly tracked");
assert.match(cockpit, /first \$\{fetched\}\/\$\{total\} \$\{verb\}/, "partial KPI subtitles show first-N familiar coverage");
assert.match(cockpit, /familiarsLoaded: ready\.has\("familiars"\)/, "empty-coven insight is gated until familiars load");

// ── Truthful freshness + drill-throughs everywhere ──

// The "Updated…" pill reflects when fetched data actually LANDED (not render
// time), ticks between polls, and doubles as a manual refresh.
assert.match(cockpit, /const \[lastUpdated, setLastUpdated\] = useState<Date \| null>\(null\)/, "freshness is stamped from real data arrivals");
assert.match(cockpit, /setLastUpdated\(new Date\(\)\)/, "each landing fetch bumps the freshness stamp");
assert.match(cockpit, /useMinuteTick\(\)/, "the freshness label ticks between polls");
assert.match(cockpit, /className="cockpit-pill cockpit-pill--refresh"[\s\S]{0,80}onClick=\{load\}/, "the freshness pill is the manual refresh button");
assert.doesNotMatch(cockpit, /Updated \{relativeTime\(now\.toISOString\(\)/, "the pill no longer reads the static render time (was pinned at 'just now')");

// Dead links are gone: KPI tiles, panels, and quick links all deep-link to the
// surface that owns the number (`/?mode=<WorkspaceMode>` is the SPA deep link).
assert.doesNotMatch(cockpit, /href: "\/#card-"/, "KPI tiles no longer point at the dead bare /#card- hash");
assert.doesNotMatch(cockpit, /href: "\/\?mode=library"/, "integrated cockpit should not route to the feature-branch Library");
assert.match(cockpit, /href: "\/dashboard\/familiars\/growth"/, "performance vitals drill into the growth page");
assert.match(cockpit, /href: "\/\?mode=agents"/, "usage vitals drill into the familiars roster");
assert.match(cockpit, /href="\/\?mode=board"/, "the board panel drills into the board");
assert.match(cockpit, /href="\/\?mode=github"/, "the GitHub panel drills into GitHub");
assert.match(cockpit, /href="\/\?mode=calendar"/, "the agenda panel drills into the calendar");
assert.match(cockpit, /href="\/\?mode=agents"/, "the familiars panel drills into the roster");
assert.match(cockpit, /href="\/dashboard\/familiars\/growth"/, "load/confidence drill into the growth page");
assert.doesNotMatch(cockpit, /QuickLink href="\/" icon="ph:calendar-bold"/, "the Calendar quick link no longer dead-ends at /");
assert.doesNotMatch(cockpit, /icon="ph:books-bold" label="Library"/, "Library quick link is isolated to feature/library");

// Rows are destinations, not dead ends.
assert.match(cockpit, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(f\.id\)\}\/analytics`\}/, "familiar rows open the familiar's analytics");
assert.match(cockpit, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(r\.id\)\}\/analytics`\}/, "insight/confidence rows open the familiar's analytics");
assert.match(cockpit, /s\.href \?/, "actionable signals render as links");
assert.match(cockpit, /openExternalUrl\(s\.href!\)/, "external signal links route through the external-URL helper");

// Signals stay scannable: the list is capped and the overflow drills through.
assert.match(cockpit, /const SIGNALS_CAP = 8/, "signals panel caps the visible list");
assert.match(cockpit, /signals\.slice\(0, SIGNALS_CAP\)/, "only the top signals render");
assert.match(cockpit, /\+\{hidden\} more — review on the GitHub surface/, "overflow collapses into a drill-through row");

// KPI deltas carry meaning, not just direction: each vital declares the
// direction that reads as "good", so a rise in confidence is colored as
// progress while a rise in "Needs you" is colored as load.
assert.match(cockpit, /good: "up"/, "vitals declare their beneficial direction");
assert.match(cockpit, /good: "down"/, "the attention vital's beneficial direction is down");
assert.match(cockpit, /cockpit-kpi__delta--\$\{beneficial \? "good" : "bad"\}/, "delta color reflects benefit, not raw direction");

// Action inbox supports bulk triage: select several items → done/dismiss/snooze together.
const inboxUrl = new URL("../components/dashboard/action-inbox.tsx", import.meta.url);
const inbox = readFileSync(inboxUrl, "utf8");
assert.match(inbox, /const \[selectMode, setSelectMode\] = useState\(false\)/, "action inbox has a select mode");
assert.match(inbox, /const \[selectedIds, setSelectedIds\] = useState<Set<string>>/, "selected ids live in a Set");
assert.match(inbox, /async function bulkAct\(action: Action, minutes = 60\)/, "a bulk action applies to every selected item");
assert.match(inbox, /Promise\.all\(\s*ids\.map\(\(id\) => fetch\(`\/api\/inbox\/\$\{id\}\/\$\{action\}`/, "bulk action POSTs each item in parallel");
assert.match(inbox, /onClick=\{selectMode \? \(\) => toggleSelect\(item\.id\) : undefined\}/, "rows select on click in select mode");
assert.match(inbox, /\{allSelected \? "Clear" : "Select all"\}/, "the bulk bar offers select-all / clear");
assert.match(inbox, /onClick=\{\(\) => void bulkAct\("done"\)\}/, "bulk Done is wired");
assert.match(inbox, /void bulkAct\("snooze", minutes\)/, "bulk Snooze is wired through the menu");

// ── cave-89b close-out: sortable/filterable tables + space usage + hoverable charts ──

// The centerpiece table is sortable (accessible headers) and filterable.
assert.match(cockpit, /sortInsightRows/, "insights table sorts through the pure helper");
assert.match(cockpit, /filterInsightRows/, "insights table filters through the pure helper");
assert.match(cockpit, /defaultInsightOrder/, "unsorted table keeps the curated ranking");
assert.match(cockpit, /aria-sort=\{ariaSort\("confidence"\)\}/, "sortable headers expose aria-sort");
assert.match(cockpit, /cockpit-sorthead/, "column headers are real buttons, not dead labels");
assert.match(cockpit, /Filter familiars by name, role, or health/, "the filter input is labelled for AT");

// Space usage: bounded local scan → sortable rows with cleanup drill-throughs.
assert.match(cockpit, /\/api\/space-usage/, "cockpit pulls the bounded space-usage scan");
assert.match(cockpit, /case "space"/, "a Space usage panel is wired into the layout switch");
assert.match(cockpit, /SpaceUsagePanel/, "renders the space usage panel");
assert.match(cockpit, /sortSpaceRows/, "space rows sort through the pure helper");
assert.match(cockpit, /spaceUsageRows/, "space rows derive share + cleanup destinations");
assert.match(cockpit, /formatBytes/, "sizes render as human-readable bytes");

const spaceRouteUrl = new URL("./api/space-usage/route.ts", import.meta.url);
assert.equal(existsSync(spaceRouteUrl), true, "space-usage API route exists");
const spaceRoute = readFileSync(spaceRouteUrl, "utf8");
assert.match(spaceRoute, /collectSpaceUsage/, "route delegates to the bounded server scanner");
assert.match(spaceRoute, /force-dynamic/, "space-usage snapshot is never statically cached");

// Diagrams expose hover/focus details and accessible summaries.
const donut = readFileSync(new URL("../components/ui/charts/donut-chart.tsx", import.meta.url), "utf8");
assert.match(donut, /<title>/, "donut slices carry native hover titles");
assert.match(donut, /role: "img"/, "donut can expose an accessible summary");
const heatmap = readFileSync(new URL("../components/ui/charts/heatmap.tsx", import.meta.url), "utf8");
assert.match(heatmap, /<title>/, "heatmap cells carry native hover titles");
assert.match(heatmap, /role: "img"/, "heatmap can expose an accessible summary");
assert.match(cockpit, /ariaLabel=\{`Board status:/, "board donut passes a data summary to AT");
assert.match(cockpit, /ariaLabel=\{`Confidence factors by familiar:/, "confidence heatmap passes a data summary to AT");

// ── Drag a11y (cave-0k5b): titles, not ids ───────────────────────────────────
// dnd-kit's default announcements read the raw widget ids; the cockpit supplies
// its own with human panel titles + 1-based positions, and each grip names its
// panel instead of a generic "Drag to rearrange".
assert.match(cockpit, /const dragAnnouncements: Announcements = \{/, "cockpit defines custom drag announcements");
assert.match(cockpit, /accessibility=\{\{ announcements: dragAnnouncements \}\}/, "DndContext receives the custom announcements");
assert.match(cockpit, /moved to position \$\{pos\.index\} of \$\{pos\.count\}/, "drops announce the panel's new position");
assert.match(cockpit, /aria-label=\{`Drag to rearrange: \$\{title\}`\}/, "each grip names its panel");
// The titles map must cover every layout id, or announcements degrade to ids.
{
  const layoutIds = cockpit.match(/DEFAULT_LAYOUT: Layout = \{\s*main: \[([^\]]*)\],\s*rail: \[([^\]]*)\]/s);
  const ids = `${layoutIds[1]},${layoutIds[2]}`.match(/"([^"]+)"/g).map((q) => q.slice(1, -1));
  for (const id of ids) {
    assert.match(cockpit, new RegExp(`^  ${id}: "`, "m"), `PANEL_TITLES covers "${id}"`);
  }
}

// ── ActionInbox follows the cockpit's 30s repoll (cave-bzch) ─────────────────
// The widget froze on its mount-time copy; it now adopts each fresh
// needsAttention list, with locally-acted ids filtered until the incoming
// list confirms removal (a racing poll can't resurrect a cleared row).
{
  const inbox = readFileSync(new URL("../components/dashboard/action-inbox.tsx", import.meta.url), "utf8");
  assert.match(inbox, /setItems\(initialItems\.filter\(\(it\) => !actedIdsRef\.current\.has\(it\.id\)\)\)/, "prop updates sync into the widget minus acted ids");
  assert.match(inbox, /actedIdsRef\.current\.add\(item\.id\)/, "single actions register the acted id");
  assert.match(inbox, /ids\.forEach\(\(id\) => actedIdsRef\.current\.add\(id\)\)/, "bulk actions register acted ids");
}
// The workspace SSE 'updated' branch bails on content-equal echoes, so an
// optimistic complete/dismiss/snooze doesn't trigger one redundant re-render
// of every inboxItemsWithEphemeral consumer.
{
  const ws = readFileSync(new URL("../components/workspace.tsx", import.meta.url), "utf8");
  assert.match(ws, /if \(JSON\.stringify\(prev\[idx\]\) === JSON\.stringify\(e\.item\)\) return prev;/, "SSE update echoes keep the array identity");
  // Same guard for the reconnect path: a snapshot that matches current state
  // must not re-render every inboxItemsWithEphemeral consumer.
  assert.match(
    ws,
    /setInboxItems\(\(prev\) => \(arrayContentEqual\(prev, e\.items\) \? prev : e\.items\)\);/,
    "SSE reconnect snapshots keep the array identity when content-identical",
  );
}

// The dashboard's inline today-summary renders the stored narrative; legacy
// narratives may still carry the piggybacked <coven:next-paths> block, so the
// render must exclude it.
{
  const todaySummary = readFileSync(
    new URL("../components/dashboard/today-summary.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    todaySummary,
    /extractNextPaths\(summary\.narrative\.text\)\.visible/,
    "today-summary should exclude the next-paths suggestions block from the narrative",
  );
}

console.log("dashboard-page.test.ts: ok");
