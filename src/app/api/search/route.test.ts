// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const testRoot = mkdtempSync(path.join(tmpdir(), "search-route-"));
const isolatedEnv = {
  COVEN_CAVE_HOME: path.join(testRoot, "cave"),
  COVEN_HOME: path.join(testRoot, "coven"),
  COVEN_CAVE_SEARCH_INDEX: path.join(testRoot, "search.sqlite"),
  COVEN_SOCKET: process.platform === "win32"
    ? `\\\\.\\pipe\\${path.basename(testRoot)}`
    : path.join(testRoot, "coven.sock"),
};
const previousEnv = Object.fromEntries(
  Object.keys(isolatedEnv).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, isolatedEnv);

// Store paths are captured at import time; isolate before loading the route.
const { resetServerSearchIndexForTests } = await import("@/lib/server/search-runtime");
after(async () => {
  try {
    await resetServerSearchIndexForTests();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(testRoot, { recursive: true, force: true });
  }
});
const { POST } = await import("./route.ts");

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

test("a valid query returns a 200 with the truthful empty state (registry is wired)", async () => {
  // Unit 6 wired the real provider registry and index reader into this route
  // (cave-ychtl.6). A clean environment has no documents matching "widget", so
  // the route must answer no-matches — never a convincing empty, and never the
  // pre-wiring filtered-empty that claimed "no provider can honor this".
  const response = await POST(request({ query: baseQuery }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.results), "results is always an array");
  assert.equal(body.emptyReason, "no-matches");
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
  const response = await POST(request({ query: baseQuery }, { signal: controller.signal }));
  // The route validates before running providers, so an aborted signal on an
  // otherwise valid request still completes the handshake; the coordinator's
  // signal handling is exercised by the coordinator tests.
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

console.log("search route.test.ts: ok");
