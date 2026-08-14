// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-task-handoff-route-"));
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "operations.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "task-handoff-route-secret";

const { POST } = await import("./route.ts");
const actionServiceModule = await import("@/lib/server/client-v1/action-service.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");

const original = actionServiceModule.clientActionService.handoffTask;

after(async () => {
  actionServiceModule.clientActionService.handoffTask = original;
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRateLimitsForTest();
  actionServiceModule.clientActionService.handoffTask = original;
  await rm(process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH!, { force: true });
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-shm`, { force: true });
  await rm(`${process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH}.lock.sqlite3-wal`, { force: true });
});

async function token(scopes = ["tasks:write"]) {
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
  return new Request("http://127.0.0.1/api/client/v1/tasks/handoff", {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {
      conversationId: "conv-1",
      turnId: "assistant-1",
      prompt: "Create the follow-up task",
      title: "Ship the fix",
    }),
  });
}

test("task handoff requires the loopback marker, tasks:write, and a UUID Idempotency-Key", async () => {
  let calls = 0;
  actionServiceModule.clientActionService.handoffTask = async () => {
    calls += 1;
    return {
      ok: true,
      receipt: {
        source: { conversationId: "conv-1", turnId: "assistant-1", prompt: "Create the follow-up task" },
        task: { id: "card-1", title: "Ship the fix", status: "inbox", familiarId: "charm", projectId: null, createdAt: "2026-08-10T10:02:00.000Z", updatedAt: "2026-08-10T10:02:00.000Z" },
      },
    };
  };

  assert.equal((await POST(request({ marker: null, bearer: null, idempotencyKey: null }))).status, 403);
  const wrongScope = await POST(request({ bearer: await token(["chat:write"]) }));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json()).error.code, "scope_denied");
  const missingKey = await POST(request({ bearer: await token(), idempotencyKey: null }));
  assert.equal(missingKey.status, 400);
  assert.equal(calls, 0);
});

test("task handoff persists exact replays and conflicts when the same key is reused for a different proposal", async () => {
  let calls = 0;
  actionServiceModule.clientActionService.handoffTask = async (input) => {
    calls += 1;
    return {
      ok: true,
      receipt: {
        source: {
          conversationId: input.conversationId,
          turnId: input.turnId,
          prompt: input.prompt,
        },
        task: {
          id: "card-1",
          title: input.title ?? input.prompt,
          status: "inbox",
          familiarId: "charm",
          projectId: null,
          createdAt: "2026-08-10T10:02:00.000Z",
          updatedAt: "2026-08-10T10:02:00.000Z",
        },
      },
    };
  };

  const bearer = await token();
  const key = "9f4145de-9b43-4abc-876d-81ef63de60e0";
  const first = await POST(request({ bearer, idempotencyKey: key }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const replay = await POST(request({ bearer, idempotencyKey: key }));
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(calls, 1, "the service runs only once for an exact replay");

  const conflict = await POST(request({
    bearer,
    idempotencyKey: key,
    body: { conversationId: "conv-1", turnId: "assistant-2", prompt: "Create a different task" },
  }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "conflict");
  assert.equal(calls, 1);
});
