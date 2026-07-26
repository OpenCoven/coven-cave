// Source-contract test for n8n-style temporary test webhook endpoints.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listenRoute = readFileSync(new URL("./listen/route.ts", import.meta.url), "utf8");
const catchAllRoute = readFileSync(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const baseRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(listenRoute, /registerTestWebhook/, "listen route registers a temporary test webhook");
assert.match(listenRoute, /rejectNonLocalRequest/, "listen registration is local-only");
assert.match(listenRoute, /triggerId/, "listen registration targets the selected webhook node");
assert.match(catchAllRoute, /findTestWebhook/, "test webhook calls resolve through the temporary registry");
assert.match(catchAllRoute, /startFlowSession/, "test webhook calls execute through the shared session executor");
assert.match(catchAllRoute, /mode: "manual"/, "test webhook calls should keep manual-mode pinned data semantics");
assert.match(catchAllRoute, /triggerInput/, "test webhook calls pass request data into the flow prompt");
assert.doesNotMatch(catchAllRoute, /rejectNonLocalRequest/, "registered test webhook URLs are externally callable during their listen window");
assert.match(baseRoute, /from "\.\/\[\.\.\.path\]\/route"/, "root test webhook path uses the same handler");

console.log("flows webhook-test route.test.ts: ok");
