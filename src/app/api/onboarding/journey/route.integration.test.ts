import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFirstUseState } from "@/lib/first-use";

test("the real journey route persists practice, revalidates revoked access and refuses relayed changes", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cave-journey-route-")));
  const previous = { COVEN_HOME: process.env.COVEN_HOME, COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME, COVEN_SOCKET: process.env.COVEN_SOCKET };
  process.env.COVEN_HOME = root;
  process.env.COVEN_CAVE_HOME = path.join(root, "cave");
  process.env.COVEN_SOCKET = path.join(root, "daemon.sock");
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify([{ id: "nova", display_name: "Nova", role: "Familiar" }])); });
  await new Promise<void>((resolve) => server.listen(process.env.COVEN_SOCKET!, resolve));
  try {
    await writeFile(path.join(root, "familiars.toml"), '[[familiar]]\nid = "nova"\ndisplay_name = "Nova"\n');
    const { GET, POST } = await import("./route.ts");
    await mkdir(path.join(root, "cave"), { recursive: true });
    await writeFile(path.join(root, "cave", "first-use.json"), JSON.stringify(createFirstUseState()));
    const { createProject, loadProjects } = await import("@/lib/cave-projects");
    const { grantProjectToFamiliar, revokeProjectFromFamiliar, listProjectGrants } = await import("@/lib/project-permissions");
    const projectRoot = path.join(root, "project");
    await mkdir(projectRoot);
    const project = await createProject({ name: "Synthetic", root: projectRoot });
    const req = (body: unknown, host = "localhost") => new Request(`http://${host}/api/onboarding/journey`, {
      method: "POST", headers: { host, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const get = () => GET(new Request("http://localhost/api/onboarding/journey", { headers: { host: "localhost" } }));
    const fresh = await (await get()).json();
    assert.equal(fresh.state.completedAt, null);
    assert.equal(fresh.resolution.kind, "repair");
    const projectsBeforeStarter = await loadProjects();
    const starter = await POST(req({ kind: "starter" }));
    assert.equal(starter.status, 200);
    assert.deepEqual(await starter.json(), { ok: true, name: "Cave starter", root: path.join(root, "workspaces", "cave-starter") });
    assert.deepEqual(await loadProjects(), projectsBeforeStarter, "creating the folder does not register or select it");
    assert.deepEqual(await listProjectGrants(), [], "creating the folder grants no access");
    assert.equal((await POST(req({ kind: "starter" }))).status, 200, "retry reuses the dedicated folder");
    assert.equal((await (await get()).json()).state.revision, 0);
    assert.equal((await POST(req({ revision: 0, action: { kind: "outcome", outcome: "plan" } }, "phone.example"))).status, 403);
    assert.equal((await POST(req({ revision: 0, familiarId: "nova", action: { kind: "outcome", outcome: "plan" } }))).status, 403);
    let response = await POST(req({ revision: 0, action: { kind: "outcome", outcome: "plan" } }));
    assert.equal(response.status, 200, await response.clone().text());
    const defaults = { projectId: project.id, familiarIds: ["nova"], actingFamiliarId: "nova" };
    response = await POST(req({ revision: 1, action: { kind: "context", defaults } }));
    assert.equal(response.status, 409, "project selection must never create its missing grant");
    await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "read" });
    response = await POST(req({ revision: 1, action: { kind: "context", defaults } }));
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await (await get()).json();
    assert.equal(saved.state.step, "access");
    assert.equal(saved.resolution.kind, "ready");
    assert.equal(saved.access[0].level, "read");
    assert.equal((await POST(req({ revision: 2, action: { kind: "review-access", permissionMode: "full" } }))).status, 409, "the access review cannot save Build against a Read actor");
    assert.equal((await POST(req({ revision: 1, action: { kind: "review-access" } }))).status, 409);
    await revokeProjectFromFamiliar({ familiarId: "nova", projectId: project.id });
    const revoked = await (await get()).json();
    assert.equal(revoked.resolution.kind, "repair");
    assert.deepEqual(revoked.state.defaults, defaults);
    assert.equal((await POST(req({ revision: 2, action: { kind: "review-access" } }))).status, 409);
    const disk = JSON.parse(await readFile(path.join(root, "cave", "first-use.json"), "utf8"));
    assert.equal(disk.revision, 2);
    assert.equal(disk.completedAt, null);
    await grantProjectToFamiliar({ familiarId: "nova", projectId: project.id, source: "human", access: "read" });
    for (const [revision, action] of [
      [2, { kind: "review-access" }], [3, { kind: "hold-approval" }], [4, { kind: "approve" }],
      [5, { kind: "stop" }], [6, { kind: "retry" }], [7, { kind: "verify", evidence: "result-and-check" }],
    ] as const) {
      const result = await POST(req({ revision, action }));
      assert.equal(result.status, 200, await result.clone().text());
    }
    const completed = await (await get()).json();
    assert.equal(completed.state.step, "complete");
    assert.equal(completed.state.permissionMode, "read", "the reviewed mode is durable across browser origins");
    assert.ok(completed.state.completedAt);
    assert.deepEqual(completed.state.defaults, defaults);
    assert.equal((await listProjectGrants())[0]?.access, "read", "the practice changes no grant");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
