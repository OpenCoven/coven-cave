import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import type { ApprovedPairing } from "./pairing-store.ts";

const workdir = path.join(process.cwd(), ".codex-tmp", `client-v1-auth-${process.pid}`);
await mkdir(workdir, { recursive: true });
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "credentials.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-local-secret-for-test";

const { issueCredential, listCredentials } = await import("./credential-store.ts");
const { requireClientPrincipal } = await import("./auth.ts");
const {
  clientV1RateLimitSnapshotForTest,
  consumeClientV1RateLimit,
  resetClientV1RateLimitsForTest,
} = await import("./rate-limit.ts");
const authSource = await readFile(new URL("./auth.ts", import.meta.url), "utf8");

const APPROVED: ApprovedPairing = {
  id: "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66",
  appName: "Cave iOS",
  installationId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  scopes: ["chat:write"],
  status: "approved",
  createdAt: 1_000,
  expiresAt: 301_000,
  consumedAt: 1_100,
};

function request(
  token?: string,
  marker: string | null | undefined = process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  if (marker !== undefined && marker !== null) headers.set("x-coven-client-v1-local", marker);
  return new Request("http://127.0.0.1/api/client/v1/conversations", { headers });
}

after(async () => {
  delete process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH;
  delete process.env.COVEN_CAVE_LOCAL_PEER_SECRET;
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetClientV1RateLimitsForTest();
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!}.locks`, {
    recursive: true,
    force: true,
  });
});

test("requireClientPrincipal rejects an absent bearer with the stable v1 unauthorized response", async () => {
  const result = await requireClientPrincipal(request(), "chat:write", 10_000);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "unauthorized",
      message: "A valid client bearer token is required.",
      retryable: false,
    },
  });
});

test("requireClientPrincipal rejects a missing, forged, or empty local marker", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  for (const marker of [null, "", "caller-supplied-marker"]) {
    const result = await requireClientPrincipal(request(issued.token, marker), "chat:write", 10_000);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 401);
      assert.equal((await result.response.json()).error.code, "unauthorized");
    }
  }
});

test("Authorization parsing accepts exactly one strict Bearer credential", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  const malformed = [
    issued.token,
    `bearer ${issued.token}`,
    `Bearer  ${issued.token}`,
    `Bearer\t${issued.token}`,
    `Bearer ${issued.token} trailing`,
    `Basic ${issued.token}`,
  ];
  for (const authorization of malformed) {
    const req = request(undefined);
    req.headers.set("authorization", authorization);
    const result = await requireClientPrincipal(req, "chat:write", 10_000);
    assert.equal(result.ok, false, authorization);
    if (!result.ok) assert.equal(result.response.status, 401);
  }
});

test("an invalid token does not consume the authenticated-client quota", async () => {
  for (let index = 0; index < 5; index += 1) {
    const invalidToken = `${"A".repeat(42)}${index}`;
    const result = await requireClientPrincipal(request(invalidToken), "chat:write", 10_000);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(clientV1RateLimitSnapshotForTest(), []);

  const issued = await issueCredential(APPROVED, 2_000);
  const valid = await requireClientPrincipal(request(issued.token), "chat:write", 10_000);
  assert.equal(valid.ok, true);
  assert.equal(clientV1RateLimitSnapshotForTest()[0]?.count, 1);
});

test("an exhausted authenticated bucket returns stable retry metadata", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  for (let index = 0; index < 120; index += 1) {
    assert.equal(
      consumeClientV1RateLimit("authenticated", issued.credential.id, 10_000).allowed,
      true,
    );
  }

  const result = await requireClientPrincipal(request(issued.token), "chat:write", 10_001);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get("retry-after"), "60");
  assert.deepEqual(await result.response.json(), {
    ok: false,
    error: {
      code: "rate_limited",
      message: "The authenticated client request limit was exceeded.",
      retryable: true,
      details: {
        limit: "120",
        resetAt: "70000",
        retryAfterSeconds: "60",
      },
    },
  });
});

test("an under-scoped credential is rejected with scope_denied after verification", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  const result = await requireClientPrincipal(request(issued.token), "chat:read", 10_000);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 403);
  assert.equal((await result.response.json()).error.code, "scope_denied");
  assert.deepEqual(
    clientV1RateLimitSnapshotForTest(),
    [],
    "an under-scoped credential must not consume the valid-client quota",
  );
});

test("authenticated quota is isolated by verified credential id, not request hostname", async () => {
  const first = await issueCredential(APPROVED, 2_000);
  const second = await issueCredential(
    {
      ...APPROVED,
      id: "1248a3c6-1b0e-4a15-8416-1d65bf7fae66",
      installationId: "4fa85f64-5717-4562-b3fc-2c963f66afa6",
    },
    2_001,
  );

  assert.equal((await requireClientPrincipal(request(first.token), "chat:write", 10_000)).ok, true);
  assert.equal((await requireClientPrincipal(request(second.token), "chat:write", 10_000)).ok, true);
  assert.deepEqual(
    clientV1RateLimitSnapshotForTest().map(({ peer, count }) => ({ peer, count })),
    [
      { peer: first.credential.id, count: 1 },
      { peer: second.credential.id, count: 1 },
    ],
  );
});

test("a valid scoped credential returns its safe client principal", async () => {
  const issued = await issueCredential(APPROVED, 2_000);
  const result = await requireClientPrincipal(request(issued.token), "chat:write", 10_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.principal, {
    ...issued.credential,
    lastUsedAt: 10_000,
  });
  assert.ok(!("tokenHash" in result.principal));
});

test("lastUsedAt is persisted at most once per minute while every request re-verifies revocation", async () => {
  const issued = await issueCredential(APPROVED, 2_000);

  assert.equal((await requireClientPrincipal(request(issued.token), "chat:write", 10_000)).ok, true);
  const firstDisk = await readFile(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, "utf8");
  assert.equal((await listCredentials())[0]?.lastUsedAt, 10_000);

  assert.equal((await requireClientPrincipal(request(issued.token), "chat:write", 69_999)).ok, true);
  assert.equal((await listCredentials())[0]?.lastUsedAt, 10_000);
  assert.equal(
    await readFile(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, "utf8"),
    firstDisk,
    "a throttled last-used check must not rewrite the credential store",
  );

  assert.equal((await requireClientPrincipal(request(issued.token), "chat:write", 70_000)).ok, true);
  assert.equal((await listCredentials())[0]?.lastUsedAt, 70_000);
});

assert.match(
  authSource,
  /if \(!expected \|\| !supplied\) return false;\s*return timingSafeEqualString\(supplied, expected\);/,
  "the internal local marker must be compared in constant time after nonempty checks",
);
{
  const scopeIdx = authSource.indexOf("if (!principal.scopes.includes(requiredScope))");
  const rateLimitIdx = authSource.indexOf("const rateLimit = consumeClientV1RateLimit");
  assert.ok(
    scopeIdx > 0 && rateLimitIdx > scopeIdx,
    "required-scope validation must run before authenticated quota consumption",
  );
  assert.match(
    authSource.slice(rateLimitIdx),
    /consumeClientV1RateLimit\(\s*"authenticated",\s*principal\.id,/,
    "authenticated rate limits must key on the verified credential id",
  );
}
console.log("auth.test.ts: ok");
