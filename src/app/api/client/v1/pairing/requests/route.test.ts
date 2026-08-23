import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { CLIENT_V1_PAIRING_CREATE_LIMIT } from "@/lib/server/client-v1/rate-limit.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

import { createPairingRequestPostHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-create-");
const endpoint = "http://127.0.0.1:3020/api/client/v1/pairing/requests";
const pairingBody = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-1",
  scopes: [
    "chat:read",
    "chat:write",
    "conversations:write",
    "attachments:write",
    "tasks:write",
    "github:write",
  ],
};

function request(body: unknown, loopbackSecret = "loopback-secret"): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [LOCAL_PEER_HEADER]: loopbackSecret,
    },
    body: JSON.stringify(body),
  });
}

async function withHandler(
  run: (
    handler: ReturnType<typeof createPairingRequestPostHandler>,
    runtime: ReturnType<typeof createClientV1Runtime>,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 1_000,
    });
    await run(createPairingRequestPostHandler(runtime), runtime);
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
}

test("creates a five-minute pairing and returns its raw secret exactly once", async () => {
  await withHandler(async (handler, runtime) => {
    const response = await handler(request(pairingBody));
    const body = await response.json() as {
      data: { requestId: string; secret: string; expiresAt: number };
    };

    assert.equal(response.status, 201);
    assert.match(body.data.requestId, /^[0-9a-f-]{36}$/i);
    assert.match(body.data.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.data.expiresAt, 301_000);
    const inspected = runtime.pairingStore.inspect(body.data.requestId);
    assert.ok(inspected);
    assert.notEqual(inspected.secretHash, body.data.secret);
    assert.equal(JSON.stringify(inspected).includes(body.data.secret), false);
  });
});

test("rejects malformed app identity and unsupported scopes with stable errors", async () => {
  await withHandler(async (handler) => {
    for (const body of [
      { ...pairingBody, appName: "" },
      { ...pairingBody, appName: "bad\u0000name" },
      { ...pairingBody, installationId: "../chat-install" },
      { ...pairingBody, scopes: ["chat:read", "unknown:scope"] },
      { ...pairingBody, scopes: [] },
      { ...pairingBody, extra: "not-reviewed" },
    ]) {
      const response = await handler(request(body));
      const payload = await response.json() as {
        error: { code: string; message: string };
      };
      assert.equal(response.status, 400);
      assert.equal(payload.error.code, "invalid_request");
      assert.equal(payload.error.message, "Invalid pairing request.");
      assert.equal(JSON.stringify(payload).includes("loopback-secret"), false);
    }
  });
});

test("requires the trusted listener stamp and rate limits pairing creation", async () => {
  await withHandler(async (handler) => {
    const untrusted = await handler(request(pairingBody, "caller-supplied"));
    assert.equal(untrusted.status, 401);
    assert.equal(
      ((await untrusted.json()) as { error: { code: string } }).error.code,
      "unauthorized",
    );

    for (let attempt = 0; attempt < CLIENT_V1_PAIRING_CREATE_LIMIT; attempt += 1) {
      const response = await handler(request({
        ...pairingBody,
        installationId: `chat-install-${attempt}`,
      }));
      assert.equal(response.status, 201, `attempt ${attempt + 1}`);
    }
    const limited = await handler(request(pairingBody));
    const payload = await limited.json() as { error: { code: string } };
    assert.equal(limited.status, 429);
    assert.equal(payload.error.code, "rate_limited");
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(JSON.stringify(payload).includes("secret"), false);
  });
});
