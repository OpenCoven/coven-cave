// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  covenWorkspaceRoot,
  covenWorkspacesRoot,
  familiarWorkspace,
  familiarWorkspacesRoot,
  parseFamiliarWorkspaces,
} from "./coven-paths.ts";

const originalEnv = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_WORKSPACES_ROOT: process.env.COVEN_WORKSPACES_ROOT,
  COVEN_WORKSPACE_ROOT: process.env.COVEN_WORKSPACE_ROOT,
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
  NEXT_PUBLIC_WORKSPACE_ROOT: process.env.NEXT_PUBLIC_WORKSPACE_ROOT,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const workspaces = parseFamiliarWorkspaces(`
[[familiar]]
id = "sage"
workspace = "~/coven/sage"

[[familiar]]
id = 'cody'
workspace = '/tmp/coven-cody' # trailing comment

[[familiar]]
id = "echo"
`);

assert.equal(workspaces.get("sage"), path.join(process.env.HOME ?? "", "coven", "sage"));
assert.equal(workspaces.get("cody"), "/tmp/coven-cody");
assert.equal(workspaces.has("echo"), false);

try {
  process.env.COVEN_HOME = "/tmp/coven-home";
  delete process.env.COVEN_WORKSPACES_ROOT;
  delete process.env.COVEN_WORKSPACE_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.NEXT_PUBLIC_WORKSPACE_ROOT;

  assert.equal(covenWorkspacesRoot(), "/tmp/coven-home/workspaces");
  assert.equal(covenWorkspaceRoot(), "/tmp/coven-home/workspaces");
  assert.equal(familiarWorkspacesRoot(), "/tmp/coven-home/workspaces/familiars");
  assert.equal(await familiarWorkspace("nova"), "/tmp/coven-home/workspaces/familiars/nova");

  process.env.COVEN_WORKSPACES_ROOT = "/tmp/coven-workspaces";
  assert.equal(covenWorkspacesRoot(), "/tmp/coven-workspaces");
  assert.equal(covenWorkspaceRoot(), "/tmp/coven-workspaces");
  assert.equal(await familiarWorkspace("kitty"), "/tmp/coven-workspaces/familiars/kitty");

  process.env.COVEN_WORKSPACE_ROOT = "/tmp/explicit-workspace-root";
  assert.equal(covenWorkspaceRoot(), "/tmp/explicit-workspace-root");
} finally {
  restoreEnv();
}

const daemonStatus = await readFile("src/app/api/daemon/status/route.ts", "utf8");
assert.match(daemonStatus, /covenWorkspaceRoot/);
assert.doesNotMatch(daemonStatus, /\.openclaw/);

const projectPaths = await readFile("src/lib/server/project-paths.ts", "utf8");
assert.match(projectPaths, /covenWorkspaceRoot/);
// project-paths.ts intentionally retains ~/.openclaw/workspace as an allowed
// root so Library can read pre-Coven research dirs. The original migration
// invariant ("no openclaw paths") was relaxed for this single case.

const localSkills = await readFile("src/app/api/skills/local/route.ts", "utf8");
assert.ok(localSkills.includes('path.join(covenHome(), "skills")'));
assert.match(localSkills, /familiarWorkspace/);
assert.doesNotMatch(localSkills, /\.openclaw/);

const roles = await readFile("src/app/api/roles/route.ts", "utf8");
assert.doesNotMatch(roles, /\.openclaw/);

const roleSource = await readFile("src/lib/role-source.ts", "utf8");
assert.match(roleSource, /familiarWorkspace/);
assert.ok(roleSource.includes('path.join(covenHome(), "roles")'));
assert.doesNotMatch(roleSource, /\.openclaw/);

const chatSend = await readFile("src/app/api/chat/send/route.ts", "utf8");
assert.match(chatSend, /familiarWorkspace/);
assert.match(chatSend, /Coven workspace dir/);
assert.doesNotMatch(chatSend, /\.openclaw\/workspace/);
