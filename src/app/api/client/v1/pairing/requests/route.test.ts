import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";
import { resetPairingRequestsForTest } from "@/lib/server/client-v1/pairing-store.ts";
import { resetRateLimitsForTest } from "@/lib/server/client-v1/rate-limit.ts";

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { POST } = await import("./route.ts");

afterEach(() => {
  resetPairingRequestsForTest();
  resetRateLimitsForTest();
});

function pairingBody(overrides: Record<string, unknown> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read", "chat:write"],
    ...overrides,
  };
}

function requestWith(options: {
  marker?: string | null;
  idempotencyKey?: string | null;
  body?: unknown;
  rawBody?: string;
} = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, options.marker ?? LOCAL_PEER_SECRET);
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? crypto.randomUUID());
  }
  return new Request("http://127.0.0.1/api/client/v1/pairing/requests", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? pairingBody()),
  });
}

test("an absent or wrong internal marker returns 403 unauthorized, before the body is even parsed", async () => {
  for (const marker of [null, "guessed-value"]) {
    const response = await POST(requestWith({ marker, rawBody: "{not json" }));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "unauthorized");
  }
});

test("malformed JSON returns 400 invalid_request", async () => {
  const response = await POST(requestWith({ rawBody: "{not json" }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "invalid_request");
});

test("a missing or malformed Idempotency-Key returns 400 before the body is parsed", async () => {
  for (const idempotencyKey of [null, "not-a-uuid"]) {
    const response = await POST(requestWith({ idempotencyKey, rawBody: "{not json" }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_request");
  }
});

test("an unknown scope returns 400 invalid_request", async () => {
  const response = await POST(requestWith({ body: pairingBody({ scopes: ["admin"] }) }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("a non-UUID installationId returns 400 invalid_request", async () => {
  const response = await POST(requestWith({ body: pairingBody({ installationId: "not-a-uuid" }) }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("a body carrying any field beyond appName/installationId/scopes returns 400 invalid_request", async () => {
  const response = await POST(requestWith({ body: pairingBody({ role: "admin" }) }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("a valid pairing request returns the stable create envelope", async () => {
  const response = await POST(requestWith());
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.pairing.status, "pending");
  assert.match(body.pairing.id, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof body.pairing.secret, "string");
  assert.ok(body.pairing.secret.length > 20);
  assert.equal(typeof body.pairing.expiresAt, "number");
  assert.deepEqual(Object.keys(body.pairing).sort(), ["expiresAt", "id", "secret", "status"]);
});

test("an exact same-key retry replays the same pairing id and secret", async () => {
  const idempotencyKey = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(requestWith({ idempotencyKey }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();

  const replay = await POST(requestWith({ idempotencyKey }));
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), firstBody);
});

test("reusing a create Idempotency-Key for a different body conflicts", async () => {
  const idempotencyKey = "0f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(requestWith({ idempotencyKey }));
  assert.equal(first.status, 201);

  const conflict = await POST(
    requestWith({
      idempotencyKey,
      body: pairingBody({ scopes: ["chat:read"] }),
    }),
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
});

test("pairing create is rate limited for the loopback peer: the 11th create within a minute is rejected", async () => {
  const installationId = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  for (let i = 0; i < 10; i++) {
    const response = await POST(
      requestWith({ body: pairingBody({ installationId }) }),
    );
    assert.equal(response.status, 201, `create ${i + 1} of 10 should succeed`);
  }
  const eleventh = await POST(requestWith({ body: pairingBody({ installationId }) }));
  assert.equal(eleventh.status, 429);
  const body = await eleventh.json();
  assert.equal(body.error.code, "rate_limited");
  assert.ok(Number(eleventh.headers.get("Retry-After")) >= 1);
});

test("an exact same-key create retry bypasses the loopback rate limit and replays after the budget is exhausted", async () => {
  const idempotencyKey = "1f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(requestWith({ idempotencyKey }));
  assert.equal(first.status, 201);
  const expected = await first.json();

  for (let i = 0; i < 9; i++) {
    const response = await POST(
      requestWith({
        idempotencyKey: crypto.randomUUID(),
        body: pairingBody({
          installationId: `9f4145de-9b43-4abc-876d-81ef63de6${String(i).padStart(3, "0")}`,
        }),
      }),
    );
    assert.equal(response.status, 201);
  }
  const exhausted = await POST(
    requestWith({
      idempotencyKey: crypto.randomUUID(),
      body: pairingBody({ installationId: "9f4145de-9b43-4abc-876d-81ef63de6999" }),
    }),
  );
  assert.equal(exhausted.status, 429);

  const replay = await POST(requestWith({ idempotencyKey }));
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), expected);
});

test("the pairing-create limit is keyed to the loopback peer, not the caller-supplied installationId: 10 requests using 10 distinct installation ids succeed, the 11th (an 11th distinct id) is rejected, and it resets", async () => {
  // Ten DISTINCT installation ids still share the single loopback budget —
  // proving the limiter is keyed by a fixed, server-derived loopback key and
  // not by `installationId`, which a caller fully controls and could
  // otherwise rotate per request to bypass the limit entirely.
  const installationIds = Array.from(
    { length: 11 },
    (_, i) => `9f4145de-9b43-4abc-876d-81ef63de6${String(i).padStart(3, "0")}`,
  );

  for (let i = 0; i < 10; i++) {
    const response = await POST(requestWith({ body: pairingBody({ installationId: installationIds[i] }) }));
    assert.equal(response.status, 201, `create ${i + 1} of 10 (installationId ${installationIds[i]}) should succeed`);
  }

  const eleventh = await POST(
    requestWith({ body: pairingBody({ installationId: installationIds[10] }) }),
  );
  assert.equal(
    eleventh.status,
    429,
    "the 11th create must be rejected even though it uses a brand-new installationId never seen before",
  );
  const body = await eleventh.json();
  assert.equal(body.error.code, "rate_limited");
  assert.ok(Number(eleventh.headers.get("Retry-After")) >= 1);

  // Resetting the rate limiter (as `afterEach` does between tests) frees the
  // shared loopback budget again, regardless of which installationId is used
  // next.
  resetRateLimitsForTest();
  const afterReset = await POST(
    requestWith({ body: pairingBody({ installationId: installationIds[10] }) }),
  );
  assert.equal(afterReset.status, 201, "after a reset, the loopback peer's budget is fresh again");
});

console.log("client/v1/pairing/requests route.test.ts: ok");
