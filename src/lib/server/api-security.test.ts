// @ts-nocheck
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MOBILE_ACCESS_HEADER, TOKEN_HEADER } from "../../proxy-helpers.ts";
import { rejectNonLocalRequest } from "./api-security.ts";

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

console.log("api-security.test.ts: ok");
