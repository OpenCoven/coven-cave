// @ts-nocheck
// The send route authorizes the project, then reads the familiar's grants
// again for the turn's scope (#6445). Projects can revoke the grant between
// those two reads. The turn must then be refused the way a revoked project
// already is, and nothing may launch.
//
// The route asks `coven --help` for its flags between the two reads, so the
// recording `coven` on PATH revokes the grant at exactly that point.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-route-revoked-admit-"));
const bin = path.join(home, "bin");
const projectRoot = path.join(home, "project");
const log = path.join(home, "calls.jsonl");
const revoke = path.join(home, "revoke-on-help");
for (const dir of [bin, projectRoot]) await mkdir(dir, { recursive: true });
Object.assign(process.env, {
  HOME: home, COVEN_HOME: path.join(home, "coven"), COVEN_CAVE_HOME: path.join(home, "cave"),
  PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, SHELL: path.join(home, "no-shell"),
});
if (process.platform === "win32") { process.env.USERPROFILE = home; delete process.env.Path; }
delete process.env.COVEN_SOCKET;
const permissions = path.join(home, "cave", "project-permissions.json");
const script = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('coven 0.4.10'); process.exit(0); }
if (args.includes('--help')) {
  if (fs.existsSync(${JSON.stringify(revoke)})) {
    fs.rmSync(${JSON.stringify(revoke)});
    const file = JSON.parse(fs.readFileSync(${JSON.stringify(permissions)}, 'utf8'));
    file.projectGrants = [];
    fs.writeFileSync(${JSON.stringify(permissions)}, JSON.stringify(file));
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({revoked:true})+'\\n');
  }
  console.log('--model --permission --add-dir --output-format stream-json'); process.exit(0);
}
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
const project = await createProject({ name: "Revoked mid-send", root: projectRoot });
await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });

const send = async (body) => {
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "sage", prompt: "Synthetic admission fixture", projectRoot, ...body }),
  }));
  return { status: response.status, body: await response.text() };
};
const entries = async () => {
  try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
};

// Build: the grant is there when the project is authorized and gone when the
// turn's scope is read. The route's first flag probe is the point in between.
await writeFile(revoke, "");
const build = await send({ permissionMode: "full" });
let seen = await entries();
assert.deepEqual(seen.filter((entry) => entry.revoked), [{ revoked: true }], "the grant was revoked during the request, after authorization");
assert.equal(build.status, 403, build.body);
assert.equal(JSON.parse(build.body).code, "project_access_denied", build.body);
assert.match(JSON.parse(build.body).error, /no longer has access to that project/);
assert.equal(seen.filter((entry) => entry.argv).length, 0, "a Build turn must not launch in a project with no current grant");

// With the grant back, the same Build launches.
await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });
const again = await send({ permissionMode: "full" });
assert.equal(again.status, 200, again.body);
seen = await entries();
assert.equal(seen.filter((entry) => entry.argv).length, 1, again.body);

console.log("route-revoked-project-admission.integration.test.ts: ok");
