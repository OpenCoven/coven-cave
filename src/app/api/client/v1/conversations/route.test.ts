// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import crypto from "node:crypto";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-conversations-"));
const covenHome = path.join(workdir, "home");
await mkdir(covenHome, { recursive: true });

process.env.COVEN_HOME = covenHome;
delete process.env.COVEN_SOCKET;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");
process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH = path.join(workdir, "client-v1-operations.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(workdir, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(workdir, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(workdir, "permission-config.json");

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { GET, POST } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { saveConversation, loadConversation, clearConversationListMetadataCache, CONV_DIR } = await import(
  "@/lib/cave-conversations.ts"
);
const { sessionsListCache } = await import("@/lib/server/sessions-list-cache.ts");

let stopDaemon = async () => {};

after(async () => {
  await stopDaemon();
  await rm(workdir, { recursive: true, force: true });
});

async function startDaemon(rows: unknown[] = []) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object" && typeof address.port === "number");
  stopDaemon = async () =>
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return `http://127.0.0.1:${address.port}`;
}

async function writeHubConfig(url: string, familiars: Record<string, unknown> = {}) {
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
      multiHost: { mode: "hub", hubUrl: url, executorUrls: [] },
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

function requestWith(opts: { marker?: string | null; bearer?: string | null; url?: string } = {}) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", `Bearer ${opts.bearer}`);
  return new Request(opts.url ?? "http://127.0.0.1/api/client/v1/conversations", { headers });
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
  const { token } = await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

async function resetFixtures() {
  await stopDaemon();
  stopDaemon = async () => {};
  clearConversationListMetadataCache();
  sessionsListCache.clear();
  await rm(process.env.COVEN_CAVE_CLIENT_OPERATION_STORE_PATH!, { force: true });
}

function postRequestWith(
  opts: {
    marker?: string | null;
    bearer?: string | null;
    idempotencyKey?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", `Bearer ${opts.bearer}`);
  if (opts.idempotencyKey !== null) headers.set("idempotency-key", opts.idempotencyKey ?? crypto.randomUUID());
  headers.set("content-type", "application/json");
  return new Request("http://127.0.0.1/api/client/v1/conversations", {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  });
}

/**
 * Writes a conversation JSON fixture directly into `CONV_DIR`, bypassing
 * `saveConversation`'s real-clock `updatedAt` stamp (it always overwrites
 * `updatedAt` with `new Date().toISOString()`). Tests that assert on
 * *relative order between two saved conversations* need fully deterministic,
 * caller-controlled `updatedAt` values — two `saveConversation()` calls back
 * to back can tie (or even invert) on the real clock and make ordering
 * assertions flaky. This mirrors the same direct-fixture-write pattern used
 * by `cave-conversations.test.ts`'s content-search fixtures.
 */
async function writeConversationFixture(conv: {
  sessionId: string;
  familiarId: string;
  harness: string;
  runtime: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: unknown[];
}) {
  await mkdir(CONV_DIR, { recursive: true });
  await writeFile(path.join(CONV_DIR, `${conv.sessionId}.json`), JSON.stringify(conv), "utf8");
}

test("an absent internal marker returns 403 unauthorized", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith({ marker: null }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("a verified marker with no bearer returns 401 unauthorized", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith());
  assert.equal(response.status, 401);
});

test("a credential missing chat:read is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:write"]);
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("an invalid familiarId is rejected with 400 before any data access", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations?familiarId=" + encodeURIComponent("bad id") }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("an invalid cursor is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations?cursor=not-a-valid-cursor" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("a non-numeric or out-of-range limit is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  for (const limit of ["0", "-1", "abc", "201", "1.5"]) {
    const response = await GET(
      requestWith({ bearer: token, url: `http://127.0.0.1/api/client/v1/conversations?limit=${limit}` }),
    );
    assert.equal(response.status, 400, `limit=${limit} should be rejected`);
  }
});

