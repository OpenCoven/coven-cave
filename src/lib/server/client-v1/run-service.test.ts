import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import type { ConversationFile } from "@/lib/cave-conversations";
import {
  getRunBufferStatus,
  openRunBuffer,
  resetRunBuffersForTest,
  subscribeRunStream,
} from "@/lib/server/chat-stream-buffer";
import type { ClientPrincipal } from "./auth.ts";
import { ClientAttachmentError } from "./attachment-service.ts";
import { hashNormalizedRequest, PENDING_CLAIM_RETRY_MS } from "./idempotency-store.ts";
import {
  readClientRunOperation,
  setClientRunOperationBeforeLaunchHookForTest,
  setClientRunOperationWriteRecordHookForTest,
  type ClientRunOperationLaunchOutcome,
  type ClientRunOperationRecord,
} from "./run-operation-store.ts";
import {
  clientRunBufferKey,
  type ClientSendInput,
  type ClientRunServiceDeps,
  createClientRunService,
  parseClientSendInput,
} from "./run-service.ts";

const operationId = "9f4145de-9b43-4abc-876d-81ef63de60e0";
const credentialId = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const internalRunId = "6e7f2ed1-5d41-4eed-8123-bf4c93f71df6";
const input = {
  operationId,
  conversationId: "conversation-safe",
  familiarId: "opal",
  prompt: "hello",
  attachmentIds: [],
  projectRoot: "/work/project",
};
const principal: ClientPrincipal = {
  credentialId,
  appName: "Chat",
  installationId: "5a2f506d-b147-4cf8-9f0f-79a86c955d32",
  scopes: ["chat:write"],
};
const conversation: ConversationFile = {
  sessionId: input.conversationId,
  familiarId: input.familiarId,
  harness: "codex",
  projectRoot: input.projectRoot,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  turns: [],
};

await mkdir(path.join(process.cwd(), ".test-tmp"), { recursive: true });
const durableRoot = await mkdtemp(path.join(process.cwd(), ".test-tmp", "client-v1-run-service-"));
process.env.COVEN_CAVE_CLIENT_RUN_OPERATION_STORE_ROOT = path.join(durableRoot, "run-ops");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(durableRoot, "operations.json");

