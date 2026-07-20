// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBranchPrCache, createPrUrlCache, parseBranchPr } from "./branch-pr-context.ts";

const ghJson = (over = {}) =>
  JSON.stringify({
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "MERGED",
    isDraft: false,
    ...over,
  });

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("parseBranchPr normalizes gh output (repo from url, state lowercased)", () => {
  const pr = parseBranchPr(ghJson(), "feat/x");
  assert.deepEqual(pr, {
    repo: "OpenCoven/coven-cave",
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "merged",
    branch: "feat/x",
    draft: false,
  });
});

test("parseBranchPr rejects junk", () => {
  assert.equal(parseBranchPr("not json", "b"), null);
  assert.equal(parseBranchPr(JSON.stringify({ number: 1, url: "https://example.com" }), "b"), null);
  assert.equal(parseBranchPr(JSON.stringify({ url: "https://github.com/o/r/pull/1" }), "b"), null);
});

test("first read misses but schedules a background fetch; next read serves it", async () => {
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      return ghJson();
    },
  });
  assert.equal(cache.get("/repo", "feat/x"), undefined);
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "merged");
  assert.equal(calls, 1, "fresh entry is served from memory, no second fetch");
});

test("failures negative-cache as null (no gh hammering)", async () => {
  let calls = 0;
  const cache = createBranchPrCache({
    runner: async () => {
      calls += 1;
      throw new Error("no pull requests found");
    },
  });
  cache.get("/repo", "main");
  await tick();
  assert.equal(cache.get("/repo", "main"), null);
  await tick();
  assert.equal(calls, 1);
});

test("expired entries keep serving stale while revalidating", async () => {
  let now = 0;
  let calls = 0;
  const cache = createBranchPrCache({
    ttlMs: 1000,
    now: () => now,
    runner: async () => {
      calls += 1;
      return ghJson({ state: calls === 1 ? "OPEN" : "MERGED" });
    },
  });
  cache.get("/repo", "feat/x");
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "open");
  now = 2000; // past TTL — stale value still served, refresh kicks off
  assert.equal(cache.get("/repo", "feat/x")?.state, "open");
  await tick();
  assert.equal(cache.get("/repo", "feat/x")?.state, "merged");
});

test("concurrent refreshes are capped", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createBranchPrCache({
    maxConcurrent: 2,
    runner: async () => {
      started += 1;
      await gate;
      return ghJson();
    },
  });
  cache.get("/a", "b1");
  cache.get("/a", "b2");
  cache.get("/a", "b3"); // over the cap — skipped this poll
  assert.equal(started, 2);
  release();
  await tick();
});

// ── URL-keyed cache (transcript-derived attribution, cave-u9wl) ──

test("parseBranchPr without a branch omits the field", () => {
  const pr = parseBranchPr(ghJson());
  assert.equal(pr.branch, undefined);
  assert.equal(pr.repo, "OpenCoven/coven-cave");
});

test("prUrlCache: first read misses, background fetch keyed on the URL", async () => {
  const urls = [];
  const cache = createPrUrlCache({
    runner: async (url) => {
      urls.push(url);
      return ghJson();
    },
  });
  const url = "https://github.com/OpenCoven/coven-cave/pull/42";
  assert.equal(cache.get(url), undefined);
  await tick();
  const pr = cache.get(url);
  assert.equal(pr?.state, "merged");
  assert.equal(pr?.branch, undefined, "URL lookups carry no branch");
  assert.deepEqual(urls, [url]);
});

test("prUrlCache: failures negative-cache as null", async () => {
  let calls = 0;
  const cache = createPrUrlCache({
    runner: async () => {
      calls += 1;
      throw new Error("gh: not found");
    },
  });
  cache.get("https://github.com/o/r/pull/1");
  await tick();
  assert.equal(cache.get("https://github.com/o/r/pull/1"), null);
  await tick();
  assert.equal(calls, 1, "negative entry served from memory within TTL");
});