test("lists conversations with deterministic pagination, dedup, and a page ETag", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  // Deterministic on-disk fixtures (not `saveConversation`, which always
  // stamps `updatedAt` with the real clock) so `conv-b` is unambiguously
  // newer than `conv-a` on every run — no tie-breaking or clock-timing
  // dependence, and production sort/pagination code is exercised unchanged.
  await writeConversationFixture({
    sessionId: "conv-a",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "First",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await writeConversationFixture({
    sessionId: "conv-b",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Second",
    createdAt: "2026-08-04T18:00:00.000Z",
    updatedAt: "2026-08-04T18:00:00.000Z",
    turns: [],
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);

  const token = await issue();
  const page1 = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations?limit=1" }),
  );
  assert.equal(page1.status, 200, await page1.clone().text());
  const page1Body = await page1.json();
  assert.equal(page1Body.items.length, 1);
  assert.equal(page1Body.items[0].id, "conv-b", "newest updatedAt sorts first");
  assert.ok(page1Body.nextCursor);
  assert.ok(page1.headers.get("etag"));
  assert.equal(page1Body.degraded, false, "a healthy list response reports degraded: false");

  const page2 = await GET(
    requestWith({
      bearer: token,
      url: `http://127.0.0.1/api/client/v1/conversations?limit=1&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
    }),
  );
  const page2Body = await page2.json();
  assert.equal(page2Body.items.length, 1);
  assert.equal(page2Body.items[0].id, "conv-a");
  assert.equal(page2Body.nextCursor, null, "the last page has no next cursor");

  assert.notEqual(page1.headers.get("etag"), page2.headers.get("etag"), "different pages have different ETags");
});

test("projectId narrows the conversation list to that project's sessions", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const projectRoot = path.join(workdir, "proj-root");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-x", name: "X", root: projectRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "conversations-route-project",
    }),
  );
  await saveConversation({
    sessionId: "in-project",
    familiarId: "charm",
    harness: "claude",
    runtime: `local:${projectRoot}`,
    title: "In project",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  await saveConversation({
    sessionId: "no-project",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "No project",
    createdAt: "2026-08-04T17:05:00.000Z",
    updatedAt: "2026-08-04T17:05:00.000Z",
    turns: [],
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);

  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations?projectId=proj-x" }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.items.map((i: { id: string }) => i.id), ["in-project"]);
});

test("an invalid projectId is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations?projectId=" + encodeURIComponent("bad/id") }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("when the daemon is unreachable, the response reports degraded: true and still returns local-only results, never the raw daemon error", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "degraded-conv",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Local during outage",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [],
  });
  // Never start a daemon; point the hub at an address nothing listens on so
  // the canonical merge falls back to its local-only degraded path.
  await writeHubConfig("http://127.0.0.1:9");

  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.degraded, true, "the client-v1 list response signals degraded state");
  assert.ok(
    body.items.some((i: { id: string }) => i.id === "degraded-conv"),
    "the local-only conversation survives the daemon outage",
  );
  const raw = JSON.stringify(body);
  assert.equal(
    /ECONNREFUSED|127\.0\.0\.1:9\b|daemon http|error/i.test(raw),
    false,
    "no raw daemon error text or sentinel `error` field crosses the client-v1 wire boundary",
  );
});

test("an uncaught config-load exception (e.g. config.json unreadable as a file) is translated to a generic service_unavailable envelope, never a raw exception message/path", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const configPath = path.join(covenHome, "cave", "config.json");
  await rm(configPath, { recursive: true, force: true });
  await mkdir(configPath, { recursive: true }); // config.json is now a directory, not a file — forces a real EISDIR

  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "service_unavailable");
  const raw = JSON.stringify(body);
  assert.doesNotMatch(
    raw,
    /EISDIR|config\.json|\.test-tmp|client-v1-conversations-/,
    "no raw fs error/path ever crosses the client-v1 wire boundary",
  );

  await rm(configPath, { recursive: true, force: true });
});

console.log("client/v1/conversations route.test.ts: ok");

// ── POST (Task 7: canonical conversation creation) ──────────────────────────

test("POST: an absent internal marker returns 403 before the Idempotency-Key or body are read", async () => {
  resetRateLimitsForTest();
  const response = await POST(postRequestWith({ marker: null, idempotencyKey: null, rawBody: "not json" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("POST: a credential missing conversations:write is denied with 403 scope_denied before the body is read", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:read"]);
  const response = await POST(
    postRequestWith({ bearer: token, idempotencyKey: null, rawBody: "not json" }),
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "scope_denied");
});

test("POST: a missing Idempotency-Key is rejected with 400 before the body is read", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const response = await POST(
    postRequestWith({ bearer: token, idempotencyKey: null, rawBody: "not json" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("POST: a non-UUID Idempotency-Key is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const response = await POST(postRequestWith({ bearer: token, idempotencyKey: "not-a-uuid" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("POST: malformed JSON is rejected with 400 invalid_request", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const response = await POST(postRequestWith({ bearer: token, rawBody: "{not json" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("POST: extra keys in the body are rejected with 400 invalid_request", async () => {
  resetRateLimitsForTest();
  const token = await issue(["conversations:write"]);
  const response = await POST(
    postRequestWith({ bearer: token, body: { familiarId: "charm", projectRoot: null, extra: 1 } }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("POST: an unknown familiar returns 404 not_found", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, {});
  const token = await issue(["conversations:write"]);
  const response = await POST(
    postRequestWith({ bearer: token, body: { familiarId: "ghost", projectRoot: null } }),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "not_found");
});

test("POST: creates an empty conversation and returns 201 with an ETag equal to its revision", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const response = await POST(
    postRequestWith({ bearer: token, body: { familiarId: "charm", projectRoot: null } }),
  );
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.conversation.familiarId, "charm");
  assert.equal(
    body.conversation.turns,
    undefined,
    "the bounded create receipt never carries a turns array (spec-review finding)",
  );
  assert.equal(response.headers.get("etag"), body.conversation.revision);
  const stored = await loadConversation(body.conversation.id);
  assert.ok(stored, "the conversation was actually persisted");
});

test("POST: replaying the exact same Idempotency-Key and body returns the identical response without minting a second conversation", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();
  const body = { familiarId: "charm", projectRoot: null };

  const first = await POST(postRequestWith({ bearer: token, idempotencyKey: key, body }));
  assert.equal(first.status, 201);
  const firstBody = await first.json();

  const second = await POST(postRequestWith({ bearer: token, idempotencyKey: key, body }));
  assert.equal(second.status, 201);
  const secondBody = await second.json();

  assert.deepEqual(firstBody, secondBody, "a replay returns the byte-identical persisted response");
  assert.equal(
    firstBody.conversation.id,
    secondBody.conversation.id,
    "a replay never mints a second conversation",
  );
});

test("POST: the same Idempotency-Key with a different body conflicts with 409", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl, { charm: { harness: "claude" }, sage: { harness: "claude" } });
  const token = await issue(["conversations:write"]);
  const key = crypto.randomUUID();

  const first = await POST(
    postRequestWith({ bearer: token, idempotencyKey: key, body: { familiarId: "charm", projectRoot: null } }),
  );
  assert.equal(first.status, 201);

  const second = await POST(
    postRequestWith({ bearer: token, idempotencyKey: key, body: { familiarId: "sage", projectRoot: null } }),
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "conflict");
});

console.log("client/v1/conversations route.test.ts (POST): ok");
