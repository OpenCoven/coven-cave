// Real /api/project-grants behavior for the grant and Undo that Chat's access
// actions send (#6445), against isolated Cave/Coven homes and a controlled
// daemon roster. Pins: only a local-origin (or opted-in phone) request may
// change a grant; every change is logged with the verified actor; Undo
// restores exactly; and forged, malformed or stale requests change nothing.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testRoot = await mkdtemp(path.join(tmpdir(), "grants-chat-"));
const covenHome = path.join(testRoot, "coven");
const caveHomeDir = path.join(testRoot, "cave");
const socketPath = path.join(testRoot, "coven.sock");
const ENV_KEYS = [
  "CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE",
  "CAVE_PROJECTS_PATH_OVERRIDE",
  "COVEN_HOME",
  "COVEN_CAVE_HOME",
  "COVEN_SOCKET",
  "COVEN_CAVE_AUTH_TOKEN",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

await mkdir(covenHome, { recursive: true });
await mkdir(caveHomeDir, { recursive: true });
await mkdir(path.join(testRoot, "proj"), { recursive: true });
process.env.CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE = path.join(testRoot, "permissions.json");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(testRoot, "projects.json");
process.env.COVEN_HOME = covenHome;
process.env.COVEN_CAVE_HOME = caveHomeDir;
process.env.COVEN_SOCKET = socketPath;
delete process.env.COVEN_CAVE_AUTH_TOKEN;
await writeFile(
  path.join(covenHome, "familiars.toml"),
  '[[familiar]]\nid = "nova"\ndisplay_name = "Nova"\nemoji = "*"\nrole = "Builder"\ndescription = "test"\nworkspace = "/tmp"\nicon = "ph:sparkle"\n',
);

const daemonServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/v1/familiars") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ id: "nova", display_name: "Nova" }]));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise<void>((resolve, reject) => {
  daemonServer.once("error", reject);
  daemonServer.listen(socketPath, () => {
    daemonServer.off("error", reject);
    resolve();
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    daemonServer.close(() => resolve());
    daemonServer.closeAllConnections();
  });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(testRoot, { recursive: true, force: true });
});

const { GET, POST, DELETE } = await import("./route.ts");
const { MOBILE_ACCESS_HEADER } = await import("../../../proxy-helpers.ts");
const { createProject } = await import("../../../lib/cave-projects.ts");
const { grantProjectToFamiliar, revokeProjectFromFamiliar } = await import("../../../lib/project-permissions.ts");
const project = await createProject({ name: "Scratch", root: path.join(testRoot, "proj") });

type Body = Record<string, unknown>;
const LOCAL = { host: "127.0.0.1:3000" };

function request(method: "POST" | "DELETE", body: Body, headers: Record<string, string> = LOCAL): Request {
  return new Request("http://127.0.0.1:3000/api/project-grants", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function state() {
  const json = await (await GET()).json();
  const grant = json.grants.find((entry: Body) => entry.familiarId === "nova" && entry.projectId === project.id);
  return { access: (grant?.access as string | undefined) ?? null, changes: json.grantChanges as Body[] };
}

async function reset(access: "read" | "write" | null) {
  if (access) await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access });
  else await revokeProjectFromFamiliar({ familiarId: "nova", projectId: project.id });
}

const target = () => ({ targetFamiliarId: "nova", projectId: project.id });

/** The newest log entry for this familiar and project (the list is newest first), without its id and time. */
function lastChange(changes: Body[]) {
  const latest = changes.find((entry) => entry.familiarId === "nova" && entry.projectId === project.id);
  if (!latest) return null;
  const { from, to, actor, kind } = latest;
  return { from, to, actor, kind };
}

test("Chat's grant from a local origin is applied and logged as a human desktop change", async () => {
  await reset("read");
  const before = (await state()).changes.length;
  const res = await POST(request("POST", { ...target(), access: "write", expectedAccess: "read" }));
  assert.equal(res.status, 200);
  const after = await state();
  assert.equal(after.access, "write");
  assert.equal(after.changes.length, before + 1, "exactly one logged change");
  assert.deepEqual(lastChange(after.changes), { from: "read", to: "write", actor: "loopback", kind: "direct" });
});

