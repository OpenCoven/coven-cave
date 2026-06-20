// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./dashboard/page.tsx", import.meta.url);
assert.equal(existsSync(pageUrl), true, "dashboard route should exist at /dashboard");
const page = readFileSync(pageUrl, "utf8");

assert.match(page, /loadInbox/, "dashboard should load persisted inbox data");
assert.match(page, /buildDashboardModel/, "dashboard should build the view-model");
assert.match(page, /DashboardView/, "dashboard should render the adaptive view");
assert.match(page, /dr-page/, "dashboard should use the shared surface styling");

const viewUrl = new URL("../components/dashboard/dashboard-view.tsx", import.meta.url);
assert.equal(existsSync(viewUrl), true, "DashboardView component should exist");
const view = readFileSync(viewUrl, "utf8");
assert.match(view, /dashboardLayout/, "view should order zones via dashboardLayout");
assert.match(view, /ActionInbox/, "view should include the action inbox zone");
assert.match(view, /LauncherGrid/, "view should include the launcher zone");
assert.match(view, /MetricsStrip/, "view should include the day-at-a-glance metrics");
assert.match(view, /TodaySummary/, "view folds today's daily summary into the dashboard");

console.log("dashboard-page.test.ts: ok");
