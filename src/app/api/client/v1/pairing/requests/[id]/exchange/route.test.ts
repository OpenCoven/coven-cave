import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { CLIENT_V1_CREDENTIAL_STORE_FILE } from "@/lib/server/client-v1/credential-store.ts";
import { CLIENT_V1_PAIRING_CREATE_LIMIT } from "@/lib/server/client-v1/rate-limit.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createPairingExchangePostHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-exchange-");
const secretHeader = "X-Coven-Pairing-Secret";
const pairingInput = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-1",
  scopes: ["chat:read" as const, "chat:write" as const],
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string, secret: string): Request {
  return new Request(
    `http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}/exchange`,
    {
      method: "POST",
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        [secretHeader]: secret,
      },
    },
  );
}

test("exchanges an approved request once and persists only the bearer hash", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);
    now = 1_100;
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", now), true);

    const response = await handler(request(issued.id, issued.secret), context(issued.id));
    const payload = await response.json() as {
      data: {
        bearer: string;
        credential: {
          id: string;
          appName: string;
          installationId: string;
          scopes: string[];
          createdAt: number;
          lastUsedAt: number | null;
          revokedAt: number | null;
          revocationReason: string | null;
        };
      };
    };
    assert.equal(response.status, 200);
    assert.match(payload.data.bearer, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(payload.data.credential, {
      id: payload.data.credential.id,
      appName: pairingInput.appName,
      installationId: pairingInput.installationId,
      scopes: pairingInput.scopes,
      createdAt: 1_100,
      lastUsedAt: null,
      revokedAt: null,
      revocationReason: null,
    });
    const persisted = await readFile(
      resolve(root, CLIENT_V1_CREDENTIAL_STORE_FILE),
      "utf8",
    );
    assert.equal(persisted.includes(payload.data.bearer), false);

    const replay = await handler(request(issued.id, issued.secret), context(issued.id));
    const replayPayload = await replay.json() as {
      error: { code: string; details?: { reason?: string } };
    };
    assert.equal(replay.status, 409);
    assert.equal(replayPayload.error.code, "conflict");
    assert.equal(replayPayload.error.details?.reason, "pairing_replayed");
    assert.equal(JSON.stringify(replayPayload).includes(issued.secret), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("exchange explicitly reports pending, denied, expired, bad-secret, and rate-limit failures", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 5_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingExchangePostHandler(runtime);

    const pending = runtime.pairingStore.create(pairingInput);
    const pendingResponse = await handler(
      request(pending.id, pending.secret),
      context(pending.id),
    );
    assert.equal(pendingResponse.status, 409);
    assert.equal(
      ((await pendingResponse.json()) as { error: { code: string } }).error.code,
      "pairing_pending",
    );

    const denied = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-denied",
    });
    assert.equal(runtime.pairingStore.decide(denied.id, "denied", now + 1), true);
    const deniedResponse = await handler(
      request(denied.id, denied.secret),
      context(denied.id),
    );
    assert.equal(deniedResponse.status, 403);
    assert.equal(
      ((await deniedResponse.json()) as { error: { code: string } }).error.code,
      "pairing_denied",
    );

    const expiring = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-expired",
    });
    now = expiring.expiresAt;
    const expiredResponse = await handler(
      request(expiring.id, expiring.secret),
      context(expiring.id),
    );
    assert.equal(expiredResponse.status, 410);
    assert.equal(
      ((await expiredResponse.json()) as { error: { code: string } }).error.code,
      "pairing_expired",
    );

    const approved = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-approved",
    });
    now += 1;
    assert.equal(runtime.pairingStore.decide(approved.id, "approved", now), true);
    const badSecret = await handler(
      request(approved.id, "wrong-secret"),
      context(approved.id),
    );
    assert.equal(badSecret.status, 401);
    assert.equal(
      ((await badSecret.json()) as { error: { code: string } }).error.code,
      "unauthorized",
    );

    const limitedRuntime = createClientV1Runtime({
      credentialRoot: resolve(root, "limited"),
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const limitedHandler = createPairingExchangePostHandler(limitedRuntime);
    const limited = limitedRuntime.pairingStore.create(pairingInput);
    assert.equal(limitedRuntime.pairingStore.decide(limited.id, "approved", now), true);
    for (let attempt = 0; attempt < CLIENT_V1_PAIRING_CREATE_LIMIT; attempt += 1) {
      assert.equal(
        limitedRuntime.rateLimiter.consumePairingCreate("loopback-secret").allowed,
        true,
      );
    }
    const limitedResponse = await limitedHandler(
      request(limited.id, limited.secret),
      context(limited.id),
    );
    assert.equal(limitedResponse.status, 429);
    assert.equal(
      ((await limitedResponse.json()) as { error: { code: string } }).error.code,
      "rate_limited",
    );
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