after(async () => {
  setClientRunOperationBeforeLaunchHookForTest(null);
  setClientRunOperationWriteRecordHookForTest(null);
  resetRunBuffersForTest();
  await rm(durableRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  setClientRunOperationBeforeLaunchHookForTest(null);
  setClientRunOperationWriteRecordHookForTest(null);
  resetRunBuffersForTest();
  await mkdir(path.join(process.cwd(), ".test-tmp"), { recursive: true });
  await rm(process.env.COVEN_CAVE_CLIENT_RUN_OPERATION_STORE_ROOT!, { recursive: true, force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
});

function createRunOperationDeps() {
  const records = new Map<string, ClientRunOperationRecord>();
  const keyFor = (operationId: string, credentialId: string) =>
    `${credentialId.toLowerCase()}:${operationId.toLowerCase()}`;
  return {
    reserveRunOperation: async ({
      operationId,
      credentialId,
      requestHash,
      conversationId,
      internalRunId,
    }: {
      operationId: string;
      credentialId: string;
      requestHash: string;
      conversationId: string;
      internalRunId: string;
      now?: number;
    }) => {
      const key = keyFor(operationId, credentialId);
      const existing = records.get(key);
      if (existing && (
        existing.requestHash !== requestHash
        || existing.conversationId !== conversationId
      )) {
        return { kind: "conflict" as const };
      }
      const record: ClientRunOperationRecord = existing ?? {
        version: 1,
        operationId,
        credentialId,
        requestHash,
        conversationId,
        internalRunId,
        state: "reserved",
        createdAt: 0,
        updatedAt: 0,
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      records.set(key, record);
      return { kind: "reserved" as const, record };
    },
    readRunOperation: async ({
      operationId,
      credentialId,
      requestHash,
    }: {
      operationId: string;
      credentialId: string;
      requestHash?: string;
      now?: number;
    }) => {
      const record = records.get(keyFor(operationId, credentialId)) ?? null;
      if (!record) return null;
      if (requestHash !== undefined && record.requestHash !== requestHash) return null;
      return record;
    },
    launchRunOperation: async <T>({
      operationId,
      credentialId,
      requestHash,
      launch,
    }: {
      operationId: string;
      credentialId: string;
      requestHash: string;
      now?: number;
      launch: (record: ClientRunOperationRecord) => Promise<ClientRunOperationLaunchOutcome<T>>;
    }) => {
      const key = keyFor(operationId, credentialId);
      const record = records.get(key);
      if (!record) throw new Error("reservation not found");
      if (record.requestHash !== requestHash) return { kind: "conflict" as const };
      if (record.state === "launching") return { kind: "already_launching" as const, record };
      if (record.state === "launched") return { kind: "already_launched" as const, record };
      if (record.state === "terminal") return { kind: "already_terminal" as const, record };
      const outcome = await launch(record);
      if (outcome.kind === "retryable_prelaunch_failure") {
        record.state = "reserved";
        records.set(key, record);
        return {
          kind: "retryable_prelaunch_failure" as const,
          record,
          value: outcome.value,
        };
      }
      if (outcome.kind === "terminal_prelaunch_failure") {
        record.state = "terminal";
        record.terminalResponse = outcome.terminalResponse;
        records.set(key, record);
        return {
          kind: "terminal_prelaunch_failure" as const,
          record,
          value: outcome.value,
        };
      }
      record.state = "launched";
      records.set(key, record);
      return { kind: "launched_now" as const, record, value: outcome.value };
    },
    records,
  };
}

function createService(overrides: Partial<ClientRunServiceDeps> = {}) {
  const runOps = createRunOperationDeps();
  const runOpDeps = {
    reserveRunOperation: runOps.reserveRunOperation,
    readRunOperation: runOps.readRunOperation,
    launchRunOperation: runOps.launchRunOperation,
  };
  return {
    runOps,
    service: createClientRunService({
      ...runOpDeps,
      ...overrides,
    }),
  };
}

function createDurableService(overrides: Partial<ClientRunServiceDeps> = {}) {
  return createClientRunService(overrides);
}

async function storedRunOperation(
  operationId: string = input.operationId,
  requestedCredentialId: string = credentialId,
  requestedInput: ClientSendInput = input,
) {
  return readClientRunOperation({
    operationId,
    credentialId: requestedCredentialId,
    requestHash: hashNormalizedRequest(requestedInput),
  });
}

test("client send input is exact, typed, and bounded", () => {
  assert.deepEqual(parseClientSendInput(input), input);
  const invalid = [
    { ...input, extra: true },
    { ...input, operationId: "not-a-uuid" },
    { ...input, conversationId: "../escape" },
    { ...input, familiarId: "bad/familiar" },
    { ...input, prompt: " " },
    { ...input, prompt: "x".repeat(64 * 1024 + 1) },
    { ...input, attachmentIds: new Array(5).fill("a") },
    { ...input, attachmentIds: ["../secret"] },
    { ...input, projectRoot: 42 },
    { ...input, model: 42 },
    { ...input, harness: "unknown-harness" },
    { ...input, retryOfTurnId: "../turn" },
  ];
  for (const value of invalid) assert.throws(() => parseClientSendInput(value));
});

test("run reservation happens before launch and the durable replay receipt lands after executeChatSend", async () => {
  const calls: string[] = [];
  let mapped: Record<string, unknown> | null = null;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => {
      calls.push("authorize");
      return { ok: true, value: await effect(conversation) };
    },
    claimOperation: async () => {
      calls.push("claim");
      return { kind: "claimed", claimId: "890437e7-7b87-4af9-a6ce-28931d778f80" };
    },
    completeOperation: async (_claim, response) => {
      calls.push("complete");
      return { kind: "completed", response };
    },
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      calls.push("execute");
      mapped = await req.json();
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "session", sessionId: "private" })}\n\n`
        + `id: 2\ndata: ${JSON.stringify({ kind: "assistant_chunk", text: "ok" })}\n\n`
        + `id: 3\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      );
    },
  });

  const response = await service.send(input, principal);
  assert.deepEqual(calls, ["authorize", "claim", "execute", "complete"]);
  const sent = mapped as unknown as Record<string, unknown>;
  assert.deepEqual({ ...sent, runId: "<internal>" }, {
    familiarId: "opal",
    prompt: "hello",
    attachments: [],
    projectRoot: "/work/project",
    sessionId: "conversation-safe",
    runId: "<internal>",
  });
  assert.equal(typeof sent.runId, "string");
  assert.notEqual(sent.runId, operationId, "the global registry never receives the caller operation UUID");
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /"type":"run.started"/);
  assert.match(text, /"type":"message.delta"/);
  assert.match(text, /"type":"run.completed"/);
});

