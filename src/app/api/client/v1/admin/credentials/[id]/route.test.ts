import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, test } from "node:test";

import { CLIENT_V1_ADMIN_HEADER } from "@/proxy-helpers";
import { clientCredentialStorePath, issueCredential, verifyCredential } from "@/lib/server/client-v1/credential-store.ts";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-admin-credential-revoke-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");

const { DELETE } = await import("./route.ts");
const ADMIN_SECRET = "admin-credential-revoke-secret";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = ADMIN_SECRET;

function adminRequest(
  url: string,
  marker: string | null = ADMIN_SECRET,
  idempotencyKey: string | null = crypto.randomUUID(),
) {
  const headers = new Headers();
  if (marker !== null) headers.set(CLIENT_V1_ADMIN_HEADER, marker);
  if (idempotencyKey !== null) headers.set("idempotency-key", idempotencyKey);
  return new Request(url, { method: "DELETE", headers });
}

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(clientCredentialStorePath(), { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
});

function approvedPairing(overrides: Partial<Parameters<typeof issueCredential>[0]> = {}) {
  return {
    appName: "OpenCoven Chat",
    installationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    scopes: ["chat:read" as const],
    status: "approved" as const,
    ...overrides,
  };
}

async function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("missing or malformed Idempotency-Key returns 400 before reading params", async () => {
  for (const idempotencyKey of [null, "not-a-uuid"]) {
    let paramsRead = false;
    const response = await DELETE(
      adminRequest("http://127.0.0.1/api/client/v1/admin/credentials/ignored", ADMIN_SECRET, idempotencyKey),
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

test("revokes a credential by id", async () => {
  const { credential, token } = await issueCredential(approvedPairing());
  const response = await DELETE(adminRequest(`http://127.0.0.1/api/client/v1/admin/credentials/${credential.id}`), await ctxFor(credential.id));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.revoked, true);
  assert.equal(await verifyCredential(token), null);
});

test("an exact same-key retry replays the original revoke success", async () => {
  const { credential, token } = await issueCredential(approvedPairing());
  const idempotencyKey = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await DELETE(
    adminRequest(`http://127.0.0.1/api/client/v1/admin/credentials/${credential.id}`, ADMIN_SECRET, idempotencyKey),
    await ctxFor(credential.id),
  );
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(await verifyCredential(token), null);

  const replay = await DELETE(
    adminRequest(`http://127.0.0.1/api/client/v1/admin/credentials/${credential.id}`, ADMIN_SECRET, idempotencyKey),
    await ctxFor(credential.id),
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
});

test("reusing a revoke Idempotency-Key for a different credential id conflicts", async () => {
  const first = await issueCredential(approvedPairing());
  const second = await issueCredential(approvedPairing({
    installationId: "aaaaaaaa-1111-4222-8333-444444444444",
  }));
  const idempotencyKey = "0f4145de-9b43-4abc-876d-81ef63de60e0";
  const initial = await DELETE(
    adminRequest(`http://127.0.0.1/api/client/v1/admin/credentials/${first.credential.id}`, ADMIN_SECRET, idempotencyKey),
    await ctxFor(first.credential.id),
  );
  assert.equal(initial.status, 200);

  const conflict = await DELETE(
    adminRequest(`http://127.0.0.1/api/client/v1/admin/credentials/${second.credential.id}`, ADMIN_SECRET, idempotencyKey),
    await ctxFor(second.credential.id),
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
});

test("revoking an unknown credential id returns 404 not_found", async () => {
  const response = await DELETE(
    adminRequest("http://127.0.0.1/api/client/v1/admin/credentials/00000000-0000-4000-8000-000000000000"),
    await ctxFor("00000000-0000-4000-8000-000000000000"),
  );
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "not_found");
});

test("missing or forged proxy admin marker returns generic 403 before reading params", async () => {
  for (const marker of [null, "forged"]) {
    let paramsRead = false;
    const response = await DELETE(adminRequest(
      "http://127.0.0.1/api/client/v1/admin/credentials/ignored",
      marker,
    ), {
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

console.log("client/v1/admin/credentials/[id] route.test.ts: ok");
