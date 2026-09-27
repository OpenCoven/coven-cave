// @ts-nocheck
// #5641: /api/github/assigned answers repeat asks from a stale-while-revalidate
// cache instead of three live GitHub calls (2.9 s) on every launcher focus.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "github-assigned-cache-"));
process.env.HOME = home;
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = path.join(home, ".coven", "cave");
process.env.GITHUB_TOKEN = "test-token-assigned";

let calls = 0;
let failNext = false;
globalThis.fetch = async (url) => {
  calls += 1;
  if (failNext) return new Response("{}", { status: 500 });
  const body = String(url).includes("/search/") ? { total_count: 0, items: [] } : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const { GET } = await import("./route.ts");

const first = await GET();
assert.equal(first.status, 200);
assert.equal((await first.json()).configured, true);
assert.equal(calls, 3, "a first ask makes the three GitHub calls");

const second = await GET();
assert.equal((await second.json()).ok, true);
assert.equal(calls, 3, "a repeat ask inside the window is answered from memory");

const [a, b] = await Promise.all([GET(), GET()]);
assert.equal(a.status, 200);
assert.equal(b.status, 200);
assert.equal(calls, 3, "concurrent asks share the cached answer");

// A different token is a different user: never served another's answer.
process.env.GITHUB_TOKEN = "another-token";
await GET();
assert.equal(calls, 6, "another token computes its own answer");

// A total failure is held only for the fresh minute (a backoff for the
// 30/min search API) and is never served stale after it.
process.env.GITHUB_TOKEN = "failing-token";
failNext = true;
const failed = await GET();
assert.equal(failed.status, 502);
const before = calls;
failNext = false;
assert.equal((await GET()).status, 502, "inside the minute the failure is the answer");
assert.equal(calls, before, "no GitHub call while backing off");

delete process.env.GITHUB_TOKEN;
const none = await (await GET()).json();
assert.equal(none.configured, false, "no token still answers at once");

console.log("github-assigned route-cache.test.ts: ok");
