// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-github-actions-route-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "github-actions-route-secret";

const { POST } = await import("./route.ts");
const actionServiceModule = await import("@/lib/server/client-v1/action-service.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");

const original = actionServiceModule.clientActionService.executeGitHubAction;

after(async () => {
  actionServiceModule.clientActionService.executeGitHubAction = original;
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRateLimitsForTest();
  actionServiceModule.clientActionService.executeGitHubAction = original;
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
});

async function token(scopes = ["github:write"]) {
  return (await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes,
  })).token;
}

function request(opts = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", "Bearer " + opts.bearer);
  if (opts.idempotencyKey !== null) headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  return new Request("http://127.0.0.1/api/client/v1/github/actions", {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {
      conversationId: "conv-1",
      turnId: "assistant-1",
      confirmed: true,
      action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
    }),
  });
}

test("GitHub actions require the loopback marker, github:write, confirmed: true, and a UUID Idempotency-Key", async () => {
  let calls = 0;
  actionServiceModule.clientActionService.executeGitHubAction = async () => {
    calls += 1;
    return {
      ok: true,
      receipt: {
        source: { conversationId: "conv-1", turnId: "assistant-1" },
        action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" },
        result: { kind: "comment", commentId: "91", body: "Ship it", createdAt: null, url: null },
      },
    };
  };

  assert.equal((await POST(request({ marker: null, bearer: null, idempotencyKey: null }))).status, 403);
  const wrongScope = await POST(request({ bearer: await token(["tasks:write"]) }));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json()).error.code, "scope_denied");

  const missingConfirmed = await POST(request({
    bearer: await token(),
    body: { conversationId: "conv-1", turnId: "assistant-1", action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it" } },
  }));
  assert.equal(missingConfirmed.status, 400);
  assert.equal((await missingConfirmed.json()).error.code, "invalid_request");

  const missingKey = await POST(request({ bearer: await token(), idempotencyKey: null }));
  assert.equal(missingKey.status, 400);
  assert.equal(calls, 0);
});

test("GitHub action variants reject unexpected fields before idempotency replay can alias them", async () => {
  let calls = 0;
  actionServiceModule.clientActionService.executeGitHubAction = async (input) => {
    calls += 1;
    return {
      ok: true,
      receipt: {
        source: { conversationId: input.conversationId, turnId: input.turnId },
        action: input.action,
        result: { kind: "comment", commentId: "91", body: input.action.body ?? "ok", createdAt: null, url: null },
      },
    };
  };

  const bearer = await token();
  const variants = [
    { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it", note: "extra" },
    { kind: "review", repo: "OpenCoven/coven-cave", number: 7, event: "APPROVE", body: "Ship it", note: "extra" },
    { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "merge", deleteBranch: true },
    { kind: "rerun", repo: "OpenCoven/coven-cave", runId: "12345", failedOnly: false },
    { kind: "dispatch", repo: "OpenCoven/coven-cave", workflow: "ci.yml", ref: "main", inputs: { env: "prod" } },
  ];
  for (const action of variants) {
    const response = await POST(request({
      bearer,
      body: {
        conversationId: "conv-1",
        turnId: "assistant-1",
        confirmed: true,
        action,
      },
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
  assert.equal(calls, 0, "unexpected fields must fail before the canonical action executor runs");

  const key = "8f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(request({ bearer, idempotencyKey: key }));
  assert.equal(first.status, 200);
  const aliased = await POST(request({
    bearer,
    idempotencyKey: key,
    body: {
      conversationId: "conv-1",
      turnId: "assistant-1",
      confirmed: true,
      action: { kind: "comment", repo: "OpenCoven/coven-cave", number: 7, body: "Ship it", note: "extra" },
    },
  }));
  assert.equal(aliased.status, 400);
  assert.equal((await aliased.json()).error.code, "invalid_request");
  assert.equal(calls, 1, "the extra-field variant must 400 instead of replaying the first canonical action");
});

test("GitHub actions persist exact replays and conflict on a same-key different action", async () => {
  let calls = 0;
  actionServiceModule.clientActionService.executeGitHubAction = async (input) => {
    calls += 1;
    return {
      ok: true,
      receipt: {
        source: { conversationId: input.conversationId, turnId: input.turnId },
        action: input.action,
        result: { kind: "comment", commentId: "91", body: input.action.body, createdAt: null, url: null },
      },
    };
  };

  const bearer = await token();
  const key = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(request({ bearer, idempotencyKey: key }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const replay = await POST(request({ bearer, idempotencyKey: key }));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(calls, 1);

  const conflict = await POST(request({
    bearer,
    idempotencyKey: key,
    body: {
      conversationId: "conv-1",
      turnId: "assistant-1",
      confirmed: true,
      action: { kind: "merge", repo: "OpenCoven/coven-cave", number: 7, method: "squash" },
    },
  }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
  assert.equal(calls, 1);
});

test("GitHub effect capacity errors stay typed through the route wiring", async () => {
  actionServiceModule.clientActionService.executeGitHubAction = async () => ({
    ok: false,
    status: 503,
    code: "service_unavailable",
    message: "ignored by clientV1Error for 5xx",
    retryable: true,
    details: { reason: "github_effect_capacity_exceeded" },
  });

  const response = await POST(request({
    bearer: await token(),
    idempotencyKey: "af4145de-9b43-4abc-876d-81ef63de60e0",
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "service_unavailable");
  assert.equal(body.error.details.reason, "github_effect_capacity_exceeded");
});
