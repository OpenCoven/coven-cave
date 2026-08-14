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
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-conversation-search-"));
const covenHome = path.join(workdir, "home");
await mkdir(covenHome, { recursive: true });

process.env.COVEN_HOME = covenHome;
delete process.env.COVEN_SOCKET;
process.env.COVEN_CAVE_CLIENT_CREDENTIAL_STORE_PATH = path.join(workdir, "client-v1-credentials.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(workdir, "projects.json");
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(workdir, "permissions.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = path.join(workdir, "permission-config.json");

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;

const { GET } = await import("./route.ts");
const { issueCredential } = await import("@/lib/server/client-v1/credential-store.ts");
const { resetRateLimitsForTest } = await import("@/lib/server/client-v1/rate-limit.ts");
const { saveConversation, clearConversationListMetadataCache } = await import("@/lib/cave-conversations.ts");
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

async function writeHubConfig(url: string) {
  await mkdir(path.join(covenHome, "cave"), { recursive: true });
  await writeFile(
    path.join(covenHome, "cave", "config.json"),
    JSON.stringify({
      version: 1,
      defaults: { harness: "codex", model: "openai/gpt-5.6-sol" },
      familiars: {},
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
  return new Request(opts.url ?? "http://127.0.0.1/api/client/v1/conversations/search?q=hello", { headers });
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
}

test("an absent internal marker returns 403 unauthorized before the query is read", async () => {
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

test("a query shorter than 2 characters is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations/search?q=a" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("a missing query is rejected with 400", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/conversations/search" }),
  );
  assert.equal(response.status, 400);
});

test("finds matching conversations and excludes ungranted ones", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  const projectRoot = path.join(workdir, "search-proj");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-search", name: "S", root: projectRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "conversation-search-project",
    }),
  );
  await saveConversation({
    sessionId: "findable",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: "local:",
    title: "Findable",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [{ id: "t1", role: "user", text: "please find the launch plan", createdAt: "2026-08-04T17:00:00.000Z", parentId: null }],
    activeLeafId: "t1",
  });
  await saveConversation({
    sessionId: "ungranted",
    familiarId: "granted-fam",
    harness: "claude",
    runtime: `local:${projectRoot}`,
    title: "Ungranted",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [{ id: "t1", role: "user", text: "the launch plan lives here too", createdAt: "2026-08-04T17:00:00.000Z", parentId: null }],
    activeLeafId: "t1",
  });
  const daemonUrl = await startDaemon([]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  const response = await GET(
    requestWith({
      bearer: token,
      url:
        "http://127.0.0.1/api/client/v1/conversations/search?q=" +
        encodeURIComponent("launch plan") +
        "&familiarId=granted-fam",
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.hits.map((h: { sessionId: string }) => h.sessionId),
    ["findable"],
    "a conversation in a project the familiar has no grant for must never surface through search",
  );
  assert.equal(body.degraded, false, "a healthy search response reports degraded: false");
});

test("when the daemon is unreachable, a locally-visible hit still surfaces with degraded: true and no raw daemon error", async () => {
  resetRateLimitsForTest();
  await resetFixtures();
  await saveConversation({
    sessionId: "degraded-search-hit",
    familiarId: "charm",
    harness: "claude",
    runtime: "local:",
    title: "Search during outage",
    createdAt: "2026-08-04T17:00:00.000Z",
    updatedAt: "2026-08-04T17:00:00.000Z",
    turns: [
      {
        id: "t1",
        role: "user",
        text: "unique-degraded-search-marker-zzzz",
        createdAt: "2026-08-04T17:00:00.000Z",
        parentId: null,
      },
    ],
    activeLeafId: "t1",
  });
  // Never start a daemon; point the hub at an address nothing listens on so
  // the canonical merge falls back to its local-only degraded path.
  await writeHubConfig("http://127.0.0.1:9");
  const token = await issue();
  const response = await GET(
    requestWith({
      bearer: token,
      url:
        "http://127.0.0.1/api/client/v1/conversations/search?q=" +
        encodeURIComponent("unique-degraded-search-marker-zzzz"),
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.degraded, true, "the client-v1 search response signals degraded state");
  assert.ok(
    body.hits.some((h: { sessionId: string }) => h.sessionId === "degraded-search-hit"),
    "a locally-visible hit still surfaces while degraded",
  );
  const raw = JSON.stringify(body);
  assert.equal(
    /ECONNREFUSED|127\.0\.0\.1:9\b|daemon http/i.test(raw),
    false,
    "no raw daemon error text crosses the client-v1 wire boundary",
  );
});

console.log("client/v1/conversations/search route.test.ts: ok");
