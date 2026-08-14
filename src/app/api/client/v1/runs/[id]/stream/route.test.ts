// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const root = await mkdtemp(path.join(testTmpRoot, "client-v1-run-stream-"));
const covenHome = path.join(root, "home");
process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(root, "credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(root, "operations.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(root, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(root, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(root, "permission-config.json");
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = "client-v1-stream-secret";
await mkdir(covenHome, { recursive: true });

const { GET } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { requireClientPrincipal } = await import("@/lib/server/client-v1/auth.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { saveConversation } = await import("@/lib/cave-conversations.ts");
const {
  claimOperation,
  COMPLETED_OPERATION_TTL_MS,
  completeOperation,
  hashNormalizedRequest,
  PENDING_CLAIM_RETRY_MS,
} = await import("@/lib/server/client-v1/idempotency-store.ts");
const { clientRunOperationStorePath } = await import("@/lib/server/client-v1/run-operation-store.ts");

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

async function seedConversation(sessionId: string) {
  await saveConversation({
    sessionId,
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    turns: [],
  });
}

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
  assert.equal(claim.kind, "claimed");
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
  assert.equal(completed.kind, "completed");
}

async function seedLaunchingRun(
  runId: string,
  credentialId: string,
  conversationId: string,
  internalRunId: string,
  stale: boolean,
) {
  const updatedAt = Date.now() - (stale ? PENDING_CLAIM_RETRY_MS : 0);
  const storePath = clientRunOperationStorePath(runId, credentialId);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      operationId: runId,
      credentialId,
      requestHash: hashNormalizedRequest({ seed: runId }),
      conversationId,
      internalRunId,
      state: "launching",
      createdAt: updatedAt,
      updatedAt,
      expiresAt: updatedAt + COMPLETED_OPERATION_TTL_MS,
    }),
  );
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
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
      authorization: `Bearer ${token}`,
    },
  });
  const result = await requireClientPrincipal(probe, "chat:read");
  assert.ok(result.ok);
  return result.principal;
}

function streamRequest(
  runId: string,
  token: string,
  opts: { cursor?: string; lastEventId?: string } = {},
) {
  const headers = new Headers({
    [CLIENT_V1_LOCAL_HEADER]: process.env.COVEN_CAVE_LOCAL_PEER_SECRET!,
    authorization: `Bearer ${token}`,
  });
  if (opts.lastEventId) headers.set("last-event-id", opts.lastEventId);
  const url = new URL(`http://localhost/api/client/v1/runs/${encodeURIComponent(runId)}/stream`);
  if (opts.cursor !== undefined) url.searchParams.set("cursor", opts.cursor);
  return [
    new Request(url, { headers }),
    { params: Promise.resolve({ id: runId }) },
  ] as const;
}

test("stream rejects a non-resumable MAX_SAFE_INTEGER cursor with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(...streamRequest(crypto.randomUUID(), token, {
    cursor: String(Number.MAX_SAFE_INTEGER),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("stream fallback reconcile stays encodable at the resumable upper bound", async () => {
  resetRateLimitsForTest();
  await writeConfig();
  const token = await issue();
  const { credentialId } = await principalFor(token);
  const runId = crypto.randomUUID();
  const conversationId = "client-v1-stream-conversation";
  await seedConversation(conversationId);
  await seedRun(runId, credentialId, conversationId, crypto.randomUUID());

  const response = await GET(...streamRequest(runId, token, {
    cursor: String(Number.MAX_SAFE_INTEGER - 1),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const text = await response.text();
  assert.match(text, new RegExp(`^id: ${Number.MAX_SAFE_INTEGER}$`, "m"));
  assert.match(text, /"type":"reconcile_required"/);
});

test("stream reports fresh pre-buffer launching runs as retryable, but keeps stale launch crashes not found", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const { credentialId } = await principalFor(token);
  const conversationId = "client-v1-stream-launching-conversation";

  const freshRunId = crypto.randomUUID();
  await seedLaunchingRun(
    freshRunId,
    credentialId,
    conversationId,
    crypto.randomUUID(),
    false,
  );
  const fresh = await GET(...streamRequest(freshRunId, token));
  assert.equal(fresh.status, 409);
  assert.ok(Number(fresh.headers.get("Retry-After")) >= 1);
  const freshBody = await fresh.json();
  assert.equal(freshBody.error.code, "operation_already_started");
  assert.equal(freshBody.error.retryable, true);
  assert.equal(freshBody.error.details.status, "launching");

  const staleRunId = crypto.randomUUID();
  await seedLaunchingRun(
    staleRunId,
    credentialId,
    conversationId,
    crypto.randomUUID(),
    true,
  );
  const stale = await GET(...streamRequest(staleRunId, token));
  assert.equal(stale.status, 404);
  assert.equal((await stale.json()).error.retryable, false);
});
