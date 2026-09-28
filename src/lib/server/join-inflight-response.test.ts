// @ts-nocheck
// #5627: identical concurrent GETs share one handler run; nothing is kept after.
import assert from "node:assert/strict";
import test from "node:test";
import { joinInFlightResponse } from "./join-inflight-response.ts";

test("concurrent asks share one run and each gets its own response", async () => {
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const handler = async () => {
    runs += 1;
    await gate;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const pending = [joinInFlightResponse("k", handler), joinInFlightResponse("k", handler), joinInFlightResponse("other", handler)];
  release();
  const [a, b, c] = await Promise.all(pending);
  assert.equal(runs, 2, "one run per key in flight");
  assert.notEqual(a, b, "each caller gets its own Response");
  assert.deepEqual(await a.json(), { ok: true });
  assert.deepEqual(await b.json(), { ok: true }, "a second body read is independent");
  assert.equal(a.headers.get("content-type"), "application/json");
  assert.equal(c.status, 200);
  await joinInFlightResponse("k", handler);
  assert.equal(runs, 3, "a later ask runs live: nothing is kept");
});

test("a failed run is shared, then forgotten", async () => {
  let runs = 0;
  const failing = async () => { runs += 1; throw new Error("github down"); };
  const results = await Promise.allSettled([joinInFlightResponse("f", failing), joinInFlightResponse("f", failing)]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  assert.equal(runs, 1);
  await joinInFlightResponse("f", async () => new Response("{}", { status: 502 })).then((r) => assert.equal(r.status, 502));
});
