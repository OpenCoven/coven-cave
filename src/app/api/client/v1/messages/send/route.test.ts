// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-send-"));
process.env.COVEN_HOME = path.join(root, "home");
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(root, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-send-secret";
await mkdir(process.env.COVEN_HOME, { recursive: true });
const { POST } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
after(() => rm(root, { recursive: true, force: true }));

async function token(scopes = ["chat:write"]) {
  return (await issueCredential({
    appName: "Chat",
    installationId: crypto.randomUUID(),
    scopes,
  })).token;
}
function request(body: unknown, bearer?: string, marker = true) {
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": "9f4145de-9b43-4abc-876d-81ef63de60e0",
  });
  if (marker) headers.set(CLIENT_V1_LOCAL_HEADER, process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return new Request("http://localhost/api/client/v1/messages/send", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

test("send requires local marker, bearer, and chat:write", async () => {
  assert.equal((await POST(request({}, undefined, false))).status, 403);
  assert.equal((await POST(request({}, await token(["chat:read"])))).status, 403);
});

test("send rejects extra fields before canonical state or launch", async () => {
  const response = await POST(request({
    operationId: "9f4145de-9b43-4abc-876d-81ef63de60e0",
    conversationId: "conversation",
    familiarId: "opal",
    prompt: "hello",
    attachmentIds: [],
    projectRoot: null,
    extra: true,
  }, await token()));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});
