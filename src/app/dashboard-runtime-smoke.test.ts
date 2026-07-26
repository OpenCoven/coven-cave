// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./dashboard/page.tsx", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../lib/cave-inbox.ts", import.meta.url), "utf8");

assert.match(page, /export const dynamic = "force-dynamic"/, "dashboard is explicitly dynamic");
assert.match(page, /await loadInbox\(\)/, "dashboard server render reads the inbox once");
assert.match(inbox, /export async function loadInbox/, "loadInbox is the direct server read for dashboard data");
assert.doesNotMatch(page, /startScheduler\(/, "dashboard render must not start long-lived schedulers");
assert.doesNotMatch(page, /fetch\(/, "dashboard server render must not block on client data endpoints");

console.log("dashboard-runtime-smoke.test.ts: ok");
