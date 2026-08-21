import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";

import { createAdminPairingRequestsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-pairing-");

test("lists pending pairing metadata without any secret material", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const pending = runtime.pairingStore.create({
      appName: "OpenCoven Chat",
      installationId: "chat-install-pending",
      scopes: ["chat:read", "chat:write"],
    });
    const approved = runtime.pairingStore.create({
      appName: "Other Client",
      installationId: "other-install-approved",
      scopes: ["tasks:write"],
    });
    now += 1;
    assert.equal(runtime.pairingStore.decide(approved.id, "approved", now), true);

    const response = await createAdminPairingRequestsGetHandler(runtime)();
    const payload = await response.json() as {
      ok: boolean;
      pairingRequests: unknown[];
    };
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.pairingRequests, [{
      id: pending.id,
      appName: "OpenCoven Chat",
      installationId: "chat-install-pending",
      scopes: ["chat:read", "chat:write"],
      status: "pending",
      createdAt: 1_000,
      expiresAt: pending.expiresAt,
      decidedAt: null,
    }]);
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(pending.secret), false);
    assert.equal(/secretHash|bearerHash|bearer/u.test(serialized), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
