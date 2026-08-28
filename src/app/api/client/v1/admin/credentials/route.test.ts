import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";

import { createClientV1Authenticator } from "@/lib/server/client-v1/auth.ts";
import { createClientV1AuthorityRuntimeFromGlobal } from "@/lib/server/client-v1/authority-runtime.ts";
import { createCredentialStore } from "@/lib/server/client-v1/credential-store.ts";
import { createPairingStore } from "@/lib/server/client-v1/pairing-store.ts";
import { createClientV1RateLimiter } from "@/lib/server/client-v1/rate-limit.ts";
import { createClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { TOKEN_HEADER } from "@/proxy-helpers.ts";

import { createAdminCredentialsGetHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-credentials-");
const adminSecret = "sidecar-admin-secret";
const originalAdminSecret = process.env.COVEN_CAVE_AUTH_TOKEN;
process.env.COVEN_CAVE_AUTH_TOKEN = adminSecret;

after(() => {
  if (originalAdminSecret === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = originalAdminSecret;
});

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
    const response = await createAdminCredentialsGetHandler(reader)(
      new Request("http://127.0.0.1:3020/api/client/v1/admin/credentials", {
        headers: { [TOKEN_HEADER]: adminSecret },
      }),
    );
    const payload = await response.json() as {
      apiVersion: string;
      data: { credentials: Array<Record<string, unknown>> };
    };
    assert.equal(response.status, 200);
    // The shared Client v1 envelope, the same one this route's auth failures
    // already answered in — one endpoint, one parser.
    assert.equal(typeof payload.apiVersion, "string");
    assert.equal(payload.data.credentials.length, 2);
    assert.deepEqual(
      payload.data.credentials.map((credential) => credential.id),
      [active.credential.id, revoked.credential.id],
    );
    assert.equal(payload.data.credentials[1].revocationReason, "operator revoked");
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes(active.bearer), false);
    assert.equal(serialized.includes(revoked.bearer), false);
    assert.equal(/bearerHash|secretHash/u.test(serialized), false);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("a store whose ownership cannot be verified answers ownership_refused, not a bare 500 (cave-e7xwk)", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const now = () => 0;
    const credentialStore = createCredentialStore({
      root,
      now,
      ownership: {
        platform: "win32",
        getuid: null,
        env: {},
        warn: () => {},
        probeWindowsAcl: async () => {
          throw new Error("spawn powershell.exe ENOENT");
        },
      },
    });
    const runtime: ClientV1Runtime = {
      authority: createClientV1AuthorityRuntimeFromGlobal({ now }),
      authenticator: createClientV1Authenticator({ credentialStore, loopbackSecret: "loopback-secret" }),
      credentialStore,
      now,
      pairingStore: createPairingStore({ now }),
      rateLimiter: createClientV1RateLimiter({ now }),
    };
    const response = await createAdminCredentialsGetHandler(runtime)(
      new Request("http://127.0.0.1:3020/api/client/v1/admin/credentials", {
        headers: { [TOKEN_HEADER]: adminSecret },
      }),
    );
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "ownership_refused");
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
