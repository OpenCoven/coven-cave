import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CLIENT_V1_ADMIN_HEADER } from "@/proxy-helpers";
import {
  createPairingRequest,
  decidePairingRequest,
  resetPairingRequestsForTest,
} from "@/lib/server/client-v1/pairing-store.ts";

const { GET } = await import("./route.ts");
const ADMIN_SECRET = "admin-pairing-list-secret";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = ADMIN_SECRET;

function adminRequest(marker = ADMIN_SECRET) {
  return new Request("http://127.0.0.1/api/client/v1/admin/pairing-requests", {
    headers: { [CLIENT_V1_ADMIN_HEADER]: marker },
  });
}

afterEach(() => {
  resetPairingRequestsForTest();
});

function input(overrides: Record<string, unknown> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read" as const],
    ...overrides,
  };
}

test("lists only live pending pairing requests, never a secret", async () => {
  const pending = createPairingRequest(input());
  const approved = createPairingRequest(input({ installationId: "1b1b1b1b-2222-4333-8444-555555555555" }));
  decidePairingRequest(approved.request.id, "approved");

  const response = await GET(adminRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].id, pending.request.id);
  assert.equal(body.requests[0].status, "pending");
  assert.equal("secret" in body.requests[0], false);
  assert.equal("secretHash" in body.requests[0], false);
});

test("an empty queue returns an empty list, not an error", async () => {
  const response = await GET(adminRequest());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.requests, []);
});

test("missing or forged proxy admin marker returns the same generic 403", async () => {
  for (const request of [
    new Request("http://127.0.0.1/api/client/v1/admin/pairing-requests"),
    adminRequest("forged"),
  ]) {
    const response = await GET(request);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "unauthorized");
    assert.equal(body.error.message, "Not authorized.");
  }
});

console.log("client/v1/admin/pairing-requests route.test.ts: ok");
