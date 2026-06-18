// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pageUrl = new URL("./daily-report/[date]/page.tsx", import.meta.url);

assert.equal(existsSync(pageUrl), true, "daily report route should exist at /daily-report/[date]");

const page = existsSync(pageUrl) ? readFileSync(pageUrl, "utf8") : "";

assert.match(page, /loadInbox/, "daily report page should load persisted inbox data");
assert.match(page, /daily-summary:\$\{date\}/, "daily report page should resolve the daily summary by auto key");
assert.match(page, /<img[\s\S]*src=\{item\.media\.imageUrl\}/, "daily report page should render the generated summary image");
assert.match(page, /whiteSpace:\s*"pre-line"/, "daily report page should preserve summary body line breaks");
assert.match(page, /Daily report not found/, "daily report page should have an empty/not-found state");

console.log("daily-report-page.test.ts: ok");
