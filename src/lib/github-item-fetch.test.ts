// @ts-nocheck
// #5615: cards for the same item share one request and a short-lived answer.
import assert from "node:assert/strict";
import test from "node:test";
import { clearGitHubItemFetchCache, fetchGitHubItem } from "./github-item-fetch.ts";

function stubFetch(status = 200, body = { ok: true }) {
  const calls = [];
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url) => {
    calls.push(url);
    await gate;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, release };
}

test.beforeEach(() => clearGitHubItemFetchCache());

test("identical cards share one request, then reuse its answer", async () => {
  const { calls, release } = stubFetch();
  const a = fetchGitHubItem("Acme/Repo", 30);
  const b = fetchGitHubItem("acme/repo", 30);
  release();
  assert.equal(await a, await b);
  assert.equal((await fetchGitHubItem("acme/repo", 30)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/github/item?repo=Acme%2FRepo&number=30&pull=1");
});

test("a refresh asks the server for a fresh answer and replaces the kept one", async () => {
  const first = stubFetch(200, { ok: true, n: 1 });
  first.release();
  await fetchGitHubItem("acme/repo", 31);
  const second = stubFetch(200, { ok: true, n: 2 });
  second.release();
  const refreshed = await fetchGitHubItem("acme/repo", 31, { fresh: true });
  assert.equal(second.calls[0], "/api/github/item?repo=acme%2Frepo&number=31&pull=1&fresh=1");
  assert.equal(refreshed.data.n, 2);
  assert.equal((await fetchGitHubItem("acme/repo", 31)).data.n, 2);
});

test("a failed answer is not kept", async () => {
  const failed = stubFetch(502, { ok: false });
  failed.release();
  await fetchGitHubItem("acme/repo", 32);
  const retry = stubFetch();
  retry.release();
  await fetchGitHubItem("acme/repo", 32);
  assert.equal(retry.calls.length, 1, "the next card asks again");
});

test("an answer expires after the window", async () => {
  let now = 0;
  const first = stubFetch();
  first.release();
  await fetchGitHubItem("acme/repo", 33, { now: () => now });
  now = 30_000;
  const again = stubFetch();
  again.release();
  await fetchGitHubItem("acme/repo", 33, { now: () => now });
  assert.equal(again.calls.length, 1);
});

// #5627: checks and review threads share the same way, with a per-call window.
test("shared card lookups join, reuse within their window, and refresh live", async () => {
  const { fetchSharedGitHubJson } = await import("./github-item-fetch.ts");
  const url = "/api/github/checks?repo=acme%2Frepo&number=7";
  let now = 0;
  const first = stubFetch(200, { ok: true, n: 1 });
  const a = fetchSharedGitHubJson(url, { freshMs: 15_000, now: () => now });
  const b = fetchSharedGitHubJson(url, { freshMs: 15_000, now: () => now });
  first.release();
  assert.equal(await a, await b);
  assert.equal(first.calls.length, 1, "concurrent cards share one request");
  now = 14_999;
  assert.equal((await fetchSharedGitHubJson(url, { freshMs: 15_000, now: () => now })).data.n, 1);
  const refreshed = stubFetch(200, { ok: true, n: 2 });
  refreshed.release();
  assert.equal((await fetchSharedGitHubJson(url, { freshMs: 15_000, fresh: true, now: () => now })).data.n, 2);
  now = 30_000;
  const expired = stubFetch(200, { ok: true, n: 3 });
  expired.release();
  assert.equal((await fetchSharedGitHubJson(url, { freshMs: 15_000, now: () => now })).data.n, 3, "past the window it asks again");
});
