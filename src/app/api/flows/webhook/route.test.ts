// Source-contract test for the catch-all production webhook route. The dynamic
// route file is difficult to instantiate without Next's request wrapper, so
// this locks in the behavior-bearing seams.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const baseRoute = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /findWebhookFlow/, "route finds a saved active webhook flow by method/path");
assert.match(source, /startFlowSession/, "route starts the matched flow through the shared session executor");
assert.match(source, /mode: "production"/, "production webhooks must execute in production mode");
assert.match(source, /triggerInput/, "route passes request data into the compiled flow prompt");
assert.match(source, /export\s*\{\s*handleWebhook\s+as\s+GET[\s\S]*handleWebhook\s+as\s+POST/, "route handles common webhook HTTP verbs");
assert.doesNotMatch(source, /rejectNonLocalRequest/, "production webhooks are externally callable when a flow is active");
assert.match(baseRoute, /from "\.\/\[\.\.\.path\]\/route"/, "root webhook path uses the same handler as path-based webhooks");

console.log("flows webhook route.test.ts: ok");
