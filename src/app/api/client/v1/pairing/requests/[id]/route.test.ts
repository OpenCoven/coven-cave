import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { PAIRING_TTL_MS } from "@/lib/server/client-v1/pairing-store.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";

import { createPairingRequestGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-poll-");
const secretHeader = "X-Coven-Pairing-Secret";
const pairingInput = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-1",
  scopes: ["chat:read" as const],
};

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(id: string, secret?: string, querySecret?: string): Request {
  const url = new URL(`http://127.0.0.1:3020/api/client/v1/pairing/requests/${id}`);
  if (querySecret) url.searchParams.set("secret", querySecret);
  return new Request(url, {
    headers: secret ? { [secretHeader]: secret } : undefined,
  });
}

test("poll exposes only id, status, and expiry across the complete lifecycle", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createPairingRequestGetHandler(runtime);

    for (const decision of [null, "approved", "denied"] as const) {
      const issued = runtime.pairingStore.create({
        ...pairingInput,
        installationId: `chat-install-${decision ?? "pending"}`,
      });
      if (decision) {
        now += 1;
        assert.equal(runtime.pairingStore.decide(issued.id, decision, now), true);
      }
      const response = await handler(request(issued.id, issued.secret), context(issued.id));
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as { data: unknown }).data, {
        id: issued.id,
        status: decision ?? "pending",
        expiresAt: issued.expiresAt,
      });
    }

    const expiring = runtime.pairingStore.create(pairingInput);
    now = expiring.createdAt + PAIRING_TTL_MS;
    const expired = await handler(
      request(expiring.id, expiring.secret),
      context(expiring.id),
    );
    assert.equal(expired.status, 200);
    assert.deepEqual((await expired.json() as { data: unknown }).data, {
      id: expiring.id,
      status: "expired",
      expiresAt: expiring.expiresAt,
    });
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("poll accepts pairing secrets only from the reviewed header", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 1_000,
    });
    const handler = createPairingRequestGetHandler(runtime);
    const issued = runtime.pairingStore.create(pairingInput);

    for (const candidate of [
      request(issued.id),
      request(issued.id, "wrong-secret"),
      request(issued.id, undefined, issued.secret),
    ]) {
      const response = await handler(candidate, context(issued.id));
      const body = await response.json() as { error: { code: string } };
      assert.equal(response.status, 401);
      assert.equal(body.error.code, "unauthorized");
      assert.equal(JSON.stringify(body).includes(issued.secret), false);
    }
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
