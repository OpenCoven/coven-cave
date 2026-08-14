import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";

import { CLIENT_V1_ADMIN_HEADER } from "@/proxy-helpers";
import {
  createPairingRequest,
  readPairingRequest,
  resetPairingRequestsForTest,
} from "@/lib/server/client-v1/pairing-store.ts";

const { POST } = await import("./route.ts");
const ADMIN_SECRET = "admin-pairing-decision-secret";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = ADMIN_SECRET;

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

function requestFor(
  id: string,
  decision: unknown,
  marker: string | null = ADMIN_SECRET,
  idempotencyKey: string | null = crypto.randomUUID(),
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (marker !== null) headers.set(CLIENT_V1_ADMIN_HEADER, marker);
  if (idempotencyKey !== null) headers.set("idempotency-key", idempotencyKey);
  return new Request(`http://127.0.0.1/api/client/v1/admin/pairing-requests/${id}/decision`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision }),
  });
}

test("missing or forged proxy admin marker returns generic 403 before parsing params or body", async () => {
  for (const marker of [null, "forged"]) {
    let paramsRead = false;
    const response = await POST(requestFor("ignored", "approve", marker), {
      params: {
        then() {
          paramsRead = true;
          throw new Error("params must not be read");
        },
      } as unknown as Promise<{ id: string }>,
    });
    assert.equal(response.status, 403);
    assert.equal(paramsRead, false);
    assert.equal((await response.json()).error.message, "Not authorized.");
  }
});

async function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("a missing or malformed Idempotency-Key returns 400 before params or body are read", async () => {
  for (const idempotencyKey of [null, "not-a-uuid"]) {
    let paramsRead = false;
    const response = await POST(
      requestFor("ignored", "approve", ADMIN_SECRET, idempotencyKey),
      {
        params: {
          then() {
            paramsRead = true;
            throw new Error("params must not be read");
          },
        } as unknown as Promise<{ id: string }>,
      },
    );
    assert.equal(response.status, 400);
    assert.equal(paramsRead, false);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
});

test("approve moves a pending request to approved", async () => {
  const { request, secret } = createPairingRequest(input());
  const response = await POST(requestFor(request.id, "approve"), await ctxFor(request.id));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.request.status, "approved");
  assert.equal(readPairingRequest(request.id, secret)?.status, "approved");
});

test("an exact same-key retry replays the same approved response", async () => {
  const { request } = createPairingRequest(input());
  const idempotencyKey = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(requestFor(request.id, "approve", ADMIN_SECRET, idempotencyKey), await ctxFor(request.id));
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  const replay = await POST(requestFor(request.id, "approve", ADMIN_SECRET, idempotencyKey), await ctxFor(request.id));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
});

test("reusing a decision Idempotency-Key for the opposite decision conflicts", async () => {
  const { request } = createPairingRequest(input());
  const idempotencyKey = "0f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(requestFor(request.id, "approve", ADMIN_SECRET, idempotencyKey), await ctxFor(request.id));
  assert.equal(first.status, 200);

  const conflict = await POST(requestFor(request.id, "deny", ADMIN_SECRET, idempotencyKey), await ctxFor(request.id));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
});

test("deny moves a pending request to denied", async () => {
  const { request, secret } = createPairingRequest(input());
  const response = await POST(requestFor(request.id, "deny"), await ctxFor(request.id));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.request.status, "denied");
  assert.equal(readPairingRequest(request.id, secret)?.status, "denied");
});

test("only the literal verbs approve/deny are accepted", async () => {
  const { request } = createPairingRequest(input());
  for (const decision of ["approved", "denied", "yes", "", null, 1, {}, ["approve"]]) {
    const response = await POST(requestFor(request.id, decision), await ctxFor(request.id));
    assert.equal(response.status, 400, `decision ${JSON.stringify(decision)} must be rejected`);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_request");
  }
});

test("a body missing the decision field entirely returns 400 invalid_request", async () => {
  const { request } = createPairingRequest(input());
  const response = await POST(
    new Request(`http://127.0.0.1/api/client/v1/admin/pairing-requests/${request.id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CLIENT_V1_ADMIN_HEADER]: ADMIN_SECRET,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    }),
    await ctxFor(request.id),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("a body that is a bare array, or explicitly null, is rejected — never treated as an object", async () => {
  const { request } = createPairingRequest(input());
  for (const rawBody of ['["approve"]', "null", '"approve"', "42"]) {
    const response = await POST(
      new Request(`http://127.0.0.1/api/client/v1/admin/pairing-requests/${request.id}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CLIENT_V1_ADMIN_HEADER]: ADMIN_SECRET,
          "idempotency-key": crypto.randomUUID(),
        },
        body: rawBody,
      }),
      await ctxFor(request.id),
    );
    assert.equal(response.status, 400, `body ${rawBody} must be rejected`);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_request");
  }
});

test("an extra field alongside a valid decision is rejected outright — the body shape is exact", async () => {
  const { request, secret } = createPairingRequest(input());
  const response = await POST(
    new Request(`http://127.0.0.1/api/client/v1/admin/pairing-requests/${request.id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CLIENT_V1_ADMIN_HEADER]: ADMIN_SECRET,
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ decision: "approve", scopes: ["tasks:write", "github:write"] }),
    }),
    await ctxFor(request.id),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
  // The rejected attempt must not have silently approved with the smuggled
  // scopes (or at all) — the request is still pending afterward.
  assert.equal(readPairingRequest(request.id, secret)?.status, "pending");
});

test("approval always grants exactly the scopes normalized at create time, never anything a decision body could add", async () => {
  const { request, secret } = createPairingRequest(input({ scopes: ["chat:read" as const] }));
  const response = await POST(requestFor(request.id, "approve"), await ctxFor(request.id));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.request.scopes, ["chat:read"]);
  assert.deepEqual(readPairingRequest(request.id, secret)?.scopes, ["chat:read"]);
});

test("malformed JSON returns 400 invalid_request", async () => {
  const { request } = createPairingRequest(input());
  const response = await POST(
    new Request(`http://127.0.0.1/api/client/v1/admin/pairing-requests/${request.id}/decision`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CLIENT_V1_ADMIN_HEADER]: ADMIN_SECRET,
        "idempotency-key": crypto.randomUUID(),
      },
      body: "{not json",
    }),
    await ctxFor(request.id),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("deciding an unknown/expired request returns 409 conflict", async () => {
  const response = await POST(
    requestFor("00000000-0000-4000-8000-000000000000", "approve"),
    await ctxFor("00000000-0000-4000-8000-000000000000"),
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "conflict");
});

console.log("client/v1/admin/pairing-requests/[id]/decision route.test.ts: ok");
