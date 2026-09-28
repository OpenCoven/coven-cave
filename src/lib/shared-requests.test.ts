// @ts-nocheck
// #5671: a forced refresh is never overwritten by an older request for the
// same key, in the kept answer or for that older request's callers.
import assert from "node:assert/strict";
import test from "node:test";
import { createSharedRequests } from "./shared-requests.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const shared = () => createSharedRequests({ keep: (v) => v !== "failed", maxEntries: 8 });
const opts = (extra = {}) => ({ freshMs: 60_000, ...extra });

test("a forced refresh that finishes first is not overwritten by the older request", async () => {
  const requests = shared();
  const older = deferred();
  const newer = deferred();
  const olderCallers = requests.run("k", () => older.promise, opts());
  const forced = requests.run("k", () => newer.promise, opts({ force: true }));
  newer.resolve("after-action");
  assert.equal(await forced, "after-action");
  older.resolve("before-action");
  assert.equal(await olderCallers, "after-action", "the older request's callers get the newest answer");
  assert.equal(await requests.run("k", () => Promise.resolve("unused"), opts()), "after-action", "the kept answer is the newest");
});

test("an older request that finishes first defers to the forced one still in flight", async () => {
  const requests = shared();
  const older = deferred();
  const newer = deferred();
  const olderCallers = requests.run("k", () => older.promise, opts());
  const forced = requests.run("k", () => newer.promise, opts({ force: true }));
  older.resolve("before-action");
  newer.resolve("after-action");
  assert.equal(await olderCallers, "after-action");
  assert.equal(await forced, "after-action");
  assert.equal(await requests.run("k", () => Promise.resolve("unused"), opts()), "after-action");
});

test("a superseded request that fails hands its callers the newest answer", async () => {
  const requests = shared();
  const older = deferred();
  const olderCallers = requests.run("k", () => older.promise, opts());
  await requests.run("k", () => Promise.resolve("fresh"), opts({ force: true }));
  older.reject(new Error("network"));
  assert.equal(await olderCallers, "fresh");
});

test("unchanged sharing: join, reuse while fresh, expire, never keep failures", async () => {
  const requests = shared();
  let now = 0;
  let loads = 0;
  const load = async () => { loads += 1; return `v${loads}`; };
  const [a, b] = await Promise.all([requests.run("k", load, opts({ now: () => now })), requests.run("k", load, opts({ now: () => now }))]);
  assert.equal(a, "v1");
  assert.equal(b, "v1");
  now = 59_999;
  assert.equal(await requests.run("k", load, opts({ now: () => now })), "v1");
  now = 60_000;
  assert.equal(await requests.run("k", load, opts({ now: () => now })), "v2");
  assert.equal(await requests.run("f", async () => "failed", opts()), "failed");
  let retried = false;
  await requests.run("f", async () => { retried = true; return "ok"; }, opts());
  assert.equal(retried, true);
});
