// Boundary checks only: every case returns before the daemon is reached. The
// versioned revise and tombstone are covered with an injected transport in
// src/lib/server/coven-automations-client.test.ts.
import assert from "node:assert/strict";
import test from "node:test";

delete process.env.COVEN_CAVE_AUTH_TOKEN;
const { DELETE, PATCH } = await import("./route.ts");
const params = { params: Promise.resolve({ id: "nightly" }) };
const local = (method: string, url: string, body?: unknown, host = "127.0.0.1:3000") =>
  new Request(url, { method, headers: { host, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

test("edits and deletes are local-origin only", async () => {
  assert.equal((await PATCH(local("PATCH", "http://127.0.0.1:3000/api/codex-automations/nightly", { name: "x" }, "remote.example.com"), params)).status, 403);
  assert.equal((await DELETE(local("DELETE", "http://127.0.0.1:3000/api/codex-automations/nightly", undefined, "remote.example.com"), params)).status, 403);
});

test("an expected revision that is not a positive integer is refused before the daemon", async () => {
  for (const expectedRevision of [0, -1, 1.5, "two"]) {
    const response = await PATCH(local("PATCH", "http://127.0.0.1:3000/api/codex-automations/nightly", { name: "x", expectedRevision }), params);
    assert.equal(response.status, 422, JSON.stringify(expectedRevision));
  }
  for (const query of ["0", "-3", "1.5", "abc"]) {
    const response = await DELETE(local("DELETE", `http://127.0.0.1:3000/api/codex-automations/nightly?expectedRevision=${query}`), params);
    assert.equal(response.status, 422, query);
  }
});

test("a rule Coven cannot run is refused with a reason before the daemon", async () => {
  const response = await PATCH(local("PATCH", "http://127.0.0.1:3000/api/codex-automations/nightly", {
    rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30", expectedRevision: 2,
  }), params);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /on the hour/);
});

test("delete requires both the reviewed revision and caller adoption key before reaching the daemon", async () => {
  const missingRevision = await DELETE(local("DELETE", "http://127.0.0.1:3000/api/codex-automations/nightly"), params);
  assert.equal(missingRevision.status, 422);
  const missingKey = await DELETE(local("DELETE", "http://127.0.0.1:3000/api/codex-automations/nightly?expectedRevision=4"), params);
  assert.equal(missingKey.status, 422);
  assert.match((await missingKey.json()).error, /adoption key/);
});
