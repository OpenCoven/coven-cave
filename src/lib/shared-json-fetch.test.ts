// @ts-nocheck
// #5663: remounting components share familiar-independent JSON.
import assert from "node:assert/strict";
import test from "node:test";
import { clearSharedJsonFetch, sharedJsonFetch, SHARED_JSON_FRESH_MS } from "./shared-json-fetch.ts";

function stub(status = 200, body = { ok: true }) {
  const calls = [];
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    await gate;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, release };
}

test.beforeEach(() => clearSharedJsonFetch());

test("concurrent and repeat asks share one request while fresh", async () => {
  let now = 0;
  const first = stub(200, { ok: true, n: 1 });
  const a = sharedJsonFetch("/api/roles", { now: () => now });
  const b = sharedJsonFetch("/api/roles", { now: () => now });
  first.release();
  assert.equal(await a, await b);
  now = SHARED_JSON_FRESH_MS - 1;
  assert.equal((await sharedJsonFetch("/api/roles", { now: () => now })).data.n, 1);
  assert.equal(first.calls.length, 1);
  assert.equal(first.calls[0].init.signal, undefined, "a shared request is never tied to one caller's abort");
});

test("force and expiry ask again; failures are not kept", async () => {
  let now = 0;
  const first = stub(200, { ok: true, n: 1 });
  first.release();
  await sharedJsonFetch("/api/prompts", { now: () => now });
  const forced = stub(200, { ok: true, n: 2 });
  forced.release();
  assert.equal((await sharedJsonFetch("/api/prompts", { force: true, now: () => now })).data.n, 2);
  assert.equal((await sharedJsonFetch("/api/prompts", { now: () => now })).data.n, 2, "the forced answer replaces the kept one");
  now = SHARED_JSON_FRESH_MS;
  const expired = stub(200, { ok: true, n: 3 });
  expired.release();
  assert.equal((await sharedJsonFetch("/api/prompts", { now: () => now })).data.n, 3);
  const failed = stub(500, { ok: false });
  failed.release();
  assert.equal((await sharedJsonFetch("/api/queue/readiness", { now: () => now })).ok, false);
  const retry = stub(200, { ok: true });
  retry.release();
  await sharedJsonFetch("/api/queue/readiness", { now: () => now });
  assert.equal(retry.calls.length, 1, "a failed answer is asked again");
});
