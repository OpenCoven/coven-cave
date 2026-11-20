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
assert.match(source, /resolveDownloadUrls/, "resolves direct installer downloads from the release assets");
assert.match(source, /downloads:/, "returns the per-platform installer download map");

console.log("app/latest-release route.test.ts: ok");


// Exercise the real route and classifier; only upstream GitHub transport is
// replaced. Advancing the clock crosses the production cache lifetime.
const { GET } = await import("./route.ts");
const { classifyFallbackReleaseCheck } = await import("../../../../lib/app-update.ts");
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = 1_800_000_000_000;
Date.now = () => now;
let calls = 0;
let release = { tag_name: "v99.0.0", body: "## Release\nUnicode ✓ <b>literal</b>", assets: [] };
globalThis.fetch = async () => { calls++; return Response.json(release); };
try {
  const first = await (await GET()).json();
  assert.equal(first.notes, "## Release\nUnicode ✓ <b>literal</b>");
  const parsed = classifyFallbackReleaseCheck(true, first);
  assert.equal(parsed.kind, "available");
  assert.equal(parsed.status.notes, first.notes);
  await GET();
  assert.equal(calls, 1, "release notes share the existing metadata cache");
  for (const body of [null, "", "  ", { bad: true }]) {
    now += 600_001;
    release = { ...release, body };
    const response = await (await GET()).json();
    assert.equal(response.notes, undefined);
    assert.equal(response.available, true);
  }
  now += 600_001;
  globalThis.fetch = async () => Response.json({ message: "rate limited" }, { status: 403 });
  const failed = await (await GET()).json();
  assert.equal(failed.available, false);
  assert.equal(failed.notes, undefined);
  assert.equal(classifyFallbackReleaseCheck(true, failed).kind, "unavailable");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
