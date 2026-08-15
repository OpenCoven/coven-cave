// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-attention-route-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "attention-route-secret";

const { POST } = await import("./route.ts");
const actionServiceModule = await import("@/lib/server/client-v1/action-service.ts");
const runServiceModule = await import("@/lib/server/client-v1/run-service.ts");
const { deriveIdempotentEffectId } = await import("@/lib/server/client-v1/idempotent-mutation.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const {
  claimOperation,
  completeOperation,
  hashNormalizedRequest,
} = await import("@/lib/server/client-v1/idempotency-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");

const originalPrepare = actionServiceModule.clientActionService.prepareAttentionResponse;
const originalSend = runServiceModule.clientRunService.send;
const originalFindReplayableResponse = runServiceModule.clientRunService.findReplayableResponse;

after(async () => {
  actionServiceModule.clientActionService.prepareAttentionResponse = originalPrepare;
  runServiceModule.clientRunService.send = originalSend;
  runServiceModule.clientRunService.findReplayableResponse = originalFindReplayableResponse;
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRateLimitsForTest();
  actionServiceModule.clientActionService.prepareAttentionResponse = originalPrepare;
  runServiceModule.clientRunService.send = originalSend;
  runServiceModule.clientRunService.findReplayableResponse = originalFindReplayableResponse;
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
});

async function issuedCredential(scopes = ["chat:write", "tasks:write"]) {
  return issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes,
  });
}

async function token(scopes = ["chat:write", "tasks:write"]) {
  return (await issuedCredential(scopes)).token;
}

