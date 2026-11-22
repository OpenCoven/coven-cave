// @ts-nocheck
// A read-only project grant bounds Build on every local harness, not only on
// Claude's scoped write (#6445). Before this, a Codex Build turn on a project
// the familiar could only read launched anyway, and with Codex's own
// sandbox_mode set to workspace-write it wrote into that project. This drives
// the real send route with a recording `coven` on PATH: Build on a read-only
// project is refused before any launch, while Explore there and Build on a
// writable project still launch. Cave never adds a wider sandbox (#3297).
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-route-read-admit-"));
const bin = path.join(home, "bin");
const readRoot = path.join(home, "read-project");
const writeRoot = path.join(home, "write-project");
const log = path.join(home, "calls.jsonl");
for (const dir of [bin, readRoot, writeRoot]) await mkdir(dir, { recursive: true });
Object.assign(process.env, {
  HOME: home, COVEN_HOME: path.join(home, "coven"), COVEN_CAVE_HOME: path.join(home, "cave"),
  PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, SHELL: path.join(home, "no-shell"),
});
if (process.platform === "win32") { process.env.USERPROFILE = home; delete process.env.Path; }
delete process.env.COVEN_SOCKET;
const script = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('coven 0.4.10'); process.exit(0); }
if (args.includes('--help')) { console.log('--model --permission --add-dir --output-format stream-json'); process.exit(0); }
if (args[0] === 'adapter' && args[1] === 'list') { console.log(JSON.stringify([{id:'codex',executable:'codex',available:true}])); process.exit(0); }
if (args[0] === 'adapter') { console.log('[]'); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({argv:args,cwd:process.cwd()})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'0199a213-81c0-7800-8aa1-bbab2a035a53'}));
console.log(JSON.stringify({type:'item.completed',item:{id:'item_0',type:'agent_message',text:'Synthetic route reply'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`;
const js = path.join(bin, "coven-fixture.cjs");
await writeFile(js, script);
const covenBin = path.join(bin, process.platform === "win32" ? "coven.cmd" : "coven");
await writeFile(covenBin, process.platform === "win32" ? `@"${process.execPath}" "${js}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
process.env.COVEN_BIN = covenBin;

const { saveConfig } = await import("@/lib/cave-config");
const { createProject } = await import("@/lib/cave-projects");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
const { POST } = await import("./route.ts");
await saveConfig({ familiars: { sage: { harness: "codex" } } });
const readProject = await createProject({ name: "Read only", root: readRoot });
const writeProject = await createProject({ name: "Writable", root: writeRoot });
await grantProjectToFamiliar({ familiarId: "sage", projectId: readProject.id, source: "human", access: "read" });
await grantProjectToFamiliar({ familiarId: "sage", projectId: writeProject.id, source: "human", access: "write" });

const send = async (body) => {
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "sage", prompt: "Synthetic admission fixture", ...body }),
  }));
  return { status: response.status, body: await response.text() };
};
const calls = async () => {
  try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
};

// Build on the read-only project: refused with the code Chat answers with
// "Give write access" or "Use Explore", and nothing launches.
const refused = await send({ projectRoot: readRoot, permissionMode: "full" });
assert.equal(refused.status, 403, refused.body);
assert.equal(JSON.parse(refused.body).code, "project_write_access_required", refused.body);
await assert.rejects(access(log), "a Build turn on a read-only project must never launch the harness");

// A caller that omits permissionMode asks for Build too; it is refused the same way.
const implicit = await send({ projectRoot: readRoot });
assert.equal(implicit.status, 403, implicit.body);
assert.equal((await calls()).length, 0);

// Explore on the same project still runs, with Codex held read-only.
const explore = await send({ projectRoot: readRoot, permissionMode: "read" });
assert.equal(explore.status, 200, explore.body);
let launches = await calls();
assert.equal(launches.length, 1, explore.body);
assert.equal(launches[0].argv[launches[0].argv.indexOf("--permission") + 1], "read-only");

// Build on a writable project still launches, and Cave adds no wider sandbox:
// no --permission flag, so Codex keeps its own sandbox_mode (#3297, #6096).
const build = await send({ projectRoot: writeRoot, permissionMode: "full" });
assert.equal(build.status, 200, build.body);
launches = await calls();
assert.equal(launches.length, 2, build.body);
assert.ok(!launches[1].argv.includes("--permission"), JSON.stringify(launches[1].argv));
assert.ok(!launches[1].argv.some((arg) => /danger-full-access/.test(arg)), JSON.stringify(launches[1].argv));

console.log("route-read-project-admission.integration.test.ts: ok");
