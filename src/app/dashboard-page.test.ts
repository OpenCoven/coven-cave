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
const cockpit = readFileSync(cockpitUrl, "utf8");

// The cockpit folds the original triage/summary zones in…
assert.match(cockpit, /ActionInbox/, "cockpit keeps the action inbox (triage) panel");
assert.match(cockpit, /TodaySummary/, "cockpit folds in today's daily summary");
assert.match(cockpit, /RecentReports/, "cockpit keeps recent daily reports");
// …and pulls the full set of live data sources for a power cockpit.
assert.match(cockpit, /\/api\/board/, "cockpit pulls the board snapshot");
assert.match(cockpit, /\/api\/familiars/, "cockpit pulls the agent roster");
assert.match(cockpit, /\/api\/github/, "cockpit pulls GitHub activity");
assert.match(cockpit, /\/api\/library\/reading/, "cockpit pulls the reading queue");
assert.match(cockpit, /cockpit-kpis/, "cockpit renders the KPI rail");

// World-class additions
assert.match(cockpit, /DonutChart/, "board status uses a donut chart");
assert.match(cockpit, /familiarMiniProfiles/, "agents panel shows per-familiar trends");
assert.match(cockpit, /familiarLoadSeries/, "renders a familiar-load trend panel");
assert.match(cockpit, /usePausablePoll/, "cockpit polls for live updates");
assert.doesNotMatch(cockpit, /\?view=evals/, "dead ?view=evals link removed");

// Predictive signals strip + confidence heatmap (deferred from #2098).
assert.match(cockpit, /dashboardSignals/, "cockpit derives predictive signals");
assert.match(cockpit, /case "signals"/, "a Signals panel is wired into the layout switch");
assert.match(cockpit, /case "confidence"/, "a Confidence panel is wired into the layout switch");
assert.match(cockpit, /Heatmap/, "confidence renders the visx heatmap primitive");
assert.match(cockpit, /deriveConfidenceScore/, "confidence reuses the shared scoring helper");
assert.match(cockpit, /deriveGrowthReport/, "confidence composes the growth report for scoring");
assert.match(cockpit, /\/api\/retro-runs/, "confidence pulls the shared retro-runs snapshot");
assert.match(cockpit, /\/api\/familiars\/\$\{encodeURIComponent\(f\.id\)\}\/contract/, "confidence pulls each familiar's contract");

// ── Minimal-yet-powerful pass: truthful freshness + drill-throughs everywhere ──

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
assert.match(cockpit, /href: "\/\?mode=board"/, "board KPIs drill into the board");
assert.match(cockpit, /href: "\/\?mode=github"/, "the PRs KPI drills into GitHub");
assert.match(cockpit, /href: "\/\?mode=library"/, "the reading KPI drills into the library");
assert.match(cockpit, /href="\/\?mode=calendar"/, "the agenda panel drills into the calendar");
assert.match(cockpit, /href="\/\?mode=agents"/, "the agents panel drills into the familiars roster");
assert.match(cockpit, /href="\/dashboard\/familiars\/growth"/, "load/confidence drill into the growth page");
assert.doesNotMatch(cockpit, /QuickLink href="\/" icon="ph:calendar-bold"/, "the Calendar quick link no longer dead-ends at /");
assert.doesNotMatch(cockpit, /QuickLink href="\/" icon="ph:books-bold"/, "the Library quick link no longer dead-ends at /");

// Rows are destinations, not dead ends.
assert.match(cockpit, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(f\.id\)\}\/analytics`\}/, "agent rows open the familiar's analytics");
assert.match(cockpit, /href=\{`\/dashboard\/familiars\/\$\{encodeURIComponent\(r\.id\)\}\/analytics`\}/, "confidence rows open the familiar's analytics");
assert.doesNotMatch(cockpit, /href=\{r\.url \|\| "#"\}/, "reading rows without a URL render as text, not a dead # link");
assert.match(cockpit, /s\.href \?/, "actionable signals render as links");
assert.match(cockpit, /openExternalUrl\(s\.href!\)/, "external signal links route through the external-URL helper");

// KPI deltas carry meaning, not just direction (all metrics are workload
// queues — rising is load, falling is relief).
assert.match(cockpit, /cockpit-kpi__delta--\$\{delta > 0 \? "up" : "down"\}/, "delta direction is a semantic class");

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

console.log("dashboard-page.test.ts: ok");
