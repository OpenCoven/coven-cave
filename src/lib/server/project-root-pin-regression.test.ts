import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizeChatProjectLaunch } from "./chat-project-launch.ts";

test("launch refuses a retargeted registered root, including a target nested within the old pin", async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pin-red-")));
  try {
    const root = path.join(base, "root");
    const other = path.join(base, "other");
    fs.mkdirSync(root);
    fs.mkdirSync(other);
    const alias = path.join(base, "alias");
    fs.symlinkSync(root, alias);
    const deps = {
      validateProjectRoot: (value: string) => ({ ok: true as const, root: fs.realpathSync.native(value) }),
      resolveProjectId: () => "project",
      isProjectRegistered: () => true,
      hasProjectAccess: async () => true,
      projectRootPin: () => ({ name: "Project", pin: root, root: alias }),
    };
    const launch = () => authorizeChatProjectLaunch(deps, { familiarId: "milo", projectRoot: alias, surface: "chat" });
    assert.equal((await launch()).root, root);
    fs.unlinkSync(alias);
    fs.symlinkSync(other, alias);
    await assert.rejects(launch, { code: "project_root_moved", status: 409 });
    fs.mkdirSync(path.join(root, "child"));
    fs.unlinkSync(alias);
    fs.symlinkSync(path.join(root, "child"), alias);
    await assert.rejects(launch, { code: "project_root_moved", status: 409 });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("an existing unpinned project is refused without implicit adoption", async () => {
  await assert.rejects(() => authorizeChatProjectLaunch({
    validateProjectRoot: () => ({ ok: true, root: "/tmp" }),
    resolveProjectId: () => "legacy",
    isProjectRegistered: () => true,
    hasProjectAccess: async () => true,
    projectRootPin: () => ({ name: "Legacy", pin: null, root: "/tmp" }),
  }, { familiarId: "milo", projectRoot: "/tmp", surface: "chat" }), { code: "project_root_unconfirmed", status: 409 });
});

test("a pinned canonical cwd cannot change while permission admission awaits", async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pin-race-")));
  try {
    const root = path.join(base, "root");
    const other = path.join(base, "other");
    fs.mkdirSync(root);
    fs.mkdirSync(other);
    await assert.rejects(() => authorizeChatProjectLaunch({
      validateProjectRoot: () => ({ ok: true, root }),
      resolveProjectId: () => "project",
      isProjectRegistered: () => true,
      hasProjectAccess: async () => {
        fs.renameSync(root, root + "-original");
        fs.symlinkSync(other, root);
        return true;
      },
      projectRootPin: () => ({ name: "Project", pin: root, root }),
    }, { familiarId: "milo", projectRoot: root, surface: "chat" }), { code: "project_root_moved", status: 409 });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("forwarded grants stay pinned and the final spawn check rejects a late redirect", async () => {
  const { pinnedProjectRoot, assertPinnedLaunchRoot } = await import("./project-root-pin.ts");
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pin-forward-")));
  try {
    const root = path.join(base, "root");
    const other = path.join(base, "other");
    fs.mkdirSync(root);
    fs.mkdirSync(other);
    const project = { id: "p", name: "Project", root, rootRealpath: root };
    assert.equal(pinnedProjectRoot(project), root);
    assert.equal(pinnedProjectRoot({ ...project, rootRealpath: undefined }), null);
    assertPinnedLaunchRoot(project, root);
    fs.renameSync(root, root + "-original");
    fs.symlinkSync(other, root);
    assert.equal(pinnedProjectRoot(project), null, "a redirected secondary grant must not be forwarded");
    assert.throws(() => assertPinnedLaunchRoot(project, root), { code: "project_root_moved", status: 409 });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
