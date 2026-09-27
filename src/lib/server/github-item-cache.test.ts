// @ts-nocheck
// #5615: /api/github/item answers repeat asks from a short cache.
import assert from "node:assert/strict";
import test from "node:test";
import {
  clearGitHubItemCache,
  GITHUB_ITEM_FRESH_MS,
  githubItemCacheKey,
  readGitHubItemThroughCache,
} from "./github-item-cache.ts";

test.beforeEach(() => clearGitHubItemCache());

test("a repeat ask inside the window is served without GitHub", async () => {
  let loads = 0;
  const load = async () => ({ status: 200, body: `{"n":${++loads}}` });
  const key = githubItemCacheKey("tok", "Acme/Repo", 30, true);
  let now = 1_000;
  const clock = { now: () => now };
  assert.equal((await readGitHubItemThroughCache(key, load, clock)).body, '{"n":1}');
  assert.equal((await readGitHubItemThroughCache(key, load, clock)).body, '{"n":1}');
  assert.equal(loads, 1);
  now += GITHUB_ITEM_FRESH_MS;
  assert.equal((await readGitHubItemThroughCache(key, load, clock)).body, '{"n":2}', "an expired entry reloads");
});

test("concurrent asks share one load", async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const load = async () => { loads += 1; await gate; return { status: 200, body: "{}" }; };
  const key = githubItemCacheKey(null, "acme/repo", 1, true);
  const pending = [readGitHubItemThroughCache(key, load), readGitHubItemThroughCache(key, load)];
  release();
  await Promise.all(pending);
  assert.equal(loads, 1);
});

test("fresh bypasses and replaces the entry", async () => {
  let loads = 0;
  const load = async () => ({ status: 200, body: `{"n":${++loads}}` });
  const key = githubItemCacheKey("tok", "acme/repo", 2, true);
  await readGitHubItemThroughCache(key, load);
  assert.equal((await readGitHubItemThroughCache(key, load, { fresh: true })).body, '{"n":2}');
  assert.equal((await readGitHubItemThroughCache(key, load)).body, '{"n":2}', "later asks see the refreshed answer");
});

test("errors are never cached; 404 is", async () => {
  let loads = 0;
  const failing = async () => { loads += 1; return { status: 502, body: "{}" }; };
  const key = githubItemCacheKey("tok", "acme/repo", 3, false);
  await readGitHubItemThroughCache(key, failing);
  await readGitHubItemThroughCache(key, failing);
  assert.equal(loads, 2, "a GitHub error is retried on the next ask");
  let missing = 0;
  const notFound = async () => { missing += 1; return { status: 404, body: "{}" }; };
  const gone = githubItemCacheKey("tok", "acme/repo", 4, false);
  await readGitHubItemThroughCache(gone, notFound);
  await readGitHubItemThroughCache(gone, notFound);
  assert.equal(missing, 1);
});

test("keys separate tokens, flavors and items; repo case does not", () => {
  const a = githubItemCacheKey("one", "Acme/Repo", 5, true);
  assert.equal(a, githubItemCacheKey("one", "acme/repo", 5, true));
  assert.notEqual(a, githubItemCacheKey("two", "acme/repo", 5, true));
  assert.notEqual(a, githubItemCacheKey(null, "acme/repo", 5, true));
  assert.notEqual(a, githubItemCacheKey("one", "acme/repo", 5, false));
  assert.notEqual(a, githubItemCacheKey("one", "acme/repo", 6, true));
  assert.equal(a.includes("one"), false, "the token itself never appears in a key");
});
