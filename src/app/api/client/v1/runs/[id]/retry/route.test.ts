// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-retry-"));
process.env.COVEN_HOME = path.join(root, "home");
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(root, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-retry-secret";
await mkdir(process.env.COVEN_HOME, { recursive: true });
const { POST } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
after(() => rm(root, { recursive: true, force: true }));

test("retry body is exact and requires a new operation UUID", async () => {
  const issued = await issueCredential({
    appName: "Chat", installationId: crypto.randomUUID(), scopes: ["chat:write"],
  });
  const operationId = crypto.randomUUID();
  const response = await POST(new Request("http://localhost/retry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": operationId,
      [CLIENT_V1_LOCAL_HEADER]: process.env.COVEN_CAVE_LOCAL_PEER_SECRET!,
      authorization: `Bearer ${issued.token}`,
    },
    body: JSON.stringify({ operationId, retryOfTurnId: "turn", extra: true }),
  }), { params: Promise.resolve({ id: crypto.randomUUID() }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});
