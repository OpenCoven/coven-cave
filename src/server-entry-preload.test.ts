import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(config, /preloadEntriesOnStart: false,/);
assert.doesNotMatch(server, /unstable_preloadEntries|scheduleDeferredEntryPreload/);
// Next discovers instrumentation beside src/app, not at the repository root.
assert.ok(existsSync(new URL("./instrumentation.ts", import.meta.url)));
assert.ok(!existsSync(new URL("../instrumentation.ts", import.meta.url)));
console.log("server-entry-preload.test.ts: ok");

assert.match(config, /outputFileTracingExcludes: \{[\s\S]*?"\*": \[/, "non-route instrumentation shares the runtime tracing boundary");
