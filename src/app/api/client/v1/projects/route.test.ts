// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import crypto from "node:crypto";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-projects-"));
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

function requestWith(opts: { marker?: string | null; bearer?: string | null; url?: string } = {}) {
  const headers = new Headers();
  if (opts.marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, opts.marker ?? LOCAL_PEER_SECRET);
  if (opts.bearer !== undefined && opts.bearer !== null) headers.set("authorization", `Bearer ${opts.bearer}`);
  return new Request(opts.url ?? "http://127.0.0.1/api/client/v1/projects", { headers });
}

async function issue(scopes: readonly string[] = ["chat:read"]) {
  const { token } = await issueCredential({
    appName: "OpenCoven Chat",
    installationId: crypto.randomUUID(),
    scopes: [...scopes],
  });
  return token;
}

async function writeProjects() {
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "proj-a", name: "A", root: "/tmp/proj-a", createdAt: "now", updatedAt: "now" },
        { id: "proj-b", name: "B", root: "/tmp/proj-b", createdAt: "now", updatedAt: "now" },
      ],
      visibilityGeneration: "projects-route-list",
    }),
  );
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

test("with no familiarId, every registered project is returned unscoped (access: null)", async () => {
  resetRateLimitsForTest();
  await writeProjects();
  const token = await issue();
  const response = await GET(requestWith({ bearer: token }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(
    body.projects.map((p: { id: string; access: unknown }) => [p.id, p.access]).sort(),
    [
      ["proj-a", null],
      ["proj-b", null],
    ],
  );
});

test("an invalid familiarId query is rejected with 400 invalid_request", async () => {
  resetRateLimitsForTest();
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/projects?familiarId=" + encodeURIComponent("../nope") }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("with a familiarId, only granted projects are returned, annotated with access level", async () => {
  resetRateLimitsForTest();
  await writeProjects();
  const grantedRoot = path.join(workdir, "proj-a-root");
  await mkdir(grantedRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [
        { id: "proj-a", name: "A", root: grantedRoot, createdAt: "now", updatedAt: "now" },
        { id: "proj-b", name: "B", root: "/tmp/proj-b", createdAt: "now", updatedAt: "now" },
      ],
      visibilityGeneration: "projects-route-granted",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "granted-fam", projectId: "proj-a", source: "human", access: "write" });
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/projects?familiarId=granted-fam" }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.projects, [
    { id: "proj-a", name: "A", root: grantedRoot, access: "write", repoUrl: null },
  ]);
});

// Reuses the SAME `validateCaveProjectRoot` launchability check `/api/projects`
// applies to its own `familiarId`-scoped result — an accessible (granted)
// project whose root no longer resolves to a real directory on this host
// must be excluded here too, not just hidden from the canonical route.
test("an accessible project whose root is not launchable (missing directory) is excluded", async () => {
  resetRateLimitsForTest();
  const missingRoot = path.join(workdir, "does-not-exist-root");
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-missing", name: "Missing", root: missingRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "projects-route-missing",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "missing-root-fam", projectId: "proj-missing", source: "human", access: "write" });
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/projects?familiarId=missing-root-fam" }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.projects, [], "a familiar-scoped project with a nonexistent root must never be exposed");
});

// The mirror of the exclusion test above: an accessible project whose root
// DOES resolve to a real directory is still included, so the launchability
// filter only removes non-launchable roots — it does not over-filter.
test("an accessible project with a valid, existing root is included", async () => {
  resetRateLimitsForTest();
  const validRoot = path.join(workdir, "valid-root");
  await mkdir(validRoot, { recursive: true });
  await writeFile(
    process.env.CAVE_PROJECTS_PATH_OVERRIDE!,
    JSON.stringify({
      version: 1,
      projects: [{ id: "proj-valid", name: "Valid", root: validRoot, createdAt: "now", updatedAt: "now" }],
      visibilityGeneration: "projects-route-valid",
    }),
  );
  await grantProjectToFamiliar({ familiarId: "valid-root-fam", projectId: "proj-valid", source: "human", access: "read" });
  const token = await issue();
  const response = await GET(
    requestWith({ bearer: token, url: "http://127.0.0.1/api/client/v1/projects?familiarId=valid-root-fam" }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.projects, [
    { id: "proj-valid", name: "Valid", root: validRoot, access: "read", repoUrl: null },
  ]);
});

console.log("client/v1/projects route.test.ts: ok");
