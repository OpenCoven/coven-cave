// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./daily-report/[date]/page.tsx", import.meta.url);

assert.equal(existsSync(pageUrl), true, "daily report route should exist at /daily-report/[date]");

const page = existsSync(pageUrl) ? readFileSync(pageUrl, "utf8") : "";

// Data resolution + frozen image/body (preserved through the overhaul).
assert.match(page, /loadInbox/, "daily report page should load persisted inbox data");
assert.match(page, /daily-summary:\$\{date\}/, "daily report page should resolve the daily summary by auto key");
assert.match(page, /<img[\s\S]*src=\{item\.media\.imageUrl\}/, "daily report page should render the generated summary image");
assert.match(page, /whiteSpace:\s*"pre-line"/, "daily report page should preserve summary body line breaks");
assert.match(page, /Daily report not found/, "daily report page should have an empty/not-found state");

// World-class overhaul: metric cards, live actionable lists, dashboard link.
assert.match(page, /MetricCard/, "report should render headline metric cards");
assert.match(page, /breakdownForDay/, "report should compute the live per-day breakdown");
assert.match(page, /Needs attention/, "report should surface an actionable needs-attention list");
assert.match(page, /ItemRow/, "report should render deep-linkable item rows");
assert.match(page, /href="\/dashboard"/, "report should link back to the dashboard");
assert.match(page, /dr-page/, "report should use the shared daily-report surface styling");

console.log("daily-report-page.test.ts: ok");