test("a retryable non-SSE launch failure reverts to reserved and the same operation id succeeds", async () => {
  let executions = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => [],
    executeChatSend: async () => {
      executions += 1;
      if (executions === 1) {
        return Response.json({ error: "temporarily unavailable" }, { status: 503 });
      }
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const first = await service.send(input, principal);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), {
    ok: false,
    error: {
      code: "service_unavailable",
      message: "Run launch is temporarily unavailable.",
      retryable: true,
    },
  });
  assert.equal((await storedRunOperation())?.state, "reserved");

  const second = await service.send(input, principal);
  assert.equal(second.status, 200);
  assert.equal((await storedRunOperation())?.state, "launched");
  assert.equal(executions, 2);
});

test("a terminal non-SSE launch failure persists and replays its original response", async () => {
  let executions = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => [],
    executeChatSend: async () => {
      executions += 1;
      return Response.json({ error: "request rejected" }, { status: 400 });
    },
  });

  const first = await service.send(input, principal);
  const firstBody = await first.json();
  assert.equal(first.status, 400);
  assert.equal((await storedRunOperation())?.state, "terminal");

  const replay = await service.send(input, principal);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(executions, 1, "a terminal response never redispatches");
});

test("concurrent duplicate launches serialize around one canonical chat send", async () => {
  let executions = 0;
  let releaseLaunch!: () => void;
  let markLaunchStarted!: () => void;
  const launchStarted = new Promise<void>((resolve) => { markLaunchStarted = resolve; });
  const launchRelease = new Promise<void>((resolve) => { releaseLaunch = resolve; });
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => [],
    executeChatSend: async () => {
      executions += 1;
      markLaunchStarted();
      await launchRelease;
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const first = service.send(input, principal);
  await launchStarted;
  const duplicate = service.send(input, principal);
  releaseLaunch();

  const [firstResponse, duplicateResponse] = await Promise.all([first, duplicate]);
  assert.equal(firstResponse.status, 200);
  assert.equal(duplicateResponse.status, 409);
  assert.equal((await duplicateResponse.json()).error.code, "operation_already_started");
  assert.equal(executions, 1);
});

test("same operation attaches with stable metadata and never executes twice", async () => {
  let executions = 0;
  const { service, runOps } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({ kind: "pending", retryAfterMs: 1000 }),
    completeOperation: async () => {
      throw new Error("must not complete a duplicate");
    },
    resolveAttachments: async () => [],
    executeChatSend: async () => {
      executions += 1;
      throw new Error("must not execute a duplicate");
    },
  });
  runOps.records.set(`${credentialId.toLowerCase()}:${operationId.toLowerCase()}`, {
    version: 1,
    operationId,
    credentialId,
    requestHash: hashNormalizedRequest(input),
    conversationId: input.conversationId,
    internalRunId,
    state: "launched",
    createdAt: 0,
    updatedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
  });
  openRunBuffer([internalRunId]);
  const response = await service.send(input, principal);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "operation_already_started");
  assert.deepEqual(body.error.details, {
    runId: operationId,
    conversationId: input.conversationId,
    resumePath: `/api/client/v1/runs/${operationId}/stream`,
  });
  assert.equal(executions, 0);
  resetRunBuffersForTest();
});

