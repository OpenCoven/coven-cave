import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, after, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";
import {
  createPairingRequest,
  decidePairingRequest,
  MAX_PAIRING_REQUESTS,
  PAIRING_TTL_MS,
  resetPairingRequestsForTest,
} from "@/lib/server/client-v1/pairing-store.ts";
import {
  clientCredentialSettlementJournalPath,
  clientCredentialStorePath,
  setReadFileForTest,
  verifyCredential,
} from "@/lib/server/client-v1/credential-store.ts";

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

// Lives inside this worktree's own `process.cwd()` — never `os.tmpdir()` and
// never anywhere outside this repo's granted filesystem boundary. Only this
// exact directory is removed on cleanup.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-exchange-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const { POST } = await import("./route.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

afterEach(async () => {
  resetPairingRequestsForTest();
  await Promise.all([
    rm(clientCredentialStorePath(), { force: true }),
    rm(clientCredentialSettlementJournalPath(), { force: true }),
  ]);
  setReadFileForTest(null);
});

const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";

function input(overrides: Record<string, unknown> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read" as const, "chat:write" as const],
    ...overrides,
  };
}

function requestFor(
  id: string,
  secret: string | null,
  options: { marker?: string | null; idempotencyKey?: string | null } = {},
) {
  const headers = new Headers();
  if (secret !== null) headers.set(PAIRING_SECRET_HEADER, secret);
  const marker = options.marker === undefined ? LOCAL_PEER_SECRET : options.marker;
  if (marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, marker);
  if (options.idempotencyKey !== null) {
    headers.set("idempotency-key", options.idempotencyKey ?? crypto.randomUUID());
  }
  return new Request(`http://127.0.0.1/api/client/v1/pairing/requests/${id}/exchange`, {
    method: "POST",
    headers,
  });
}

async function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("an absent or forged internal marker returns 403 unauthorized and cannot consume a valid pairing, before params/secrets are even parsed", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");

  for (const marker of [null, "guessed-value"]) {
    const response = await POST(requestFor(request.id, secret, { marker }), await ctxFor(request.id));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "unauthorized");
  }

  // The approved pairing must remain unconsumed — a legitimate exchange with
  // the trusted marker must still succeed exactly once afterward.
  const legitimate = await POST(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(legitimate.status, 200);
  const legitimateBody = await legitimate.json();
  assert.equal(legitimateBody.ok, true);
  assert.equal(typeof legitimateBody.token, "string");
});

test("a missing or malformed Idempotency-Key returns 400 before params are read", async () => {
  for (const idempotencyKey of [null, "not-a-uuid"]) {
    let paramsRead = false;
    const response = await POST(
      requestFor("ignored", "secret", { idempotencyKey }),
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

test("an approved pairing exchanges for a bearer token exactly once", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");

  const response = await POST(
    requestFor(request.id, secret, { idempotencyKey: "2f4145de-9b43-4abc-876d-81ef63de60e0" }),
    await ctxFor(request.id),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 20);
  assert.equal(body.credential.appName, "OpenCoven Chat");
  assert.equal(body.credential.installationId, "9f4145de-9b43-4abc-876d-81ef63de60e0");
  assert.deepEqual(body.credential.scopes, ["chat:read", "chat:write"]);

  const verified = await verifyCredential(body.token);
  assert.equal(verified?.id, body.credential.id);
});

test("an exact same-key replay after success returns a typed already-exchanged result instead of issuing a second credential", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const idempotencyKey = "3f4145de-9b43-4abc-876d-81ef63de60e0";

  const first = await POST(
    requestFor(request.id, secret, { idempotencyKey }),
    await ctxFor(request.id),
  );
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  const replay = await POST(
    requestFor(request.id, secret, { idempotencyKey }),
    await ctxFor(request.id),
  );
  assert.equal(replay.status, 409);
  const body = await replay.json();
  assert.equal(body.error.code, "pairing_already_exchanged");
  assert.equal(body.error.retryable, false);
  assert.deepEqual(body.error.details.credential, {
    id: firstBody.credential.id,
    appName: firstBody.credential.appName,
    installationId: firstBody.credential.installationId,
    scopes: firstBody.credential.scopes,
    createdAt: firstBody.credential.createdAt,
  });
});

test("a different Idempotency-Key after a successful exchange still gets the generic pairing_expired result", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const first = await POST(
    requestFor(request.id, secret, { idempotencyKey: "4f4145de-9b43-4abc-876d-81ef63de60e0" }),
    await ctxFor(request.id),
  );
  assert.equal(first.status, 200);

  const differentKey = await POST(
    requestFor(request.id, secret, { idempotencyKey: "5f4145de-9b43-4abc-876d-81ef63de60e0" }),
    await ctxFor(request.id),
  );
  assert.equal(differentKey.status, 410);
  assert.equal((await differentKey.json()).error.code, "pairing_expired");
});

test("a still-pending pairing is rejected with pairing_pending, distinct from denial", async () => {
  const { request, secret } = createPairingRequest(input());
  const response = await POST(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "pairing_pending");
  assert.equal(body.error.retryable, true);
});

test("a denied pairing is rejected with pairing_denied", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "denied");
  const response = await POST(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "pairing_denied");
  assert.equal(body.error.retryable, false);
});

