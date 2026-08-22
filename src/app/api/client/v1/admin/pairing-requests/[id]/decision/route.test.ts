import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";

import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { TOKEN_HEADER } from "@/proxy-helpers.ts";

import { createAdminPairingDecisionPostHandler } from "./route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-decision-");
const origin = "http://127.0.0.1:3020";
const adminSecret = "sidecar-admin-secret";
const originalAdminSecret = process.env.COVEN_CAVE_AUTH_TOKEN;
process.env.COVEN_CAVE_AUTH_TOKEN = adminSecret;

after(() => {
  if (originalAdminSecret === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = originalAdminSecret;
});

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(body: string): Request {
  return new Request(`${origin}/api/client/v1/admin/pairing-requests/id/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TOKEN_HEADER]: adminSecret,
      origin,
      referer: `${origin}/settings`,
    },
    body,
  });
}

test("approves or denies only explicit pending pairing decisions", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    let now = 2_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => now,
    });
    const handler = createAdminPairingDecisionPostHandler(runtime);

    for (const decision of ["approved", "denied"] as const) {
      const issued = runtime.pairingStore.create({
        appName: "OpenCoven Chat",
        installationId: `chat-install-${decision}`,
        scopes: ["chat:read"],
      });
      now += 10;
      const response = await handler(
        request(JSON.stringify({ decision })),
        context(issued.id),
      );
      const payload = await response.json() as {
        apiVersion: string;
        data: { pairingRequest: { status: string; decidedAt: number } };
      };
      assert.equal(response.status, 200);
      // The shared Client v1 envelope, the same one this route's auth failures
      // already answered in — one endpoint, one parser.
      assert.equal(typeof payload.apiVersion, "string");
      assert.equal(payload.data.pairingRequest.status, decision);
      assert.equal(payload.data.pairingRequest.decidedAt, now);
      assert.equal(JSON.stringify(payload).includes(issued.secret), false);
    }
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed, implicit, and missing decisions", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret: "loopback-secret",
      now: () => 3_000,
    });
    const handler = createAdminPairingDecisionPostHandler(runtime);
    const issued = runtime.pairingStore.create({
      appName: "OpenCoven Chat",
      installationId: "chat-install-1",
      scopes: ["chat:read"],
    });

    for (const body of [
      "{",
      JSON.stringify({}),
      JSON.stringify({ decision: true }),
      JSON.stringify({ decision: "approve" }),
      JSON.stringify({ decision: "approved", extra: true }),
    ]) {
      const response = await handler(request(body), context(issued.id));
      assert.equal(response.status, 400);
      const payload = await response.json() as { error: { code: string } };
      assert.equal(payload.error.code, "invalid_request");
    }

    const missing = await handler(
      request(JSON.stringify({ decision: "approved" })),
      context("00000000-0000-4000-8000-000000000000"),
    );
    assert.equal(missing.status, 404);
    assert.equal(
      ((await missing.json()) as { error: { code: string } }).error.code,
      "not_found",
    );

    // A pairing that has already been decided is a conflict, in the same
    // envelope rather than a bare { ok: false } beside it.
    assert.equal(runtime.pairingStore.decide(issued.id, "approved", 3_000), true);
    const alreadyDecided = await handler(
      request(JSON.stringify({ decision: "denied" })),
      context(issued.id),
    );
    assert.equal(alreadyDecided.status, 409);
    const conflict = await alreadyDecided.json() as {
      error: { code: string; details?: { reason?: string } };
    };
    assert.equal(conflict.error.code, "conflict");
    assert.equal(conflict.error.details?.reason, "pairing_already_decided");
  } finally {
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
