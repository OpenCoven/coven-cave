// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Real POST /api/projects and PUT /api/projects/[id] requests against a scratch
// registry: only a person's registration, root change, or confirm-folder action
// sets a project's folder pin (#6215).
const base = fs.realpathSync(await mkdtemp(path.join(tmpdir(), "cave-project-pin-")));
const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  CAVE_PROJECTS_PATH_OVERRIDE: process.env.CAVE_PROJECTS_PATH_OVERRIDE,
};
process.env.COVEN_HOME = path.join(base, "coven");
process.env.COVEN_CAVE_HOME = path.join(base, "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(base, "projects.json");

try {
  const { loadProjects } = await import("@/lib/cave-projects");
  const { POST } = await import("./route.ts");
  const { PUT } = await import("./[id]/route.ts");

  const real = path.join(base, "real");
  const project = path.join(real, "app");
  const elsewhere = path.join(base, "elsewhere");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(real, path.join(base, "alias"));

  const request = (url, method, body, headers = {}) =>
    new Request(url, {
      method,
      headers: { "content-type": "application/json", host: "localhost", ...headers },
      body: JSON.stringify(body),
    });
  const register = (body) => POST(request("http://localhost/api/projects", "POST", body));
  const put = (id, body, headers) =>
    PUT(request(`http://localhost/api/projects/${id}`, "PUT", body, headers), {
      params: Promise.resolve({ id }),
    });
  const stored = async (id) => (await loadProjects()).find((entry) => entry.id === id);

  await test("registering through an alias pins the folder it resolves to", async () => {
    const response = await register({ name: "App", root: path.join(base, "alias", "app") });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const { project: created } = await response.json();
    assert.equal(created.root, project);
    assert.equal(created.rootRealpath, fs.realpathSync.native(project));
    assert.equal((await stored(created.id)).rootRealpath, fs.realpathSync.native(project));
  });

  await test("a legacy record is confirmed once, and re-confirming follows a deliberate move", async () => {
    const legacyRoot = path.join(base, "legacy");
    fs.mkdirSync(legacyRoot);
    const { project: created } = await (await register({ name: "Legacy", root: legacyRoot })).json();
    // A record written before pinning has no rootRealpath.
    const file = JSON.parse(fs.readFileSync(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"));
    for (const entry of file.projects) if (entry.id === created.id) delete entry.rootRealpath;
    await writeFile(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify(file, null, 2));
    assert.equal((await stored(created.id)).rootRealpath, undefined);

    const confirmed = await put(created.id, { confirmRoot: true });
    assert.equal(confirmed.status, 200, JSON.stringify(await confirmed.clone().json()));
    assert.equal((await confirmed.json()).project.rootRealpath, fs.realpathSync.native(legacyRoot));

    fs.renameSync(legacyRoot, path.join(base, "legacy-original"));
    fs.symlinkSync(elsewhere, legacyRoot);
    assert.equal(
      (await stored(created.id)).rootRealpath,
      path.join(base, "legacy"),
      "swapping the folder never moves the pin by itself",
    );
    const reconfirmed = await put(created.id, { confirmRoot: true });
    assert.equal(reconfirmed.status, 200);
    const { project: repinned } = await reconfirmed.json();
    assert.equal(repinned.rootRealpath, fs.realpathSync.native(elsewhere));
    assert.equal(repinned.root, legacyRoot, "confirming never rewrites the root key");
  });

  await test("a root change moves the pin with it", async () => {
    const source = path.join(base, "mover");
    fs.mkdirSync(source);
    const { project: created } = await (await register({ name: "Mover", root: source })).json();
    const moved = path.join(base, "moved");
    fs.mkdirSync(moved);
    const response = await put(created.id, { root: moved });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).project.rootRealpath, fs.realpathSync.native(moved));
  });

  await test("confirming a missing folder fails and keeps the previous pin", async () => {
    const gone = path.join(base, "gone");
    fs.mkdirSync(gone);
    const { project: created } = await (await register({ name: "Gone", root: gone })).json();
    fs.rmdirSync(gone);
    const response = await put(created.id, { confirmRoot: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "root does not exist");
    assert.equal((await stored(created.id)).rootRealpath, created.rootRealpath);
  });

  await test("confirming stands alone, needs a known project, and stays local-only", async () => {
    const solo = path.join(base, "solo");
    fs.mkdirSync(solo);
    const { project: created } = await (await register({ name: "Solo", root: solo })).json();
    const combined = await put(created.id, { confirmRoot: true, name: "Renamed" });
    assert.equal(combined.status, 400);
    assert.equal((await stored(created.id)).name, "Solo", "a combined request changes nothing");

    assert.equal((await put("missing", { confirmRoot: true })).status, 404);

    const remote = await put(created.id, { confirmRoot: true }, { origin: "https://example.com" });
    assert.equal(remote.status, 403, "a non-local caller cannot confirm a folder");
  });

  await test("a pin in the request body is never taken from the caller", async () => {
    const spoof = path.join(base, "spoof");
    fs.mkdirSync(spoof);
    const { project: created } = await (await register({
      name: "Spoof",
      root: spoof,
      rootRealpath: elsewhere,
    })).json();
    assert.equal(created.rootRealpath, fs.realpathSync.native(spoof));
    const response = await put(created.id, { name: "Spoofed", rootRealpath: elsewhere });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).project.rootRealpath, fs.realpathSync.native(spoof));
  });
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(base, { recursive: true, force: true });
}
