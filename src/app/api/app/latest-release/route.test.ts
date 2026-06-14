// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /releases\/latest/, "queries the GitHub latest-release endpoint");
assert.match(source, /APP_VERSION/, "reports the running app version");
assert.match(source, /isUpdateAvailable/, "decides availability via the shared semver compare");
assert.match(source, /AbortSignal\.timeout/, "bounds the GitHub fetch with a timeout");
assert.match(source, /catch\s*\(/, "fails soft on network/error (never surfaces a false update)");
assert.match(source, /TTL_MS|cache/, "caches the result to avoid GitHub rate limits");

console.log("app/latest-release route.test.ts: ok");
