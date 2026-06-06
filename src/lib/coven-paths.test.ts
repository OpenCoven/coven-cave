// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFamiliarWorkspaces } from "./coven-paths.ts";

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

const daemonStatus = await readFile("src/app/api/daemon/status/route.ts", "utf8");
assert.match(daemonStatus, /covenWorkspaceRoot/);
assert.doesNotMatch(daemonStatus, /\.openclaw/);

const projectPaths = await readFile("src/lib/server/project-paths.ts", "utf8");
assert.match(projectPaths, /covenWorkspaceRoot/);
assert.doesNotMatch(projectPaths, /\.openclaw/);

const localSkills = await readFile("src/app/api/skills/local/route.ts", "utf8");
assert.ok(localSkills.includes('path.join(covenHome(), "skills")'));
assert.match(localSkills, /familiarWorkspace/);
assert.doesNotMatch(localSkills, /\.openclaw/);

const roles = await readFile("src/app/api/roles/route.ts", "utf8");
assert.match(roles, /familiarWorkspace/);
assert.ok(roles.includes('path.join(covenHome(), "roles")'));
assert.doesNotMatch(roles, /\.openclaw/);

const chatSend = await readFile("src/app/api/chat/send/route.ts", "utf8");
assert.match(chatSend, /familiarWorkspace/);
assert.match(chatSend, /Coven workspace dir/);
assert.doesNotMatch(chatSend, /\.openclaw\/workspace/);
