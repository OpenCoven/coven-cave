// @ts-nocheck
// #5930: the review card offers Comment only on your own pull request, so the
// server needs the token's own login. It asks REST /user (never GraphQL: that
// budget is shared by every agent signed in as the user) once per token and
// keeps the answer; a failure is held briefly so a dead network is not asked
// on every card.
import assert from "node:assert/strict";
import test from "node:test";

import { clearGitHubViewerCache, githubViewerLogin } from "./github-viewer.ts";
import { carriesUpstreamDeadline, resetUpstreamHealth, upstreamFetch } from "./upstream-fetch.ts";

// One test's failures must not leave the shared GitHub host cooling.
test.beforeEach(() => resetUpstreamHealth("github"));

function stub(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), bounded: carriesUpstreamDeadline(init?.signal) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { calls, fetchImpl };
}

test("asks REST /user once per token and keeps the login", async () => {
  clearGitHubViewerCache();
  const { calls, fetchImpl } = stub([{ status: 200, body: { login: "BunsDev" } }]);
  let now = 0;
  const opts = { fetchImpl, now: () => now };
  assert.equal(await githubViewerLogin("tok-a", opts), "BunsDev");
  now += 30 * 60_000;
  assert.equal(await githubViewerLogin("tok-a", opts), "BunsDev");
  assert.equal(calls.length, 1, "the second ask is answered from memory");
  assert.equal(calls[0].url, "https://api.github.com/user");
  assert.equal(calls[0].auth, "Bearer tok-a");
  assert.equal(calls[0].bounded, true, "the lookup carries the shared upstream deadline");
});

test("no token means no viewer, and no request", async () => {
  clearGitHubViewerCache();
  const { calls, fetchImpl } = stub([]);
  assert.equal(await githubViewerLogin(null, { fetchImpl }), null);
  assert.equal(calls.length, 0);
});

test("a failure is null, held for a short backoff, then retried", async () => {
  clearGitHubViewerCache();
  const { calls, fetchImpl } = stub([
    { status: 500, body: {} },
    { status: 200, body: { login: "BunsDev" } },
  ]);
  let now = 0;
  const opts = { fetchImpl, now: () => now };
  assert.equal(await githubViewerLogin("tok-b", opts), null);
  assert.equal(await githubViewerLogin("tok-b", opts), null);
  assert.equal(calls.length, 1, "inside the backoff the failure is the answer, and the 500 is not retried inside the call");
  now += 6 * 60_000;
  assert.equal(await githubViewerLogin("tok-b", opts), "BunsDev");
  assert.equal(calls.length, 2);
});

test("a thrown fetch is null, not an exception", async () => {
  clearGitHubViewerCache();
  const { fetchImpl } = stub([new TypeError("network down")]);
  assert.equal(await githubViewerLogin("tok-c", { fetchImpl }), null);
});

test("concurrent asks share one request, and tokens never share answers", async () => {
  clearGitHubViewerCache();
  const { calls, fetchImpl } = stub([
    { status: 200, body: { login: "one" } },
    { status: 200, body: { login: "two" } },
  ]);
  const [a, b] = await Promise.all([
    githubViewerLogin("tok-1", { fetchImpl }),
    githubViewerLogin("tok-1", { fetchImpl }),
  ]);
  assert.equal(a, "one");
  assert.equal(b, "one");
  assert.equal(await githubViewerLogin("tok-2", { fetchImpl }), "two");
  assert.equal(calls.length, 2);
});

test("a shared GitHub cooldown is not held as the viewer's answer", async () => {
  clearGitHubViewerCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ login: "BunsDev" }), { status: 200 });
  };
  // Another GitHub call was told to wait a minute: the shared host cools.
  const tripped = await upstreamFetch(
    "github",
    "https://api.github.com/repos/o/r",
    {},
    { fetchImpl: async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }), retries: 0 },
  );
  assert.equal(tripped.status, 429);
  assert.equal(await githubViewerLogin("tok-cool", { fetchImpl }), null, "unknown while the host cools");
  assert.equal(calls.length, 0, "the cooldown answered without asking GitHub");
  resetUpstreamHealth("github");
  assert.equal(await githubViewerLogin("tok-cool", { fetchImpl }), "BunsDev", "asked again at once, not after the 5-minute failure backoff");
  assert.equal(calls.length, 1);
});