test("a wrong secret is rejected the same way as an unknown id (pairing_expired, never a distinguishing detail)", async () => {
  const { request } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");

  const wrongSecret = await POST(requestFor(request.id, "wrong-secret"), await ctxFor(request.id));
  const unknownId = await POST(
    requestFor("00000000-0000-4000-8000-000000000000", "any-secret"),
    await ctxFor("00000000-0000-4000-8000-000000000000"),
  );
  assert.equal(wrongSecret.status, 410);
  assert.equal(unknownId.status, 410);
  const wrongBody = await wrongSecret.json();
  const unknownBody = await unknownId.json();
  assert.deepEqual(wrongBody, unknownBody);
});

test("an expired pairing is rejected with pairing_expired", async () => {
  const longAgo = Date.now() - PAIRING_TTL_MS - 60_000;
  const { request, secret } = createPairingRequest(input(), longAgo);
  const response = await POST(requestFor(request.id, secret), await ctxFor(request.id));
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.error.code, "pairing_expired");
});

test("a re-pair for the same installation revokes the prior credential's token", async () => {
  const firstApproved = createPairingRequest(input());
  decidePairingRequest(firstApproved.request.id, "approved");
  const firstExchange = await POST(
   requestFor(firstApproved.request.id, firstApproved.secret, {
     idempotencyKey: "6f4145de-9b43-4abc-876d-81ef63de60e0",
   }),
   await ctxFor(firstApproved.request.id),
  );
  const firstBody = await firstExchange.json();

  const secondApproved = createPairingRequest(input());
  decidePairingRequest(secondApproved.request.id, "approved");
  await POST(
   requestFor(secondApproved.request.id, secondApproved.secret, {
     idempotencyKey: "7f4145de-9b43-4abc-876d-81ef63de60e0",
   }),
   await ctxFor(secondApproved.request.id),
  );

  const stillValid = await verifyCredential(firstBody.token);
  assert.equal(stillValid, null, "re-pairing the same installation must revoke its prior token");
});

