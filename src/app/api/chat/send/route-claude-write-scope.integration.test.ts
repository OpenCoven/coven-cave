// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "cave-route-write-scope-"));
const bin = path.join(home, "bin");
const primary = path.join(home, "project");
const read = path.join(home, "read");
const write = path.join(read, "write");
const log = path.join(home, "calls.jsonl");
for (const dir of [bin, primary, write, path.join(home, ".claude/skills")]) await mkdir(dir, { recursive: true });
Object.assign(process.env, {
  HOME: home, COVEN_HOME: path.join(home, "coven"), COVEN_CAVE_HOME: path.join(home, "cave"),
  PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, SHELL: path.join(home, "no-shell"),
});
if (process.platform === "win32") { process.env.USERPROFILE = home; delete process.env.Path; }
delete process.env.COVEN_SOCKET;
const legacy = process.argv.includes("legacy");
const script = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0); }
if (args.includes('--help')) { console.log('--model --permission --add-dir ${legacy ? "" : "--write-scope <FILE>"} --output-format stream-json'); process.exit(0); }
if (args[0] === 'adapter') { console.log('[]'); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
const index = args.indexOf('--write-scope');
const scopeFile = index < 0 ? null : args[index+1];
const scope = scopeFile ? JSON.parse(fs.readFileSync(scopeFile, 'utf8')) : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({argv:args,scopeFile,scope})+'\\n');
if (process.env.CAVE_6356_PREINIT) { process.stderr.write('writeSco'); setTimeout(()=>{process.stderr.write('pe has unsupported overlapping read/write roots PRIVATE_SCOPE_SENTINEL'); process.exit(1);},10); return; }
console.log(JSON.stringify({type:'system',subtype:'init',session_id:'64c936fa-736e-4218-b279-e72dd318b2da'}));
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Synthetic route reply'}]}}));
console.log(JSON.stringify({type:'result',is_error:false,permission_denials:process.env.CAVE_6356_DENY ? [{tool_name:'Write',tool_input:{file_path:'PRIVATE_DENIAL_SENTINEL'}}] : []}));
console.log(JSON.stringify({type:'result',is_error:false}));
`;
const js = path.join(bin, "coven-fixture.cjs");
await writeFile(js, script);
for (const name of ["coven", "claude"]) {
  const file = path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
  await writeFile(file, process.platform === "win32" ? `@"${process.execPath}" "${js}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  if (name === "coven") process.env.COVEN_BIN = file;
}
const { saveConfig } = await import("@/lib/cave-config");
const { createProject } = await import("@/lib/cave-projects");
const { grantProjectToFamiliar, revokeProjectFromFamiliar } = await import("@/lib/project-permissions");
const { POST } = await import("./route.ts");
const { loadConversation } = await import("@/lib/cave-conversations");
await saveConfig({ familiars: { sage: { harness: "claude" } } });
const project = await createProject({ name: "Write scope", root: primary });
const reader = await createProject({ name: "Read parent", root: read });
const writer = await createProject({ name: "Write child", root: write });
for (const [p, level] of [[project,"write"],[reader,"read"],[writer,"write"]]) {
  await grantProjectToFamiliar({ familiarId: "sage", projectId:p.id, source:"human", access:level });
}
const send = async (extra={}) => {
  const response = await POST(new Request("http://localhost/api/chat/send", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({familiarId:"sage",prompt:"Synthetic permission fixture",projectRoot:primary,permissionMode:"full",...extra})}));
  const body = await response.text();
  const events = body.split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
  return { status:response.status,body,events,done:events.findLast(e=>e.kind==="done") };
};
const calls = async () => (await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
if (legacy) {
  const result = await send();
  assert.equal(result.status,200,result.body);
  assert.ok(result.events.some(e=>e.kind === "error" && e.code === "scoped_write_unavailable"),result.body);
  await assert.rejects(access(log),"unsupported runtime must never receive a model launch");
} else {
  const first = await send();
  assert.equal(first.status,200,first.body);
  let launches = await calls();
  const scope = launches[0].scope;
  assert.ok(scope,"the real route must forward a separate scope document");
  assert.equal(scope.writableRoots.length,2);
  assert.ok(scope.writableRoots.some(p=>p.endsWith(path.join("read","write"))));
  assert.ok(!scope.writableRoots.some(p=>p===scope.readOnlyRoots[0]));
  assert.ok(scope.protectedRoots.some(p=>p.endsWith(path.join(".claude","skills"))));
  assert.ok(!launches[0].argv.includes("--permission"));
  assert.ok(!launches[0].argv.includes("--add-dir"));
  assert.ok(first.done?.sessionId,first.body);
  const resumed = await send({sessionId:first.done.sessionId});
  assert.equal(resumed.status,200,resumed.body);
  launches = await calls();
  assert.ok(launches.at(-1).argv.includes("--continue"),"unchanged authority can resume");
  await revokeProjectFromFamiliar({familiarId:"sage",projectId:writer.id,source:"human"});
  const revoked = await send({sessionId:first.done.sessionId});
  assert.equal(revoked.status,200,revoked.body);
  launches = await calls();
  assert.ok(!launches.at(-1).argv.includes("--continue"),"revocation starts a fresh native authority boundary");
  assert.equal(launches.at(-1).scope.writableRoots.length,1);
  process.env.CAVE_6356_DENY="1";
  const denied = await send({sessionId:first.done.sessionId});
  assert.equal(denied.status,200,denied.body);
  assert.ok(denied.events.some(e=>e.kind==="error"&&e.code==="write_permission_denied"),denied.body);
  assert.doesNotMatch(denied.body,/PRIVATE_DENIAL_SENTINEL/);
  assert.equal(denied.done?.isError,true,"Coven's final success wrapper must not erase the native denial");
  const saved = await loadConversation(first.done.sessionId);
  assert.ok(saved?.turns.some(turn=>turn.isError && turn.progress?.some(p=>p.id==="runtime-write-denied")), "denial survives reload in the saved turn");
  delete process.env.CAVE_6356_DENY;
  process.env.CAVE_6356_PREINIT="1";
  const preinit = await send({sessionId:first.done.sessionId});
  assert.ok(preinit.events.some(e=>e.kind==="error" && e.code==="runtime_write_scope_unavailable"),preinit.body);
  assert.doesNotMatch(preinit.body,/PRIVATE_SCOPE_SENTINEL/);
  assert.equal(preinit.done?.isError,true);
  delete process.env.CAVE_6356_PREINIT;
  const readMode = await send({sessionId:first.done.sessionId,permissionMode:"read"});
  assert.equal(readMode.status,200,readMode.body);
  launches = await calls();
  assert.ok(!launches.at(-1).argv.includes("--continue"),"permission-mode changes replace native authority");
  assert.ok(!launches.at(-1).argv.includes("--write-scope"));
  assert.ok(launches.at(-1).argv.includes("read-only"));
  for (const launch of launches.filter(call=>call.scopeFile)) await assert.rejects(access(launch.scopeFile), "per-turn scope files are retired after the stream");
  await grantProjectToFamiliar({familiarId:"sage",projectId:project.id,source:"human",access:"read"});
  const before = (await calls()).length;
  const readPrimary = await send();
  assert.equal(readPrimary.status,403,readPrimary.body);
  assert.match(readPrimary.body,/project_write_access_required/);
  assert.equal((await calls()).length,before,"read-only primary cannot launch scoped writes");
}
console.log(`route-claude-write-scope.integration.test.ts (${legacy ? "legacy" : "scoped"}): ok`);
