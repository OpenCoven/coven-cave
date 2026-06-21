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

console.log("dashboard-page.test.ts: ok");