test("creating a 65th pairing request evicts the oldest to enforce the 64 cap, and exchanging that evicted request — with either its correct secret or a wrong one — reports the same generic pairing_expired", async () => {
  const entries: Array<{ id: string; secret: string }> = [];
  for (let index = 0; index < MAX_PAIRING_REQUESTS; index += 1) {
    const { request, secret } = createPairingRequest(
      input({ installationId: `ef8b1b3e-9c1a-4f0a-8b1a-${String(index).padStart(12, "0")}` }),
    );
    decidePairingRequest(request.id, "approved");
    entries.push({ id: request.id, secret });
  }

  // The 65th create is the only thing allowed to evict — exactly the oldest.
  createPairingRequest(input({ installationId: "ef8b1b3e-9c1a-4f0a-8b1a-999999999999" }));

  const oldest = entries[0];
  const wrongSecretExchange = await POST(requestFor(oldest.id, "wrong-secret"), await ctxFor(oldest.id));
  assert.equal(wrongSecretExchange.status, 410);
  const wrongSecretBody = await wrongSecretExchange.json();
  assert.equal(wrongSecretBody.error.code, "pairing_expired");

  const correctSecretExchange = await POST(requestFor(oldest.id, oldest.secret), await ctxFor(oldest.id));
  assert.equal(
    correctSecretExchange.status,
    410,
    "the evicted (and now-tombstoned) request can never be exchanged, even with its own correct secret",
  );
  const correctSecretBody = await correctSecretExchange.json();
  assert.deepEqual(
    correctSecretBody,
    wrongSecretBody,
    "the evicted request's exchange failure is indistinguishable regardless of which secret was presented",
  );
});

test("a real credential-store read failure during exchange preserves the approved request as retryable, and never leaks the underlying error", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const idempotencyKey = "8f4145de-9b43-4abc-876d-81ef63de60e0";

  setReadFileForTest(async () => {
    const err = new Error("permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    throw err;
  });

  const failed = await POST(requestFor(request.id, secret, { idempotencyKey }), await ctxFor(request.id));
  assert.equal(failed.status, 503);
  const failedBody = await failed.json();
  assert.equal(failedBody.ok, false);
  assert.equal(failedBody.error.code, "service_unavailable");
  assert.equal(failedBody.error.retryable, true);
  assert.doesNotMatch(
    JSON.stringify(failedBody),
    /EACCES|permission denied|secretHash|CredentialStoreIntegrityError/,
    "the response must never leak the underlying store error, a stack trace, or any secret material",
  );

  setReadFileForTest(null);
  const retry = await POST(requestFor(request.id, secret, { idempotencyKey }), await ctxFor(request.id));
  assert.equal(retry.status, 200, "the approved request must have survived the failure and be retryable");
  const retryBody = await retry.json();
  assert.equal(retryBody.ok, true);
  assert.equal(typeof retryBody.token, "string");
});

test("two concurrent exact-duplicate exchanges with the same key never double-issue", async () => {
  const { request, secret } = createPairingRequest(input());
  decidePairingRequest(request.id, "approved");
  const idempotencyKey = "af4145de-9b43-4abc-876d-81ef63de60e0";

  const [first, second] = await Promise.all([
    POST(requestFor(request.id, secret, { idempotencyKey }), await ctxFor(request.id)),
    POST(requestFor(request.id, secret, { idempotencyKey }), await ctxFor(request.id)),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409], "exactly one concurrent exchange must succeed");

  const okResponse = first.status === 200 ? first : second;
  const okBody = await okResponse.json();
  assert.equal(okBody.ok, true);
  assert.equal(typeof okBody.token, "string");

  const duplicateResponse = first.status === 409 ? first : second;
  const duplicateBody = await duplicateResponse.json();
  assert.ok(
    duplicateBody.error.code === "conflict" || duplicateBody.error.code === "pairing_already_exchanged",
    "the duplicate either caught the in-flight claim or arrived after the one-time reveal completed",
  );
  if (duplicateBody.error.code === "conflict") {
    assert.equal(duplicateBody.error.retryable, true);
    assert.ok(Number(duplicateResponse.headers.get("Retry-After")) >= 1);
  } else {
    assert.equal(duplicateBody.error.retryable, false);
  }

  const verified = await verifyCredential(okBody.token);
  assert.ok(verified, "the single issued token must actually verify");
});

console.log("client/v1/pairing/requests/[id]/exchange route.test.ts: ok");
