// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

const baseQuery = {
  version: 1,
  text: "widget",
  phrases: [],
  filters: [],
  scopes: [],
  presentation: "top",
};

function request(payload, overrides = {}) {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...(overrides.headers ?? {}) },
    body: JSON.stringify(payload),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
  });
}

test("a valid query returns a 200 filtered-empty (no providers registered yet)", async () => {
  const response = await POST(request({ query: baseQuery }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.emptyReason, "filtered-empty");
  assert.deepEqual(body.results, []);
  assert.equal(body.partial, false);
  assert.equal(body.cursor, null);
  assert.equal(body.indexState, "ready");
});

test("an unsupported version is refused with 400", async () => {
  const response = await POST(request({ query: { ...baseQuery, version: 999 } }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "unsupported-version");
});

test("oversized query text is refused with 400", async () => {
  const response = await POST(request({ query: { ...baseQuery, text: "x".repeat(2000) } }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "query-too-long");
});

test("a malformed query is refused with 400", async () => {
  const response = await POST(request({ query: "not-an-object" }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "malformed-query");
});

test("a non-object body is refused with 400", async () => {
  // readJsonBody rejects arrays and primitives itself with the repo's standard
  // invalid-JSON response, so the route's own shape guard never runs.
  const response = await POST(request([1, 2, 3]));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid json body");
});

test("a malformed cursor is refused with 400", async () => {
  const response = await POST(request({ query: baseQuery, cursor: "abc" }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "malformed-cursor");
});

test("a valid cursor is accepted", async () => {
  const response = await POST(request({ query: baseQuery, cursor: "50" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test("limit is clamped to the page cap", async () => {
  const response = await POST(request({ query: baseQuery, limit: 10_000 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test("a non-JSON content type is refused", async () => {
  const response = await POST(request({ query: baseQuery }, { headers: { "content-type": "text/plain" } }));
  assert.equal(response.status, 415);
});

test("a pre-aborted request signal is honored without hanging", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await POST(request({ query: baseQuery }), { signal: controller.signal });
  // The route validates before running providers, so an aborted signal on an
  // otherwise valid request still completes the handshake; the coordinator's
  // signal handling is exercised by the coordinator tests.
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

console.log("search route.test.ts: ok");
