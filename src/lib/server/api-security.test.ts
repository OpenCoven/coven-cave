// @ts-nocheck
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MOBILE_ACCESS_HEADER, TOKEN_HEADER } from "../../proxy-helpers.ts";
import { readJsonBody, rejectNonLocalRequest } from "./api-security.ts";

const ORIGINAL_SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN;

function restoreEnv() {
  if (ORIGINAL_SIDECAR_TOKEN === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = ORIGINAL_SIDECAR_TOKEN;
}

function request(headers: HeadersInit) {
  return new Request("http://x/", { headers });
}

afterEach(() => {
  restoreEnv();
});

test("rejects mobile-marked requests with 403", async () => {
  delete process.env.COVEN_CAVE_AUTH_TOKEN;

  const res = rejectNonLocalRequest(
    request({ host: "127.0.0.1:3000", [MOBILE_ACCESS_HEADER]: "1" }),
  );

  assert.ok(res);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, error: "forbidden" });
});

test("rejects sidecar token mismatches with 403", async () => {
  process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-secret";

  const res = rejectNonLocalRequest(
    request({ host: "127.0.0.1:3000", [TOKEN_HEADER]: "wrong" }),
  );

  assert.ok(res);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { ok: false, error: "forbidden" });
});

test("accepts valid loopback plus sidecar token requests", () => {
  process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-secret";

  const res = rejectNonLocalRequest(
    request({ host: "127.0.0.1:3000", [TOKEN_HEADER]: "sidecar-secret" }),
  );

  assert.equal(res, null);
});

function jsonBodyRequest(raw: string) {
  return new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
}

test("readJsonBody rejects a literal JSON null root with 400", async () => {
  const result = await readJsonBody(jsonBodyRequest("null"), 1024);

  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
  assert.deepEqual(await result.response.json(), { ok: false, error: "invalid json body" });
});

test("readJsonBody rejects primitive and array roots with 400", async () => {
  for (const raw of ["42", '"hello"', "true", "[1,2,3]"]) {
    const result = await readJsonBody(jsonBodyRequest(raw), 1024);
    assert.equal(result.ok, false, `expected ${raw} to be rejected`);
    assert.equal(result.response.status, 400);
  }
});

test("readJsonBody accepts an object root", async () => {
  const result = await readJsonBody(jsonBodyRequest('{"field":"value"}'), 1024);

  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { field: "value" });
});

console.log("api-security.test.ts: ok");