test("credential-scoped resume buffers isolate reuse of the same operation UUID", async () => {
  resetRunBuffersForTest();
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      const body = await req.json() as { runId: string; prompt: string };
      const buffer = openRunBuffer([body.runId]);
      buffer.record({ kind: "assistant_chunk", text: body.prompt });
      buffer.record({ kind: "done", isError: false });
      buffer.finish();
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });
  const secondPrincipal = {
    ...principal,
    credentialId: "5e7f2ed1-5d41-4eed-8123-bf4c93f71df5",
  };

  await service.send({ ...input, prompt: "first credential" }, principal);
  await service.send({ ...input, prompt: "second credential" }, secondPrincipal);

  const replayText = (owner: ClientPrincipal) => {
    const subscription = subscribeRunStream(
      clientRunBufferKey(operationId, owner.credentialId),
      0,
      () => {},
      () => {},
    );
    assert.ok(subscription);
    // Only the assistant_chunk is under test here (buffer isolation); the
    // trailing `done` terminal each credential's run also carries has no
    // `.text` field.
    return subscription.replay
      .map((entry) => JSON.parse(entry.json))
      .filter((event) => event.kind === "assistant_chunk")
      .map((event) => event.text);
  };
  assert.deepEqual(replayText(principal), ["first credential"]);
  assert.deepEqual(replayText(secondPrincipal), ["second credential"]);
  resetRunBuffersForTest();
});

test("send propagates the original request's signal onto the synthetic canonical Request", async () => {
  let capturedSignal: AbortSignal | null = null;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      capturedSignal = req.signal;
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const controller = new AbortController();
  const originalRequest = new Request("http://localhost/api/client/v1/messages/send", {
    signal: controller.signal,
  });
  await service.send(input, principal, originalRequest);
  const signal = capturedSignal as unknown as AbortSignal;
  assert.ok(signal, "the synthetic canonical Request carries a signal");
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(
    signal.aborted,
    true,
    "aborting the original client request aborts the synthetic canonical Request's signal",
  );
});

test("without an original request the synthetic canonical Request has no signal to propagate", async () => {
  let capturedSignal: AbortSignal | null = null;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      capturedSignal = req.signal;
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await service.send(input, principal);
  const signal = capturedSignal as unknown as AbortSignal;
  assert.ok(signal);
  assert.equal(signal.aborted, false);
});

test("a client disconnect propagates through to detach and clean up the run's canonical subscription", async () => {
  resetRunBuffersForTest();
  const controller = new AbortController();
  let internalRunId = "";
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      const body = await req.json() as { runId: string };
      internalRunId = body.runId;
      const buffer = openRunBuffer([internalRunId]);
      buffer.record({ kind: "assistant_chunk", text: "partial" });
      assert.equal(req.signal.aborted, false, "not aborted while the client is still connected");
      // Mirrors the canonical chat/send pipeline: it listens
      // on its own req.signal and finishes the buffer once the original
      // client disconnects, rather than running an orphaned turn to
      // completion nobody is left to read.
      req.signal.addEventListener("abort", () => buffer.finish(), { once: true });
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });
  const originalRequest = new Request("http://localhost/api/client/v1/messages/send", {
    signal: controller.signal,
  });
  await service.send(input, principal, originalRequest);

  let detached = false;
  const subscription = subscribeRunStream(internalRunId, 0, () => {}, () => { detached = true; });
  assert.ok(subscription && !subscription.done, "a live subscriber attaches while the run is still active");

  controller.abort();

  assert.equal(
    detached,
    true,
    "the subscriber is notified once the client disconnect finishes the canonical buffer",
  );
  assert.equal(getRunBufferStatus(internalRunId)?.done, true, "the canonical run is finished, not left hanging");
  resetRunBuffersForTest();
});

test("attaching a duplicate resume subscriber never launches a second send", async () => {
  resetRunBuffersForTest();
  let executions = 0;
  let internalRunId = "";
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      executions += 1;
      const body = await req.json() as { runId: string };
      internalRunId = body.runId;
      const buffer = openRunBuffer([internalRunId]);
      buffer.record({ kind: "done", isError: false });
      buffer.finish();
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });
  await service.send(input, principal);
  assert.equal(executions, 1);

  // A duplicate resume attach — subscribing again to the already-finished
  // canonical buffer — must only observe the existing history, never
  // trigger a second send.
  const subscription = subscribeRunStream(internalRunId, 0, () => {}, () => {});
  assert.ok(subscription?.done);
  assert.equal(executions, 1, "attach-only never launches");
  resetRunBuffersForTest();
});

