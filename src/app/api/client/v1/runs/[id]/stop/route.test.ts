// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-stop-"));
const covenHome = path.join(root, "home");
process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(root, "operations.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(root, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(root, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(root, "permission-config.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-stop-secret";
await mkdir(covenHome, { recursive: true });

const { POST } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { requireClientPrincipal } = await import("@/lib/server/client-v1/auth.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { saveConversation } = await import("@/lib/cave-conversations.ts");
const {
  claimOperation,
  completeOperation,
  hashNormalizedRequest,
} = await import("@/lib/server/client-v1/idempotency-store.ts");
const { registerChatRun, unregisterChatRun } = await import("@/lib/server/chat-stop-registry.ts");

after(() => rm(root, { recursive: true, force: true }));

async function writeConfig(familiars: Record<string, unknown> = { charm: { harness: "claude" } }) {
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(
    path.join(covenHome, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars,
      roles: [],
      addons: { github: false, code: false, browser: false, flow: false, journal: false, docs: false },
      marketplace: { installed: {} },
      multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
      omnigent: {
        enabled: false,
        baseUrl: "",
        defaultAgentId: "",
        defaultHostId: "",
        defaultWorkspace: "",
        hostMap: {},
        hostWorkspaceMap: {},
        exposeHostsInComposer: true,
      },
      remoteHosts: [],
    }),
  );
}

async function seedConversation(sessionId: string, overrides: Partial<Record<string, unknown>> = {}) {
  await saveConversation({
    sessionId,
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    turns: [],
    ...overrides,
  });
}

/** Fabricates the "messages-send" completed-409 ledger record `findRun` reads,
 *  without running the real send pipeline — the exact shape `run-service.ts`'s
 *  `findRun` expects. */
async function seedRun(
  runId: string,
  credentialId: string,
  conversationId: string,
  internalRunId: string,
) {
  const requestHash = hashNormalizedRequest({ seed: runId });
  const claim = await claimOperation({
    key: runId,
    credentialId,
    route: "messages-send",
    requestHash,
  });
  assert.equal(claim.kind, "claimed", "seedRun requires a fresh claim");
  const completed = await completeOperation(
    { key: runId, claimId: claim.claimId },
    {
      status: 409,
      body: {
        internalRunId,
        error: {
          code: "operation_already_started",
          details: {
            runId,
            conversationId,
            resumePath: `/api/client/v1/runs/${runId}/stream`,
          },
        },
      },
    },
  );
  assert.equal(completed.kind, "completed", "seedRun requires a fresh completion");
}

async function issue(scopes: readonly string[] = ["chat:write"]) {
  const { token } = await issueCredential({
    appName: "Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

async function principalFor(token: string) {
  const probe = new Request("http://localhost/probe", {
    headers: {
      [CLIENT_V1_LOCAL_HEADER]: process.env.COVEN_CAVE_LOCAL_PEER_SECRET!,
      authorization: "Bearer " + token,
    },
  });
  const result = await requireClientPrincipal(probe, "chat:write");
  assert.ok(result.ok);
  return result.principal;
}

function stopRequest(
  runId: string,
  opts: { marker?: string | null; bearer?: string | null; idempotencyKey?: string | null } = {},
) {
  const headers = new Headers();
  if (opts.marker !== null) {
    headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? process.env.COVEN_CAVE_LOCAL_PEER_SECRET!);
  }
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", "Bearer " + opts.bearer);
  if (opts.idempotencyKey !== null) headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  const req = new Request(`http://localhost/api/client/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
    headers,
  });
  return { req, ctx: { params: Promise.resolve({ id: runId }) } };
}

test("stop requires the internal marker and chat:write before the Idempotency-Key or run id are read", async () => {
  resetRateLimitsForTest();
  const noMarker = await POST(
    ...Object.values(stopRequest(crypto.randomUUID(), { marker: null, idempotencyKey: null })),
  );
  assert.equal(noMarker.status, 403);

  const token = await issue(["chat:read"]);
  const wrongScope = await POST(
    ...Object.values(stopRequest(crypto.randomUUID(), { bearer: token, idempotencyKey: null })),
  );
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json()).error.code, "scope_denied");
});

test("stop rejects a missing or malformed Idempotency-Key with 400 before the run id is validated", async () => {
  resetRateLimitsForTest();
  const token = await issue();

  const missing = await POST(...Object.values(stopRequest("not-a-uuid", { bearer: token, idempotencyKey: null })));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, "invalid_request");

  const malformed = await POST(
    ...Object.values(stopRequest("not-a-uuid", { bearer: token, idempotencyKey: "nope" })),
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_request");
});

test("stop hides an unknown run with 404", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await POST(...Object.values(stopRequest(crypto.randomUUID(), { bearer: token })));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("stop claims before delegating, and a live run is actually stopped exactly once (replay never double-stops)", async () => {
  resetRateLimitsForTest();
  await writeConfig();
  const conversationId = "stop-live-conv";
  await seedConversation(conversationId);
  const token = await issue();
  const { credentialId } = await principalFor(token);

  const runId = crypto.randomUUID();
  const internalRunId = crypto.randomUUID();
  await seedRun(runId, credentialId, conversationId, internalRunId);

  let killCount = 0;
  const handle = registerChatRun([internalRunId], () => {
    killCount += 1;
  });

  const key = crypto.randomUUID();
  const first = await POST(...Object.values(stopRequest(runId, { bearer: token, idempotencyKey: key })));
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.runId, runId);
  assert.equal(firstBody.stopped, true);
  assert.deepEqual(
    Object.keys(firstBody).sort(),
    ["ok", "runId", "stopped"],
    "the stop receipt is bounded to ok/runId/stopped only — no conversationId or internal run id",
  );
  assert.equal(killCount, 1);

  // Exact replay: the SAME Idempotency-Key against the SAME run must return
  // the identical persisted receipt WITHOUT calling requestChatStop again.
  const replay = await POST(...Object.values(stopRequest(runId, { bearer: token, idempotencyKey: key })));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(killCount, 1, "a replayed stop must never delegate to requestChatStop a second time");

  unregisterChatRun(handle);
});

test("stop: the same Idempotency-Key against a different run id conflicts with 409 rather than stopping the second run", async () => {
  resetRateLimitsForTest();
  await writeConfig();
  const token = await issue();
  const { credentialId } = await principalFor(token);

  const conversationA = "stop-conflict-conv-a";
  const conversationB = "stop-conflict-conv-b";
  await seedConversation(conversationA);
  await seedConversation(conversationB);

  const runA = crypto.randomUUID();
  const runB = crypto.randomUUID();
  const internalA = crypto.randomUUID();
  const internalB = crypto.randomUUID();
  await seedRun(runA, credentialId, conversationA, internalA);
  await seedRun(runB, credentialId, conversationB, internalB);

  const stoppedKeys: string[] = [];
  const handleA = registerChatRun([internalA], () => stoppedKeys.push(internalA));
  const handleB = registerChatRun([internalB], () => stoppedKeys.push(internalB));

  const key = crypto.randomUUID();
  const first = await POST(...Object.values(stopRequest(runA, { bearer: token, idempotencyKey: key })));
  assert.equal(first.status, 200);

  const second = await POST(...Object.values(stopRequest(runB, { bearer: token, idempotencyKey: key })));
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "conflict");
  assert.deepEqual(stoppedKeys, [internalA], "the conflicting second run must never actually be stopped");

  unregisterChatRun(handleA);
  unregisterChatRun(handleB);
});

test("stop: two different credentials never share a claim or stop each other's run under the same Idempotency-Key", async () => {
  resetRateLimitsForTest();
  await writeConfig();
  const tokenOne = await issue();
  const tokenTwo = await issue();
  const principalOne = await principalFor(tokenOne);
  const principalTwo = await principalFor(tokenTwo);

  const conversationId = "stop-cross-credential-conv";
  await seedConversation(conversationId);

  const internalOne = crypto.randomUUID();
  const internalTwo = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await seedRun(runId, principalOne.credentialId, conversationId, internalOne);
  await seedRun(runId, principalTwo.credentialId, conversationId, internalTwo);

  const stoppedKeys: string[] = [];
  const handleOne = registerChatRun([internalOne], () => stoppedKeys.push(internalOne));
  const handleTwo = registerChatRun([internalTwo], () => stoppedKeys.push(internalTwo));

  const sharedKey = crypto.randomUUID();
  const first = await POST(...Object.values(stopRequest(runId, { bearer: tokenOne, idempotencyKey: sharedKey })));
  assert.equal(first.status, 200);
  const second = await POST(...Object.values(stopRequest(runId, { bearer: tokenTwo, idempotencyKey: sharedKey })));
  assert.equal(second.status, 200, "a different credential reusing the same run id/key claims independently");

  assert.deepEqual(stoppedKeys.sort(), [internalOne, internalTwo].sort());

  unregisterChatRun(handleOne);
  unregisterChatRun(handleTwo);
});

console.log("client/v1/runs/[id]/stop route.test.ts: ok");