test("Undo restores the previous grant, or revokes when there was none, and logs each step", async () => {
  await reset("write");
  let res = await POST(request("POST", { ...target(), access: "read", expectedAccess: "write" }));
  assert.equal(res.status, 200);
  let now = await state();
  assert.equal(now.access, "read");
  assert.deepEqual(lastChange(now.changes), { from: "write", to: "read", actor: "loopback", kind: "direct" });

  await reset("write");
  res = await DELETE(request("DELETE", { ...target(), expectedAccess: "write" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).revoked, true);
  now = await state();
  assert.equal(now.access, null);
  assert.deepEqual(lastChange(now.changes), { from: "write", to: null, actor: "loopback", kind: "direct" });
});

test("a request that isn't from the local desktop changes nothing", async () => {
  await reset("read");
  const before = await state();
  const untrusted: Array<Record<string, string>> = [
    { host: "cave.example.com" },
    { host: "192.168.1.20:3000" },
    // The paired phone without the desktop opt-in is refused too.
    { host: "127.0.0.1:3000", [MOBILE_ACCESS_HEADER]: "1" },
  ];
  for (const headers of untrusted) {
    const res = await POST(request("POST", { ...target(), access: "write", expectedAccess: "read" }, headers));
    assert.equal(res.status, 403, JSON.stringify(headers));
    const del = await DELETE(request("DELETE", { ...target(), expectedAccess: "read" }, headers));
    assert.equal(del.status, 403, JSON.stringify(headers));
  }
  const after = await state();
  assert.equal(after.access, "read");
  assert.equal(after.changes.length, before.changes.length, "nothing logged");
});

test("relayed approval fields are refused even from the local desktop", async () => {
  await reset("read");
  const before = await state();
  for (const forged of [{ familiarId: "nova" }, { proposedBy: "nova" }, { claimedHumanApproval: true }]) {
    const res = await POST(request("POST", { ...target(), access: "write", ...forged }));
    assert.equal(res.status, 403, JSON.stringify(forged));
    const del = await DELETE(request("DELETE", { ...target(), ...forged }));
    assert.equal(del.status, 403, JSON.stringify(forged));
  }
  const after = await state();
  assert.equal(after.access, "read");
  assert.equal(after.changes.length, before.changes.length);
});

test("a stale grant or Undo is refused whole when the grant changed after it was shown", async () => {
  // Chat saw "read", but the grant is already "write": the grant is refused.
  await reset("write");
  const before = await state();
  let res = await POST(request("POST", { ...target(), access: "write", expectedAccess: "read" }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, "grant_changed");
  assert.equal(body.current, "write");

  // Undo of a write grant after someone lowered it to read: refused, read stays.
  await reset("read");
  const lowered = await state();
  res = await POST(request("POST", { ...target(), access: "read", expectedAccess: "write" }));
  assert.equal(res.status, 409);
  res = await DELETE(request("DELETE", { ...target(), expectedAccess: "write" }));
  assert.equal(res.status, 409);
  const after = await state();
  assert.equal(after.access, "read");
  assert.equal(after.changes.length, lowered.changes.length, "a refused change is not logged");
  assert.ok(lowered.changes.length >= before.changes.length);

  // Revoked elsewhere: Undo expecting "write" is refused rather than recreating anything.
  await reset(null);
  res = await DELETE(request("DELETE", { ...target(), expectedAccess: "write" }));
  assert.equal(res.status, 409);
  assert.equal((await state()).access, null);
});

test("malformed preconditions and unknown targets are refused before any change", async () => {
  await reset("read");
  const before = await state();
  for (const expectedAccess of ["admin", 1, false, "", {}]) {
    const res = await POST(request("POST", { ...target(), access: "write", expectedAccess }));
    assert.equal(res.status, 400, JSON.stringify(expectedAccess));
    const del = await DELETE(request("DELETE", { ...target(), expectedAccess }));
    assert.equal(del.status, 400, JSON.stringify(expectedAccess));
  }
  let res = await POST(request("POST", { targetFamiliarId: "nova", projectId: "no-such-project", access: "write", expectedAccess: null }));
  assert.equal(res.status, 404, "a project removed since it was shown");
  res = await POST(request("POST", { targetFamiliarId: "ghost", projectId: project.id, access: "write", expectedAccess: null }));
  assert.equal(res.status, 404, "a familiar removed since it was shown");
  const after = await state();
  assert.equal(after.access, "read");
  assert.equal(after.changes.length, before.changes.length);
});

test("requests without a precondition keep today's behavior", async () => {
  await reset("read");
  const res = await POST(request("POST", { ...target(), access: "write" }));
  assert.equal(res.status, 200);
  assert.equal((await state()).access, "write");
});