test("a fresh durable launching record without a buffer remains retryable for run inspection, retry, and stop", async () => {
  const now = 1_000_000;
  const { service, runOps } = createService({
    now: () => now,
    authorizeConversation: async () => {
      throw new Error("fresh launching state must respond before conversation work");
    },
  });
  runOps.records.set(`${credentialId.toLowerCase()}:${operationId.toLowerCase()}`, {
    version: 1,
    operationId,
    credentialId,
    requestHash: hashNormalizedRequest(input),
    conversationId: input.conversationId,
    internalRunId,
    state: "launching",
    createdAt: now - 1,
    updatedAt: now,
    expiresAt: now + 24 * 60 * 60_000,
  });

  const inspected = await service.inspectRun(operationId, credentialId);
  assert.deepEqual(inspected, {
    kind: "launching",
    metadata: {
      runId: operationId,
      conversationId: input.conversationId,
      resumePath: `/api/client/v1/runs/${operationId}/stream`,
      internalRunId,
    },
    retryAfterMs: PENDING_CLAIM_RETRY_MS,
  });

  const retry = await service.retry(
    operationId,
    { operationId: "a20ad30e-1913-49a4-a48e-0e3c260cd3cb", retryOfTurnId: "turn" },
    principal,
  );
  const stop = await service.stop(operationId, principal);
  for (const response of [retry, stop]) {
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("Retry-After"), String(PENDING_CLAIM_RETRY_MS / 1000));
    const body = await response.json();
    assert.equal(body.error.code, "operation_already_started");
    assert.equal(body.error.retryable, true);
    assert.equal(body.error.details.status, "launching");
    assert.equal(body.error.details.runState, "launching");
  }
});

test("a stale launching record retains crash-recovery behavior instead of the fresh in-progress state", async () => {
  const now = 1_000_000;
  const { service, runOps } = createService({
    now: () => now,
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({ kind: "pending", retryAfterMs: 1 }),
  });
  runOps.records.set(`${credentialId.toLowerCase()}:${operationId.toLowerCase()}`, {
    version: 1,
    operationId,
    credentialId,
    requestHash: hashNormalizedRequest(input),
    conversationId: input.conversationId,
    internalRunId,
    state: "launching",
    createdAt: now - PENDING_CLAIM_RETRY_MS - 1,
    updatedAt: now - PENDING_CLAIM_RETRY_MS,
    expiresAt: now + 24 * 60 * 60_000,
  });

  assert.deepEqual(await service.inspectRun(operationId, credentialId), { kind: "not_found" });
  assert.equal(
    (await service.retry(
      operationId,
      { operationId: "b20ad30e-1913-49a4-a48e-0e3c260cd3cb", retryOfTurnId: "turn" },
      principal,
    )).status,
    404,
  );
  assert.equal((await service.stop(operationId, principal)).status, 404);

  const duplicateSend = await service.send(input, principal);
  assert.equal(duplicateSend.status, 409);
  const duplicateBody = await duplicateSend.json();
  assert.equal(duplicateBody.error.retryable, false);
  assert.equal(duplicateBody.error.details.status, "manual_recovery_required");
});

test("a stale persisted launching state blocks exact retries and returns manual recovery before any dispatch", async () => {
  let executions = 0;
  let claims = 0;
  setClientRunOperationBeforeLaunchHookForTest(() => {
    throw new Error("crash before executeChatSend");
  });
  const service = createDurableService({
    now: () => Date.now() + PENDING_CLAIM_RETRY_MS,
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => {
      claims += 1;
      return claims === 1
        ? { kind: "claimed", claimId: "890437e7-7b87-4af9-a6ce-28931d778f80" }
        : { kind: "pending", retryAfterMs: 1000 };
    },
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async () => {
      executions += 1;
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });

  await assert.rejects(() => service.send(input, principal), /crash before executeChatSend/);
  assert.equal((await storedRunOperation())?.state, "launching");

  const retry = await service.send(input, principal);
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.code, "operation_already_started");
  assert.equal(body.error.details.status, "manual_recovery_required");
  assert.equal(body.error.details.runState, "launching");
  assert.equal(executions, 0, "an unresolved launching state must never auto-dispatch");
});

