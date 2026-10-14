// @ts-nocheck
// #5930: the review card offers Comment only on your own pull request, so the
// server needs the token's own login. It asks REST /user (never GraphQL: that
// budget is shared by every agent signed in as the user) once per token and
// keeps the answer; a failure is held briefly so a dead network is not asked
// on every card.
import assert from "node:assert/strict";
import test from "node:test";

import { clearGitHubViewerCache, githubViewerLogin } from "./github-viewer.ts";

function stub(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
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
  assert.equal(calls.length, 1, "inside the backoff the failure is the answer");
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
