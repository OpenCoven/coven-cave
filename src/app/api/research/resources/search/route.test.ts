import assert from "node:assert/strict";
import test from "node:test";

import { ResearchResourceRetrievalError } from "../../../../../lib/server/research-resource-retrieval.ts";
import { createResearchResourceSearchRouteHandlers } from "./route.ts";

function request(body: unknown, host = "localhost"): Request {
  return new Request(`http://${host}:3000/api/research/resources/search`, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string, contentType = "application/json", headers: HeadersInit = {}): Request {
  return new Request("http://localhost:3000/api/research/resources/search", {
    method: "POST",
    headers: { host: "localhost", "content-type": contentType, ...headers },
    body,
  });
}

const query = { version: 1, text: "local evidence", ranking: "hybrid", limit: 10 } as const;

test("search is local-only and feature-gated before retrieval", async () => {
  let calls = 0;
  const route = createResearchResourceSearchRouteHandlers({
    enabled: () => true,
    retrieval: { query: async () => { calls++; return { version: 1, ranking: "hybrid", hits: [] }; } },
  });
  const forbidden = await route.POST(request(query, "cave.example.com"));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("cache-control"), "no-store");
  assert.deepEqual(await forbidden.json(), {
    ok: false,
    code: "local_request_required",
    error: "forbidden",
  });
  const disabled = createResearchResourceSearchRouteHandlers({
    enabled: () => false,
    retrieval: { query: async () => { calls++; return { version: 1, ranking: "hybrid", hits: [] }; } },
  });
  assert.equal((await disabled.POST(request(query))).status, 404);
  assert.equal(calls, 0);
});

test("search returns the versioned result with no-store", async () => {
  const route = createResearchResourceSearchRouteHandlers({
    enabled: () => true,
    retrieval: { query: async (input) => {
      assert.deepEqual(input, query);
      return { version: 1, ranking: "hybrid", hits: [] };
    } },
  });
  const response = await route.POST(request(query));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    result: { version: 1, ranking: "hybrid", hits: [] },
  });
});

test("search normalizes malformed, oversized, and wrong-content-type bodies", async () => {
  const route = createResearchResourceSearchRouteHandlers({
    enabled: () => true,
    retrieval: { query: async () => { throw new Error("body validation must run first"); } },
  });
  const cases = [
    [rawRequest("{"), 400, "invalid-json-body", "invalid json body"],
    [rawRequest("{}", "text/plain"), 415, "unsupported-content-type", "application/json required"],
    [rawRequest("{}", "application/json", { "content-length": String(32 * 1024 + 1) }), 413, "request-body-too-large", "request body too large"],
  ] as const;
  for (const [input, status, code, error] of cases) {
    const response = await route.POST(input);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: false, code, error });
  }
});

test("search maps invalid, unsupported, and unavailable failures without diagnostics", async () => {
  for (const [code, status] of [["invalid-query", 400], ["unsupported-filter", 422], ["unavailable", 503]] as const) {
    const route = createResearchResourceSearchRouteHandlers({
      enabled: () => true,
      retrieval: { query: async () => { throw new ResearchResourceRetrievalError(code, code === "unavailable" ? "/private/index" : "safe query error"); } },
    });
    const response = await route.POST(request(query));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(JSON.stringify(body).includes("/private"), false);
  }
});