test("a dispatch crash reconciles through the stable internal run buffer instead of relaunching", async () => {
  let executions = 0;
  let claims = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => {
      claims += 1;
      return claims === 1
        ? { kind: "claimed", claimId: "890437e7-7b87-4af9-a6ce-28931d778f80" }
        : { kind: "pending", retryAfterMs: 1000 };
    },
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      executions += 1;
      const body = await req.json() as { runId: string };
      const buffer = openRunBuffer([body.runId]);
      buffer.record({ kind: "assistant_chunk", text: "partial" });
      throw new Error("crash during executeChatSend");
    },
  });

  await assert.rejects(() => service.send(input, principal), /crash during executeChatSend/);
  assert.equal((await storedRunOperation())?.state, "launching");

  const retry = await service.send(input, principal);
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.code, "operation_already_started");
  assert.equal(body.error.details.resumePath, `/api/client/v1/runs/${operationId}/stream`);
  assert.equal(
    getRunBufferStatus(clientRunBufferKey(operationId, credentialId))?.retainedEventCount,
    1,
    "the retry aliases the internal run buffer onto the client-safe run id",
  );
  assert.equal(executions, 1, "an indeterminate dispatch crash must never re-execute");
});

test("a crash after the launched state is durably written reconciles instead of relaunching after restart", async () => {
  let executions = 0;
  let claims = 0;
  let crashAfterLaunchedPersist = true;
  setClientRunOperationWriteRecordHookForTest(async (_storePath, record, next) => {
    await next();
    if (record.state === "launched" && crashAfterLaunchedPersist) {
      crashAfterLaunchedPersist = false;
      throw new Error("crash after launched state persisted");
    }
  });
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => {
      claims += 1;
      return claims === 1
        ? { kind: "claimed", claimId: "890437e7-7b87-4af9-a6ce-28931d778f80" }
        : { kind: "pending", retryAfterMs: 1000 };
    },
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      executions += 1;
      const body = await req.json() as { runId: string };
      const buffer = openRunBuffer([body.runId]);
      buffer.record({ kind: "done", isError: false });
      buffer.finish();
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });

  const first = await service.send(input, principal);
  assert.equal(first.status, 503);
  assert.equal((await storedRunOperation())?.state, "launched");

  resetRunBuffersForTest();
  const retry = await service.send(input, principal);
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.code, "operation_already_started");
  assert.equal(body.error.details.status, "reconcile_required");
  assert.equal(body.error.details.runState, "launched");
  assert.equal(executions, 1, "a durably launched run must reconcile, never relaunch");
});

test("post-result persistence failures keep the launched state so reclaimed retries reconcile without redispatch", async () => {
  let executions = 0;
  let claims = 0;
  let completions = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => {
      claims += 1;
      return { kind: "claimed", claimId: `890437e7-7b87-4af9-a6ce-28931d778f8${claims}` };
    },
    completeOperation: async (_claim, response) => {
      completions += 1;
      if (completions === 1) throw new Error("post-result persistence failed");
      return { kind: "completed", response };
    },
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      executions += 1;
      const body = await req.json() as { runId: string };
      const buffer = openRunBuffer([body.runId]);
      buffer.record({ kind: "done", isError: false });
      buffer.finish();
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    },
  });

  const first = await service.send(input, principal);
  assert.equal(first.status, 200);
  assert.equal((await storedRunOperation())?.state, "launched");

  resetRunBuffersForTest();
  const retry = await service.send(input, principal);
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.code, "operation_already_started");
  assert.equal(body.error.details.status, "reconcile_required");
  assert.equal(body.error.details.runState, "launched");
  assert.equal(executions, 1, "a reclaimed exact retry must reuse the durable launched state");
});

