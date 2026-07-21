// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSurfaceWarmCache } from "./surface-warm-cache.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("coalesces a cold read and a warm request for the same resource", async () => {
  const pending = deferred();
  let calls = 0;
  const cache = createSurfaceWarmCache();
  cache.defineResource("github", async () => {
    calls += 1;
    return pending.promise;
  }, 1_000);

  const read = cache.read("github");
  const warm = cache.warm("github");
  assert.equal(calls, 1);
  pending.resolve({ items: ["one"] });
  assert.deepEqual((await read).data, { items: ["one"] });
  assert.deepEqual((await warm).data, { items: ["one"] });
  assert.equal(cache.snapshot().counters.coalesced, 1);
});

test("serves fresh values, exposes stale fallback, and revalidates it", async () => {
  let time = 100;
  let calls = 0;
  const second = deferred();
  const cache = createSurfaceWarmCache({ now: () => time });
  cache.defineResource("marketplace", () => {
    calls += 1;
    return calls === 1 ? "first" : second.promise;
  }, 50);

  assert.equal((await cache.warm("marketplace")).data, "first");
  assert.equal((await cache.read("marketplace")).cache.source, "cache");
  time = 151;
  const stale = await cache.read("marketplace");
  assert.equal(stale.data, "first");
  assert.equal(stale.cache.source, "stale-fallback");
  assert.equal(stale.cache.stale, true);
  assert.equal(calls, 2, "an expired read starts one background refresh");
  second.resolve("second");
  await cache.warm("marketplace");
  assert.equal((await cache.read("marketplace")).data, "second");
  assert.equal(cache.snapshot().counters.staleFallbacks, 1);
});

test("a forced read bypasses a fresh cache entry", async () => {
  let calls = 0;
  const cache = createSurfaceWarmCache();
  cache.defineResource("tasks", () => ++calls, 60_000);

  assert.equal((await cache.warm("tasks")).data, 1);
  assert.equal((await cache.read("tasks")).data, 1);
  assert.equal((await cache.read("tasks", { force: true })).data, 2);
  assert.equal(calls, 2);
});

test("errors are diagnostic state, never cache data, and a later read retries", async () => {
  let calls = 0;
  const cache = createSurfaceWarmCache();
  cache.defineResource("schedules", () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return "ready";
  }, 1_000);

  await assert.rejects(cache.read("schedules"), /offline/);
  const failed = cache.snapshot().entries[0];
  assert.equal(failed.status, "error");
  assert.equal(failed.hasValue, false);
  assert.equal(failed.error?.message, "offline");
  assert.equal((await cache.read("schedules")).data, "ready");
  assert.equal(calls, 2);
});

test("invalidation and abort prevent an old request from repopulating the cache", async () => {
  const pending = deferred();
  let receivedSignal;
  const cache = createSurfaceWarmCache();
  cache.defineResource("grimoire", (signal) => {
    receivedSignal = signal;
    return pending.promise;
  }, 1_000);

  const inFlight = cache.warm("grimoire");
  cache.invalidate("grimoire");
  assert.equal(receivedSignal.aborted, true);
  pending.resolve("old result");
  await assert.rejects(inFlight, { name: "AbortError" });
  assert.equal(cache.snapshot().entries[0].hasValue, false);

  const other = deferred();
  cache.defineResource("agents", (signal) => {
    signal.addEventListener("abort", () => other.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })));
    return other.promise;
  }, 1_000);
  const all = cache.warm("agents");
  cache.abort("all");
  await assert.rejects(all, { name: "AbortError" });
  assert.equal(cache.snapshot().counters.aborts, 2);
});

test("an invalidation immediately starts a replacement request", async () => {
  const first = deferred();
  let calls = 0;
  const cache = createSurfaceWarmCache();
  cache.defineResource("board", () => {
    calls += 1;
    return calls === 1 ? first.promise : "fresh";
  }, 1_000);

  const staleRequest = cache.warm("board");
  cache.invalidate("board");
  const replacement = cache.read("board", { force: true });

  assert.equal(calls, 2, "the replacement must not join the aborted request");
  assert.equal((await replacement).data, "fresh");
  first.resolve("stale");
  await assert.rejects(staleRequest, { name: "AbortError" });
});

test("invalidating resources that are not registered yet is safe", async () => {
  const cache = createSurfaceWarmCache();
  cache.invalidateIfDefined("board:cards", "tasks:queue");
  assert.equal(cache.snapshot().counters.invalidations, 0);

  cache.defineResource("board:cards", () => "old", 1_000);
  await cache.warm("board:cards");
  cache.invalidateIfDefined("board:cards", "tasks:queue");
  assert.equal(cache.snapshot().counters.invalidations, 1);
  assert.equal(cache.snapshot().entries[0].hasValue, false);
});

test("pausing background work does not abort a navigation that joined it", async () => {
  const pending = deferred();
  const cache = createSurfaceWarmCache();
  cache.defineResource("marketplace", () => pending.promise, 1_000);

  const background = cache.warm("marketplace");
  const navigation = cache.read("marketplace");
  cache.abortWarm();
  pending.resolve("ready");

  assert.equal((await background).data, "ready");
  assert.equal((await navigation).data, "ready");
  assert.equal(cache.snapshot().counters.aborts, 0);
});
