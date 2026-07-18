// @ts-nocheck
import assert from "node:assert/strict";
import { createGitHubTasksCache, GITHUB_TASKS_TTL_MS } from "./github-tasks-cache.ts";

const endpoint = "https://coven-github.test/api/github/tasks";
let now = 1_000;
let calls = 0;
let releaseFirst: (response: Response) => void = () => {};
const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve; });

const responses: Array<Promise<Response> | Response> = [
  firstResponse,
  new Response(JSON.stringify({ ok: true, tasks: [{ id: "new" }] }), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"tasks-v2"' },
  }),
  new Response(null, { status: 304 }),
  new Response(JSON.stringify({ ok: false, error: "offline" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  }),
];

const requestHeaders: Headers[] = [];
const cache = createGitHubTasksCache({
  now: () => now,
  fetcher: async (_input, init) => {
    calls += 1;
    requestHeaders.push(new Headers(init?.headers));
    return await responses.shift()!;
  },
});

const coldA = cache.read(endpoint);
const coldB = cache.read(endpoint);
assert.equal(calls, 1, "simultaneous cold clients share one upstream request");
releaseFirst(new Response(JSON.stringify({ ok: true, tasks: [{ id: "old" }] }), {
  status: 200,
  headers: { "content-type": "application/json", etag: '"tasks-v1"' },
}));
assert.deepEqual(await coldA, await coldB);

await cache.read(endpoint);
assert.equal(calls, 1, "fresh reads stay inside the one-minute TTL");

now += GITHUB_TASKS_TTL_MS + 1;
const stale = await cache.read(endpoint);
assert.equal(stale.freshness, "stale", "stale data is served immediately while revalidating");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls, 2, "one background refresh runs after the TTL");
assert.equal(requestHeaders[1]?.get("if-none-match"), '"tasks-v1"', "revalidation sends the upstream ETag");

const revalidated = await cache.read(endpoint, { force: true });
assert.equal(revalidated.source, "revalidated");
assert.equal(requestHeaders[2]?.get("if-none-match"), '"tasks-v2"');

const fallback = await cache.read(endpoint, { force: true });
assert.equal(fallback.freshness, "stale", "a failed forced refresh keeps last-known-good data");
assert.deepEqual(fallback.data, { ok: true, tasks: [{ id: "new" }] });

console.log("github-tasks-cache.test.ts: ok");
