// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import crypto from "node:crypto";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

// Every module this route (and its transitive imports) touches resolves its
// on-disk paths from these env vars at MODULE-LOAD time in some cases
// (cave-config.ts's top-level `CONFIG_PATH`), so they must be set BEFORE the
// very first import below — see read-model.test.ts for the same caveat.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-familiars-"));
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
const { grantProjectToFamiliar } = await import("@/lib/project-permissions.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

let stopDaemon = async () => {};

async function startDaemon(familiars: unknown[]) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/familiars") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(familiars));
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
  return new Request(opts.url ?? "http://127.0.0.1/api/client/v1/familiars", { headers });
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
  const { token } = await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

test("an absent internal marker returns 403 unauthorized before any bearer/roster work", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith({ marker: null }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "unauthorized");
});

test("a verified marker with no bearer token returns 401 unauthorized", async () => {
  resetRateLimitsForTest();
  const response = await GET(requestWith());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "unauthorized");
});

test("a credential missing the chat:read scope is denied with 403 scope_denied", async () => {
  resetRateLimitsForTest();
  const token = await issue(["chat:write"]);
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "scope_denied");
});

test("an unauthenticated caller never reaches the roster/daemon at all", async () => {
  resetRateLimitsForTest();
  // No daemon started, no COVEN_HOME config written — if auth were skipped,
  // this would blow up with an unrelated connection/config error instead of
  // the expected clean 401/403.
  const noMarker = await GET(requestWith({ marker: null }));
  assert.equal(noMarker.status, 403);
  const noBearer = await GET(requestWith());
  assert.equal(noBearer.status, 401);
});

test("a valid credential returns the stable, standalone-chat-safe familiar roster", async () => {
  resetRateLimitsForTest();
  const daemonUrl = await startDaemon([
    { id: "charm", display_name: "Charm", role: "Companion", pronouns: "she/her", status: "online", emoji: "🔥" },
  ]);
  await writeHubConfig(daemonUrl);
  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.familiars, [
    {
      id: "charm",
      displayName: "Charm",
      role: "Companion",
      description: null,
      pronouns: "she/her",
      status: "online",
      emoji: "🔥",
    },
  ]);
  await stopDaemon();
});

test("an invalid projectId query is rejected with 400 invalid_request before touching the roster", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/familiars?projectId=" + encodeURIComponent("../nope") }),
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
});

test("projectId narrows the roster to familiars granted access to that project", async () => {
  resetRateLimitsForTest();
  const daemonUrl = await startDaemon([
    { id: "granted-fam", display_name: "Granted", role: "Companion" },
    { id: "ungranted-fam", display_name: "Ungranted", role: "Companion" },
  ]);
  await writeHubConfig(daemonUrl);
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-a", name: "A", root: "/tmp/proj-a", createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "familiars-route-project",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "granted-fam", projectId: "proj-a", source: "human" });
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/familiars?projectId=proj-a" }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(
    body.familiars.map((f: { id: string }) => f.id),
    ["granted-fam"],
  );
  await stopDaemon();
});

test("an uncaught config-load exception (e.g. config.json unreadable as a file) is translated to a generic service_unavailable envelope, never a raw exception message/path", async () => {
  resetRateLimitsForTest();
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
    /EISDIR|config\.json|\.test-tmp|client-v1-familiars-/,
    "no raw fs error/path ever crosses the client-v1 wire boundary",
  );

  await rm(configPath, { recursive: true, force: true });
});

console.log("client/v1/familiars route.test.ts: ok");
