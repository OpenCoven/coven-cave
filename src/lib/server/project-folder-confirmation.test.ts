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
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
