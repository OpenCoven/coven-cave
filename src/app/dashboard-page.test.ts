// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./dashboard/page.tsx", import.meta.url);

assert.equal(existsSync(pageUrl), true, "dashboard route should exist at /dashboard");

const page = existsSync(pageUrl) ? readFileSync(pageUrl, "utf8") : "";

assert.match(page, /loadInbox/, "dashboard should load persisted inbox data");
assert.match(page, /liveSnapshot/, "dashboard should compute a live snapshot");
assert.match(page, /recentReports/, "dashboard should list recent daily reports");
assert.match(
  page,
  /href=\{(featuredReport|report)\.href\}/,
  "dashboard should link to a daily report via the report href",
);
assert.match(page, /dr-cta/, "dashboard should feature a primary report CTA");
assert.match(page, /Needs attention/, "dashboard should surface an actionable needs-attention list");
assert.match(page, /dr-page/, "dashboard should use the shared surface styling");

console.log("dashboard-page.test.ts: ok");
