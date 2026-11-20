// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "folder-human-")));
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(base, "projects.json");
const { createProject, loadProjects } = await import("../cave-projects.ts");
const { confirmProjectFolderWithHuman } = await import("./project-folder-confirmation.ts");
await test("native confirmation requires fresh Touch ID without device-owner fallback", () => {
  const native = fs.readFileSync(new URL("../../../native/confirm-project-folder.swift", import.meta.url), "utf8");
  assert.match(native, /LAPolicy\.deviceOwnerAuthenticationWithBiometrics\b/);
  assert.match(native, /touchIDAuthenticationAllowableReuseDuration\s*=\s*0/);
  assert.match(native, /localizedFallbackTitle\s*=\s*""/);
  assert.doesNotMatch(native, /LAPolicy\.deviceOwnerAuthentication\b/);
});
await test("the native helper's exit status maps to approved, declined or unavailable", async () => {
  const { authenticateProjectFolder } = await import("./native-folder-authentication.ts");
  const cwd = process.cwd();
  const cases = [["approved", 0, true], ["declined", 1, false], ["timed out", 3, false], ["no Touch ID", 2, "unavailable"], ["missing helper", null, "unavailable"]];
  try {
    for (const [label, exit, expected] of cases) {
      const dir = fs.mkdtempSync(path.join(base, "helper-"));
      if (exit !== null) {
        fs.mkdirSync(path.join(dir, "native"));
        fs.writeFileSync(path.join(dir, "native", "confirm-project-folder"), `#!/bin/sh\nexit ${exit}\n`, { mode: 0o755 });
      }
      process.chdir(dir);
      const result = await authenticateProjectFolder("Confirm Project’s project folder");
      assert.equal(result, process.platform === "darwin" ? expected : "unavailable", label);
    }
  } finally {
    process.chdir(cwd);
  }
});
try {
  const root = path.join(base, "project");
  const other = path.join(base, "other");
  fs.mkdirSync(root);
  fs.mkdirSync(other);
  const created = await createProject({ name: "Project", root });
  const file = JSON.parse(fs.readFileSync(process.env.CAVE_PROJECTS_PATH_OVERRIDE, "utf8"));
  delete file.projects[0].rootRealpath;
  fs.writeFileSync(process.env.CAVE_PROJECTS_PATH_OVERRIDE, JSON.stringify(file));
  await test("a familiar request cannot confirm without native human authentication", async () => {
    const response = await confirmProjectFolderWithHuman(created.id, { authenticate: async () => false });
    assert.equal(response.ok, false);
    assert.equal(response.code, "project_folder_authentication_required");
    assert.equal((await loadProjects())[0].rootRealpath, undefined);
  });
  await test("a root snapshot failure is structured and happens before authentication", async () => {
    let authenticated = false;
    const response = await confirmProjectFolderWithHuman(created.id, {
      authenticate: async () => {
        authenticated = true;
        return true;
      },
      realpath: () => { throw new Error("folder moved"); },
    });
    assert.equal(response.ok, false);
    assert.equal(response.code, "project_root_unavailable");
    assert.equal(response.status, 400);
    assert.equal(authenticated, false);
  });
  await test("authentication is bound to the folder and cannot approve a concurrent redirect", async () => {
    const response = await confirmProjectFolderWithHuman(created.id, { authenticate: async (reason) => {
      assert.ok(reason.includes("Project"));
      assert.ok(reason.includes(root));
      fs.renameSync(root, root + "-original");
      fs.symlinkSync(other, root);
      return true;
    } });
    assert.equal(response.ok, false);
    assert.equal(response.code, "project_root_moved");
    assert.equal((await loadProjects())[0].rootRealpath, undefined);
  });
  await test("one native authentication confirms exactly the displayed folder", async () => {
    let prompts = 0;
    const response = await confirmProjectFolderWithHuman(created.id, { authenticate: async (reason) => {
      prompts++;
      assert.ok(reason.includes(other));
      return true;
    } });
    assert.equal(response.ok, true);
    assert.equal(prompts, 1);
    assert.equal(response.project.root, root);
    assert.equal(response.project.rootRealpath, other);
  });
  await test("a device without Touch ID is told confirmation is unavailable, not to retry", async () => {
    const before = (await loadProjects())[0].rootRealpath;
    const response = await confirmProjectFolderWithHuman(created.id, { authenticate: async () => "unavailable" });
    assert.equal(response.ok, false);
    assert.equal(response.status, 409);
    assert.equal(response.code, "project_folder_authentication_unavailable");
    assert.doesNotMatch(response.error, /then retry/);
    assert.equal((await loadProjects())[0].rootRealpath, before);
  });
  for (const [label, target] of [["the home folder", os.homedir()], ["a volume root", path.parse(base).root]]) {
    await test(`a root retargeted to ${label} cannot be confirmed, before any prompt`, async () => {
      const unbounded = path.join(base, `unbounded-${label.replace(/\W+/g, "-")}`);
      fs.mkdirSync(unbounded);
      const project = await createProject({ name: "Unbounded", root: unbounded });
      fs.rmSync(unbounded, { recursive: true });
      fs.symlinkSync(target, unbounded);
      let prompts = 0;
      const response = await confirmProjectFolderWithHuman(project.id, { authenticate: async () => { prompts++; return true; } });
      assert.equal(response.ok, false);
      assert.equal(response.status, 403);
      assert.equal(response.code, "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE");
      assert.equal(prompts, 0);
      assert.equal((await loadProjects()).find((entry) => entry.id === project.id).rootRealpath, project.rootRealpath, "the registration pin is unchanged");
    });
  }
  await test("a retarget to the home folder during authentication is refused under the lock", async () => {
    const moving = path.join(base, "moving");
    fs.mkdirSync(moving);
    const project = await createProject({ name: "Moving", root: moving });
    const pinned = (await loadProjects()).find((entry) => entry.id === project.id).rootRealpath;
    const response = await confirmProjectFolderWithHuman(project.id, { authenticate: async () => {
      fs.rmSync(moving, { recursive: true });
      fs.symlinkSync(os.homedir(), moving);
      return true;
    } });
    assert.equal(response.ok, false);
    assert.equal(response.code, "project_root_moved");
    assert.equal((await loadProjects()).find((entry) => entry.id === project.id).rootRealpath, pinned);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
