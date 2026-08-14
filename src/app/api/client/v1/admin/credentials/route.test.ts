import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, test } from "node:test";

import { CLIENT_V1_ADMIN_HEADER } from "@/proxy-helpers";
import { clientCredentialStorePath, issueCredential } from "@/lib/server/client-v1/credential-store.ts";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-admin-credentials-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");

const { GET } = await import("./route.ts");
const ADMIN_SECRET = "admin-credentials-list-secret";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = ADMIN_SECRET;

function adminRequest(marker = ADMIN_SECRET) {
  return new Request("http://127.0.0.1/api/client/v1/admin/credentials", {
    headers: { [CLIENT_V1_ADMIN_HEADER]: marker },
  });
}

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(clientCredentialStorePath(), { force: true });
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

test("lists issued credentials without ever exposing tokenHash", async () => {
  const { credential, token } = await issueCredential(approvedPairing());
  const response = await GET(adminRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.credentials.length, 1);
  assert.equal(body.credentials[0].id, credential.id);
  assert.equal("tokenHash" in body.credentials[0], false);
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(token), false, "the raw bearer token must never appear in the listing");
});

test("an empty credential store returns an empty list", async () => {
  const response = await GET(adminRequest());
  const body = await response.json();
  assert.deepEqual(body.credentials, []);
});

test("missing or forged proxy admin marker returns the same generic 403", async () => {
  for (const request of [
    new Request("http://127.0.0.1/api/client/v1/admin/credentials"),
    adminRequest("forged"),
  ]) {
    const response = await GET(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.message, "Not authorized.");
  }
});

console.log("client/v1/admin/credentials route.test.ts: ok");
