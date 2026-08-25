import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { ClientV1AuthorityRuntime } from "./authority-runtime.ts";
import { createClientV1Runtime } from "./runtime.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-runtime-");

test("composes authority, pairing, credential, auth, rate-limit, and clock services", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 1_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });

    assert.equal(runtime.authority.mode, "off");
    assert.equal(runtime.now(), 1_000);
    assert.equal(runtime.authenticator.isTrustedLoopback("loopback-secret"), true);
    assert.equal(runtime.authenticator.isTrustedLoopback("wrong"), false);

    const pairing = runtime.pairingStore.create({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
    });
    assert.equal(runtime.pairingStore.poll(pairing.id, pairing.secret)?.status, "pending");

    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
    });
    now = 61_000;
    assert.equal(
      (await runtime.authenticator.requireScope({
        bearer: issued.bearer,
        scope: "chat:read",
      })).ok,
      true,
    );
    assert.equal(runtime.rateLimiter.consumePairingCreate("loopback-secret").allowed, true);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("uses an injected authority without changing synchronous runtime creation", () => {
  const authority: ClientV1AuthorityRuntime = {
    mode: "enforce",
    handle: async ({ request, invoke }) => invoke(request),
  };
  const runtime = createClientV1Runtime({
    authority,
    loopbackSecret: "loopback-secret",
    now: () => 1_000,
  });

  assert.strictEqual(runtime.authority, authority);
});