test("a safe header allowlist is forwarded onto the canonical Request; credentials and the loopback marker never are", async () => {
  let capturedHeaders: Headers | null = null;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      capturedHeaders = req.headers;
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const originalRequest = new Request("http://localhost/api/client/v1/messages/send", {
    headers: {
      "accept-language": "fr-FR",
      authorization: "Bearer super-secret",
      "x-coven-client-v1-local": "forged-loopback-marker",
    },
  });
  await service.send(input, principal, originalRequest);
  const headers = capturedHeaders as unknown as Headers;
  assert.ok(headers);
  assert.equal(headers.get("accept-language"), "fr-FR");
  assert.equal(headers.get("authorization"), null, "the caller's credentials are never forwarded");
  assert.equal(headers.get("x-coven-client-v1-local"), null, "the loopback marker is never forwarded");
});

test("canonical owner and project fields cannot be widened by caller input", async () => {
  let claimed = false;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    claimOperation: async () => {
      claimed = true;
      return { kind: "capacity_exceeded" };
    },
    completeOperation: async () => ({ kind: "not_found" }),
    resolveAttachments: async () => [],
    executeChatSend: async () => new Response(),
  });

  const response = await service.send({ ...input, familiarId: "other" }, principal);
  assert.equal(response.status, 404);
  assert.equal(claimed, false);
});

test("terminal attachment validation failures persist and replay without resolving twice", async () => {
  const attachmentInput = {
    ...input,
    attachmentIds: ["../malformed-attachment"],
  };
  let resolutions = 0;
  let executions = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => {
      resolutions += 1;
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment ids must be safe and distinct.",
      );
    },
    executeChatSend: async () => {
      executions += 1;
      return new Response();
    },
  });
  const first = await service.send(attachmentInput, principal);
  const firstBody = await first.json();
  assert.equal(first.status, 400);
  assert.deepEqual(firstBody, {
    ok: false,
    error: {
      code: "invalid_request",
      message: "Attachment ids must be safe and distinct.",
      retryable: false,
    },
  });
  assert.equal((await storedRunOperation(operationId, credentialId, attachmentInput))?.state, "terminal");

  const replay = await service.send(attachmentInput, principal);
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(resolutions, 1, "a terminal attachment failure never resolves twice");
  assert.equal(executions, 0);
});

