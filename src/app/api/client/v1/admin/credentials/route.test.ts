import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";

import { createAdminCredentialsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-credentials-");

test("lists persisted active and revoked credential metadata without bearer material", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 4_000;
    const writer = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const active = await writer.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-active",
      scopes: ["chat:read"],
    });
    const revoked = await writer.credentialStore.issue({
      appName: "Other Client",
      installationId: "other-install-revoked",
      scopes: ["tasks:write"],
    });
    now = 5_000;
    await writer.credentialStore.revoke(revoked.credential.id, "operator revoked");

    const reader = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const response = await createAdminCredentialsGetHandler(reader)();
    const payload = await response.json() as {
      ok: boolean;
      credentials: Array<Record<string, unknown>>;
    };
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.credentials.length, 2);
    assert.deepEqual(
      payload.credentials.map((credential) => credential.id),
      [active.credential.id, revoked.credential.id],
    );
    assert.equal(payload.credentials[1].revocationReason, "operator revoked");
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(active.bearer), false);
    assert.equal(serialized.includes(revoked.bearer), false);
    assert.equal(/bearerHash|secretHash/u.test(serialized), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