function request(id, opts = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", "Bearer " + opts.bearer);
  if (opts.idempotencyKey !== null) headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  return {
    req: new Request(`http://127.0.0.1/api/client/v1/attention/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      headers,
      body: opts.rawBody ?? JSON.stringify(opts.body ?? { conversationId: "conv-1", prompt: "Approved" }),
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function alreadyStartedBody(runId, conversationId) {
  return {
    ok: false,
    error: {
      code: "operation_already_started",
      message: "This operation has already started. Attach to its run stream.",
      retryable: false,
      details: {
        runId,
        conversationId,
        resumePath: `/api/client/v1/runs/${runId}/stream`,
      },
    },
  };
}

async function persistCompletedSend(input, credentialId) {
  const claim = await claimOperation({
    key: input.operationId,
    credentialId,
    route: "messages-send",
    requestHash: hashNormalizedRequest(input),
  });
  assert.equal(claim.kind, "claimed");
  await completeOperation(
    { key: input.operationId, claimId: claim.claimId },
    { status: 409, body: alreadyStartedBody(input.operationId, input.conversationId) },
  );
}

async function launchDurableSend(input, credentialId) {
  const claim = await claimOperation({
    key: input.operationId,
    credentialId,
    route: "messages-send",
    requestHash: hashNormalizedRequest(input),
  });
  if (claim.kind === "replay") {
    return Response.json(claim.response.body, { status: claim.response.status });
  }
  assert.equal(claim.kind, "claimed");
  await completeOperation(
    { key: input.operationId, claimId: claim.claimId },
    { status: 409, body: alreadyStartedBody(input.operationId, input.conversationId) },
  );
  return Response.json({ ok: true, runId: input.operationId, conversationId: input.conversationId }, { status: 202 });
}

test("attention respond requires the loopback marker, chat:write + tasks:write, a safe id, and a UUID Idempotency-Key", async () => {
  let called = 0;
  actionServiceModule.clientActionService.prepareAttentionResponse = async () => {
    called += 1;
    return { ok: true, send: { operationId: crypto.randomUUID(), conversationId: "conv-1", familiarId: "charm", prompt: "Approved", attachmentIds: [], projectRoot: null } };
  };

  const missingMarker = request("assistant-1", { marker: null, bearer: null, idempotencyKey: null });
  assert.equal((await POST(missingMarker.req, missingMarker.ctx)).status, 403);

  const missingTasksScope = request("assistant-1", { bearer: await token(["chat:write"]) });
  const missingTasksScopeRes = await POST(missingTasksScope.req, missingTasksScope.ctx);
  assert.equal(missingTasksScopeRes.status, 403);
  assert.equal((await missingTasksScopeRes.json()).error.code, "scope_denied");

  const missingChatScope = request("assistant-1", { bearer: await token(["tasks:write"]) });
  const missingChatScopeRes = await POST(missingChatScope.req, missingChatScope.ctx);
  assert.equal(missingChatScopeRes.status, 403);
  assert.equal((await missingChatScopeRes.json()).error.code, "scope_denied");

  const badId = request("../../etc/passwd", { bearer: await token() });
  const badIdRes = await POST(badId.req, badId.ctx);
  assert.equal(badIdRes.status, 404);

  const missingKey = request("assistant-1", { bearer: await token(), idempotencyKey: null });
  const missingKeyRes = await POST(missingKey.req, missingKey.ctx);
  assert.equal(missingKeyRes.status, 400);
  assert.equal(called, 0, "route validation fails before the service runs");
});

test("attention respond forwards the parsed request into the canonical send path with a distinct deterministic send operation id", async () => {
  let preparedArgs = null;
  let sendArgs = null;
  const idempotencyKey = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const issued = await issuedCredential();
  const expectedSendOperationId = deriveIdempotentEffectId({
    credentialId: issued.credential.id,
    route: "attention-respond",
    idempotencyKey,
    requestHash: hashNormalizedRequest({
      method: "POST",
      attentionRequestId: "assistant-1",
      conversationId: "conv-1",
      prompt: "Approved",
    }),
  });
  actionServiceModule.clientActionService.prepareAttentionResponse = async (...args) => {
    preparedArgs = args;
    return {
      ok: true,
      send: {
        operationId: args[2],
        conversationId: "conv-1",
        familiarId: "charm",
        prompt: "Approved",
        attachmentIds: [],
        projectRoot: null,
      },
    };
  };
  runServiceModule.clientRunService.send = async (...args) => {
    sendArgs = args;
    return Response.json({ ok: true, runId: args[0].operationId, conversationId: "conv-1" }, { status: 202 });
  };

  const { req, ctx } = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const response = await POST(req, ctx);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, runId: expectedSendOperationId, conversationId: "conv-1" });
  assert.deepEqual(preparedArgs.slice(0, 3), [
    "assistant-1",
    { conversationId: "conv-1", prompt: "Approved" },
    expectedSendOperationId,
  ]);
  assert.equal(sendArgs[0].operationId, expectedSendOperationId);
  assert.notEqual(sendArgs[0].operationId, idempotencyKey, "the nested messages-send id must not reuse the raw attention key");
  assert.equal(sendArgs[1].credentialId, issued.credential.id);
  assert.equal(sendArgs[2], req);
});

test("attention respond maps typed service errors onto the stable client-v1 envelope", async () => {
  actionServiceModule.clientActionService.prepareAttentionResponse = async () => ({
    ok: false,
    status: 409,
    code: "conflict",
    message: "This attention request is stale or no longer active.",
    retryable: false,
  });

  const { req, ctx } = request("assistant-1", { bearer: await token() });
  const response = await POST(req, ctx);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "conflict",
      message: "This attention request is stale or no longer active.",
      retryable: false,
    },
  });
});

test("attention respond releases a still-launching retryable conflict so the same key can later succeed", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "4f4145de-9b43-4abc-876d-81ef63de60e0";
  let sendCalls = 0;
  actionServiceModule.clientActionService.prepareAttentionResponse = async (_requestId, input, sendOperationId) => ({
    ok: true,
    send: {
      operationId: sendOperationId,
      conversationId: input.conversationId,
      familiarId: "charm",
      prompt: input.prompt,
      attachmentIds: [],
      projectRoot: null,
    },
  });
  runServiceModule.clientRunService.findReplayableResponse = async () => null;
  runServiceModule.clientRunService.send = async (input) => {
    sendCalls += 1;
    if (sendCalls === 1) {
      return Response.json({
        ok: false,
        error: {
          code: "operation_already_started",
          message: "This run is still launching. Retry shortly.",
          retryable: true,
        },
      }, { status: 409 });
    }
    return Response.json({ ok: true, runId: input.operationId, conversationId: input.conversationId }, { status: 202 });
  };

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstResponse = await POST(first.req, first.ctx);
  assert.equal(firstResponse.status, 409);
  assert.equal((await firstResponse.json()).error.retryable, true);

  const differentPrompt = request("assistant-1", {
    bearer: issued.token,
    idempotencyKey,
    body: { conversationId: "conv-1", prompt: "Use a different approval" },
  });
  const differentPromptResponse = await POST(differentPrompt.req, differentPrompt.ctx);
  assert.equal(differentPromptResponse.status, 409);
  assert.deepEqual(await differentPromptResponse.json(), {
    ok: false,
    error: {
      code: "conflict",
      message: "This Idempotency-Key was already used for a different request.",
      retryable: false,
    },
  });
  assert.equal(sendCalls, 1, "a different prompt must not reclaim a retryable attention key");

  const retry = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const retryResponse = await POST(retry.req, retry.ctx);
  assert.equal(retryResponse.status, 202, "the released key may immediately retry the nested launch");
  const retryBody = await retryResponse.json();
  assert.equal(retryBody.ok, true);
  assert.equal(sendCalls, 2);

  const replay = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const replayResponse = await POST(replay.req, replay.ctx);
  assert.equal(replayResponse.status, 202);
  assert.deepEqual(await replayResponse.json(), retryBody);
  assert.equal(sendCalls, 2, "the successful retry is now an exact persisted replay");
});

test("attention respond persists a terminal conflict for exact replay", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "5f4145de-9b43-4abc-876d-81ef63de60e0";
  let prepareCalls = 0;
  actionServiceModule.clientActionService.prepareAttentionResponse = async () => {
    prepareCalls += 1;
    return {
      ok: false,
      status: 409,
      code: "conflict",
      message: "This attention request is stale or no longer active.",
      retryable: false,
    };
  };

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstResponse = await POST(first.req, first.ctx);
  assert.equal(firstResponse.status, 409);
  const firstBody = await firstResponse.json();

  const replay = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const replayResponse = await POST(replay.req, replay.ctx);
  assert.equal(replayResponse.status, 409);
  assert.deepEqual(await replayResponse.json(), firstBody);
  assert.equal(prepareCalls, 1, "terminal conflicts are completed exactly once and replayed");
});

test("attention respond keeps a concurrent outer claim from launching a duplicate nested send", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "6f4145de-9b43-4abc-876d-81ef63de60e0";
  let prepareCalls = 0;
  let sendCalls = 0;
  let markSendStarted;
  const sendStarted = new Promise((resolve) => {
    markSendStarted = resolve;
  });
  let finishSend;
  const sendFinished = new Promise((resolve) => {
    finishSend = resolve;
  });
  actionServiceModule.clientActionService.prepareAttentionResponse = async (_requestId, input, sendOperationId) => {
    prepareCalls += 1;
    return {
      ok: true,
      send: {
        operationId: sendOperationId,
        conversationId: input.conversationId,
        familiarId: "charm",
        prompt: input.prompt,
        attachmentIds: [],
        projectRoot: null,
      },
    };
  };
  runServiceModule.clientRunService.findReplayableResponse = async () => null;
  runServiceModule.clientRunService.send = async (input) => {
    sendCalls += 1;
    markSendStarted();
    await sendFinished;
    return Response.json({ ok: true, runId: input.operationId, conversationId: input.conversationId }, { status: 202 });
  };

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstPromise = POST(first.req, first.ctx);
  await sendStarted;

  const concurrent = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const concurrentResponse = await POST(concurrent.req, concurrent.ctx);
  assert.equal(concurrentResponse.status, 409);
  assert.equal((await concurrentResponse.json()).error.retryable, true);
  assert.equal(prepareCalls, 1);
  assert.equal(sendCalls, 1);

  finishSend();
  const firstResponse = await firstPromise;
  assert.equal(firstResponse.status, 202);

  const replay = request("assistant-1", { bearer: issued.token, idempotencyKey });
  assert.equal((await POST(replay.req, replay.ctx)).status, 202);
  assert.equal(sendCalls, 1);
});

test("attention respond exact retries replay the completed send ledger even after attention clears", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "1f4145de-9b43-4abc-876d-81ef63de60e0";
  let prepareCalls = 0;
  actionServiceModule.clientActionService.prepareAttentionResponse = async (requestId, input, sendOperationId) => {
    prepareCalls += 1;
    if (prepareCalls > 1) {
      return {
        ok: false,
        status: 409,
        code: "conflict",
        message: "This attention request is stale or no longer active.",
        retryable: false,
      };
    }
    return {
      ok: true,
      send: {
        operationId: sendOperationId,
        conversationId: input.conversationId,
        familiarId: "charm",
        prompt: input.prompt,
        attachmentIds: [],
        projectRoot: null,
      },
    };
  };
  runServiceModule.clientRunService.send = async (input, principal) => launchDurableSend(input, principal.credentialId);

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstResponse = await POST(first.req, first.ctx);
  assert.equal(firstResponse.status, 202);
  const firstBody = await firstResponse.json();
  assert.equal(typeof firstBody.runId, "string");

  const replay = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const replayResponse = await POST(replay.req, replay.ctx);
  assert.equal(replayResponse.status, 409);
  assert.deepEqual(await replayResponse.json(), alreadyStartedBody(firstBody.runId, "conv-1"));
  assert.equal(prepareCalls, 1, "the cleared attention request must replay from the ledger, not re-run stale validation");
});

test("attention respond recovers a crashed nested launch without releasing request-hash ownership", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "3f4145de-9b43-4abc-876d-81ef63de60e0";
  let prepareCalls = 0;
  let sendCalls = 0;
  actionServiceModule.clientActionService.prepareAttentionResponse = async (requestId, input, sendOperationId) => {
    prepareCalls += 1;
    return {
      ok: true,
      send: {
        operationId: sendOperationId,
        conversationId: input.conversationId,
        familiarId: "charm",
        prompt: input.prompt,
        attachmentIds: [],
        projectRoot: null,
      },
    };
  };
  runServiceModule.clientRunService.findReplayableResponse = async () => null;
  runServiceModule.clientRunService.send = async (prepared) => {
    sendCalls += 1;
    if (sendCalls === 1) throw new Error("crash before executeChatSend");
    return Response.json({ ok: true, runId: prepared.operationId, conversationId: prepared.conversationId }, { status: 202 });
  };

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstResponse = await POST(first.req, first.ctx);
  assert.equal(firstResponse.status, 500);

  const differentPrompt = request("assistant-1", {
    bearer: issued.token,
    idempotencyKey,
    body: { conversationId: "conv-1", prompt: "Different recovery payload" },
  });
  const differentPromptResponse = await POST(differentPrompt.req, differentPrompt.ctx);
  assert.equal(differentPromptResponse.status, 409);
  assert.equal((await differentPromptResponse.json()).error.retryable, false);
  assert.equal(sendCalls, 1, "a crashed launch must not free the key for another payload");

  const retry = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const retryResponse = await POST(retry.req, retry.ctx);
  assert.equal(retryResponse.status, 202);
  const retryBody = await retryResponse.json();
  assert.equal(typeof retryBody.runId, "string");
  assert.equal(retryBody.conversationId, "conv-1");
  assert.equal(prepareCalls, 2, "a same-key retry should rebuild the reserved send when no replayable launch exists");
  assert.equal(sendCalls, 2, "the recovery retry must re-enter the send service exactly once");
});

test("attention respond isolates other attention requests and normal sends from its idempotency identity", async () => {
  const issued = await issuedCredential();
  const idempotencyKey = "2f4145de-9b43-4abc-876d-81ef63de60e0";
  await persistCompletedSend({
    operationId: idempotencyKey,
    conversationId: "conv-1",
    familiarId: "charm",
    prompt: "Approved",
    attachmentIds: [],
    projectRoot: null,
  }, issued.credential.id);

  let prepareCalls = 0;
  let sendCalls = 0;
  let nestedOperationId = null;
  actionServiceModule.clientActionService.prepareAttentionResponse = async (_requestId, input, sendOperationId) => {
    prepareCalls += 1;
    return {
      ok: true,
      send: {
        operationId: sendOperationId,
        conversationId: input.conversationId,
        familiarId: "charm",
        prompt: input.prompt,
        attachmentIds: [],
        projectRoot: null,
      },
    };
  };
  runServiceModule.clientRunService.send = async (input, principal) => {
    sendCalls += 1;
    nestedOperationId = input.operationId;
    return launchDurableSend(input, principal.credentialId);
  };

  const first = request("assistant-1", { bearer: issued.token, idempotencyKey });
  const firstResponse = await POST(first.req, first.ctx);
  assert.equal(firstResponse.status, 202);
  assert.notEqual(
    nestedOperationId,
    idempotencyKey,
    "attention responses must not reuse the raw Idempotency-Key for nested messages-send launches",
  );

  const second = request("assistant-2", { bearer: issued.token, idempotencyKey });
  const secondResponse = await POST(second.req, second.ctx);
  assert.equal(secondResponse.status, 409);
  assert.deepEqual(await secondResponse.json(), {
    ok: false,
    error: {
      code: "conflict",
      message: "This Idempotency-Key was already used for a different request.",
      retryable: false,
    },
  });
  assert.equal(prepareCalls, 1, "a different attention request with the same key must never alias the original replay");
  assert.equal(sendCalls, 1, "cross-request conflicts must stop before a second nested send launches");
});