test("retryable attachment service failures return to reserved and retry the same operation id", async () => {
  const attachmentInput = {
    ...input,
    attachmentIds: ["9f4145de-9b43-4abc-876d-81ef63de60e0.png"],
  };
  let resolutions = 0;
  let executions = 0;
  const service = createDurableService({
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => {
      resolutions += 1;
      if (resolutions === 1) {
        throw new ClientAttachmentError(
          503,
          "service_unavailable",
          "The attachment index is unavailable.",
        );
      }
      return [];
    },
    executeChatSend: async () => {
      executions += 1;
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const first = await service.send(attachmentInput, principal);
  assert.equal(first.status, 503);
  assert.equal((await first.json()).error.retryable, true);
  assert.equal((await storedRunOperation(operationId, credentialId, attachmentInput))?.state, "reserved");

  const second = await service.send(attachmentInput, principal);
  assert.equal(second.status, 200);
  assert.equal((await storedRunOperation(operationId, credentialId, attachmentInput))?.state, "launched");
  assert.equal(resolutions, 2);
  assert.equal(executions, 1);
});

test("unexpected attachment resolution failures retain crash-recovery semantics", async () => {
  let resolutions = 0;
  let executions = 0;
  const service = createDurableService({
    now: () => Date.now() + PENDING_CLAIM_RETRY_MS,
    authorizeConversation: async (_id, effect) => ({ ok: true, value: await effect(conversation) }),
    resolveAttachments: async () => {
      resolutions += 1;
      throw new Error("unexpected attachment resolver failure");
    },
    executeChatSend: async () => {
      executions += 1;
      return new Response();
    },
  });

  await assert.rejects(
    () => service.send(input, principal),
    /unexpected attachment resolver failure/,
  );
  assert.equal((await storedRunOperation())?.state, "launching");

  const retry = await service.send(input, principal);
  assert.equal(retry.status, 409);
  const body = await retry.json();
  assert.equal(body.error.details.status, "manual_recovery_required");
  assert.equal(body.error.details.runState, "launching");
  assert.equal(resolutions, 1, "a crash-state retry must not resolve attachments again");
  assert.equal(executions, 0);
});

test("retry accepts only a persisted failed/cancelled assistant and preserves lineage", async () => {
  const failedConversation: ConversationFile = {
    ...conversation,
    activeLeafId: "assistant-failed",
    turns: [
      {
        id: "user-original",
        parentId: "older-assistant",
        role: "user",
        text: "try again",
        createdAt: "2026-08-11T00:00:01.000Z",
      },
      {
        id: "assistant-failed",
        parentId: "user-original",
        role: "assistant",
        text: "failed",
        isError: true,
        createdAt: "2026-08-11T00:00:02.000Z",
      },
    ],
  };
  let mapped: Record<string, unknown> | null = null;
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({
      ok: true,
      value: await effect(failedConversation),
    }),
    findCompletedOperation: async () => ({
      status: 409,
      body: {
        internalRunId,
        ok: false,
        error: {
          code: "operation_already_started",
          message: "started",
          retryable: false,
          details: {
            runId: operationId,
            conversationId: input.conversationId,
            resumePath: `/api/client/v1/runs/${operationId}/stream`,
          },
        },
      },
    }),
    claimOperation: async () => ({
      kind: "claimed",
      claimId: "890437e7-7b87-4af9-a6ce-28931d778f80",
    }),
    completeOperation: async (_claim, response) => ({ kind: "completed", response }),
    resolveAttachments: async () => [],
    executeChatSend: async (req) => {
      mapped = await req.json();
      return new Response(
        `id: 1\ndata: ${JSON.stringify({ kind: "done", isError: false })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });

  const newOperationId = "f20ad30e-1913-49a4-a48e-0e3c260cd3cb";
  const response = await service.retry(
    operationId,
    { operationId: newOperationId, retryOfTurnId: "assistant-failed" },
    principal,
  );
  assert.equal(response.status, 200);
  const sent = mapped as unknown as Record<string, unknown>;
  assert.equal(sent.prompt, "try again");
  assert.equal(sent.parentTurnId, "older-assistant");
  assert.equal(typeof sent.runId, "string");
  assert.notEqual(sent.runId, newOperationId);
  assert.equal(
    failedConversation.turns.find((turn) => turn.id === "assistant-failed")?.text,
    "failed",
    "retry never edits or deletes the failed turn",
  );
});

test("stop delegates only canonical run/conversation identifiers and is idempotent", async () => {
  const stoppedKeys: string[] = [];
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({
      ok: true,
      value: await effect(conversation),
    }),
    findCompletedOperation: async () => ({
      status: 409,
      body: {
        internalRunId,
        error: {
          code: "operation_already_started",
          details: {
            runId: operationId,
            conversationId: input.conversationId,
            resumePath: `/api/client/v1/runs/${operationId}/stream`,
          },
        },
      },
    }),
    requestChatStop: (key) => {
      stoppedKeys.push(key);
      return false;
    },
  });
  const response = await service.stop(operationId, principal);
  assert.equal(response.status, 200);
  assert.deepEqual(stoppedKeys, [internalRunId]);
  assert.equal((await response.json()).stopped, false);
});

test("two credentials reusing one operation UUID stop only their own internal run", async () => {
  const secondCredentialId = "5e7f2ed1-5d41-4eed-8123-bf4c93f71df5";
  const secondInternalRunId = "7e7f2ed1-5d41-4eed-8123-bf4c93f71df7";
  const stoppedKeys: string[] = [];
  const { service } = createService({
    authorizeConversation: async (_id, effect) => ({
      ok: true,
      value: await effect(conversation),
    }),
    findCompletedOperation: async ({ credentialId: requestedCredential }) => ({
      status: 409,
      body: {
        internalRunId: requestedCredential === credentialId ? internalRunId : secondInternalRunId,
        error: {
          code: "operation_already_started",
          details: {
            runId: operationId,
            conversationId: input.conversationId,
            resumePath: `/api/client/v1/runs/${operationId}/stream`,
          },
        },
      },
    }),
    requestChatStop: (key) => {
      stoppedKeys.push(key);
      return true;
    },
  });

  await service.stop(operationId, principal);
  await service.stop(operationId, { ...principal, credentialId: secondCredentialId });
  assert.deepEqual(stoppedKeys, [internalRunId, secondInternalRunId]);
  assert.ok(!stoppedKeys.includes(operationId));
});
