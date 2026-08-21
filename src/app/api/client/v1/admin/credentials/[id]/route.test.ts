import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { ACCESS_TOKEN_COOKIE, LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";
import { proxy } from "@/proxy.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";

import { createAdminCredentialDeleteHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-revoke-");
const origin = "http://localhost:3000";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(body: string): Request {
  return new Request("http://127.0.0.1:3020/api/client/v1/admin/credentials/id", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body,
  });
}

test("revokes a credential by id and reason with persisted metadata", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 6_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
    });
    now = 7_000;
    const response = await createAdminCredentialDeleteHandler(runtime)(
      request(JSON.stringify({ reason: "operator revoked" })),
      context(issued.credential.id),
    );
    const payload = await response.json() as {
      ok: boolean;
      credential: Record<string, unknown>;
    };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.credential.revokedAt, 7_000);
    assert.equal(payload.credential.revocationReason, "operator revoked");
    assert.equal(JSON.stringify(payload).includes(issued.bearer), false);
    assert.equal("bearerHash" in payload.credential, false);

    const reloaded = await createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    }).credentialStore.reload();
    assert.equal(reloaded.get(issued.credential.id)?.revokedAt, 7_000);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing reasons, malformed JSON, and unknown credential ids", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 8_000,
    });
    const handler = createAdminCredentialDeleteHandler(runtime);
    const issued = await runtime.credentialStore.issue({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
    });
    for (const body of [
      "{",
      JSON.stringify({}),
      JSON.stringify({ reason: "" }),
      JSON.stringify({ reason: true }),
      JSON.stringify({ reason: "revoked", extra: true }),
    ]) {
      const response = await handler(request(body), context(issued.credential.id));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "invalid revocation reason",
      });
    }
    const missing = await handler(
      request(JSON.stringify({ reason: "operator revoked" })),
      context("00000000-0000-4000-8000-000000000000"),
    );
    assert.equal(missing.status, 404);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("admin credential mutation remains behind existing authentication and CSRF gates", async () => {
  const original = {
    access: process.env.COVEN_CAVE_ACCESS_TOKEN,
    auth: process.env.COVEN_CAVE_AUTH_TOKEN,
    local: process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
  };
  try {
    process.env.COVEN_CAVE_ACCESS_TOKEN = "mobile-secret";
    process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-secret";
    process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "loopback-secret";

    const makeRequest = (headers: Record<string, string>) => new NextRequest(
      `${origin}/api/client/v1/admin/credentials/credential-1`,
      {
        method: "DELETE",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ reason: "operator revoked" }),
      },
    );

    const unauthenticated = await proxy(makeRequest({
      [LOCAL_PEER_HEADER]: "loopback-secret",
      origin,
      referer: `${origin}/settings`,
    }));
    assert.equal(unauthenticated.status, 401);

    const crossOrigin = await proxy(makeRequest({
      [LOCAL_PEER_HEADER]: "loopback-secret",
      cookie: `${ACCESS_TOKEN_COOKIE}=mobile-secret`,
      origin: "https://attacker.example",
      referer: "https://attacker.example/",
    }));
    assert.equal(crossOrigin.status, 403);

    const authenticated = await proxy(makeRequest({
      [LOCAL_PEER_HEADER]: "loopback-secret",
      cookie: `${ACCESS_TOKEN_COOKIE}=mobile-secret`,
      origin,
      referer: `${origin}/settings`,
    }));
    assert.equal(authenticated.headers.get("x-middleware-next"), "1");
  } finally {
    if (original.access === undefined) delete process.env.COVEN_CAVE_ACCESS_TOKEN;
    else process.env.COVEN_CAVE_ACCESS_TOKEN = original.access;
    if (original.auth === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
    else process.env.COVEN_CAVE_AUTH_TOKEN = original.auth;
    if (original.local === undefined) delete process.env.COVEN_CAVE_LOCAL_PEER_SECRET;
    else process.env.COVEN_CAVE_LOCAL_PEER_SECRET = original.local;
  }
});
