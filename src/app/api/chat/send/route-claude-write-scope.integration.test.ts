// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, realpath } from "node:fs/promises";
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
const noPermission = process.argv.includes("no-permission");
const legacy = noPermission || process.argv.includes("legacy");
const script = `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.318 (Claude Code)'); process.exit(0); }
if (args.includes('--help')) { console.log('--model ${noPermission ? "" : "--permission"} --add-dir ${legacy ? "" : "--write-scope <FILE>"} --output-format stream-json'); process.exit(0); }
if (args[0] === 'adapter') { console.log('[]'); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
const index = args.indexOf('--write-scope');
const scopeFile = index < 0 ? null : args[index+1];
const scope = scopeFile ? JSON.parse(fs.readFileSync(scopeFile, 'utf8')) : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({argv:args,scopeFile,scope})+'\\n');
if (process.env.CAVE_6356_PREINIT) { process.stderr.write('writeSco'); setTimeout(()=>{process.stderr.write('pe has unsupported overlapping read/write roots PRIVATE_SCOPE_SENTINEL'); process.exit(1);},10); return; }
if (process.env.CAVE_6393_STALE_RESUME && args.includes('--continue')) {
  if (process.env.CAVE_6393_STALE_RESUME === 'tamper') fs.writeFileSync(scopeFile, JSON.stringify({...scope,writableRoots:[...scope.writableRoots,'/tampered']}));
  process.stderr.write('No conversation found with session ID 64c936fa-736e-4218-b279-e72dd318b2da\\n');
  process.exit(1);
}
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
if (noPermission) {
  // Neither boundary is available, so asking for the fallback changes nothing.
  const result = await send({allowReadOnlyFallback:true});
  assert.equal(result.status,200,result.body);
  const refusal = result.events.find(e=>e.kind === "error" && e.code === "scoped_write_unavailable");
  assert.ok(refusal,result.body);
  assert.match(refusal.message,/Update Coven/);
  await assert.rejects(access(log),"a runtime that can enforce neither boundary must never launch");
} else if (legacy) {
  // Unattended callers don't opt in: a run that can't edit must not report success.
  const refused = await send();
  assert.equal(refused.status,200,refused.body);
  const refusal = refused.events.find(e=>e.kind === "error" && e.code === "scoped_write_unavailable");
  assert.ok(refusal,refused.body);
  assert.doesNotMatch(refusal.message,/Update Coven/,"no released Coven has the flag, so updating can't help");
  assert.match(refusal.message,/runtime that can enforce project write access/);
  assert.doesNotMatch(refusal.message,/Switch Access to Read-only/);
  await assert.rejects(access(log),"a caller that didn't opt in must never receive a model launch");
  await assert.rejects(access(path.join(process.env.COVEN_CAVE_HOME,"claude-authority")),"a Coven that can't use authority files never gets any written");
  // Older Chat clients can still send the retired opt-in flag. A Build turn
  // must refuse instead of launching Claude in native plan/read-only mode.
  const result = await send({allowReadOnlyFallback:true});
  assert.equal(result.status,200,result.body);
  assert.ok(result.events.some(e=>e.kind === "error" && e.code === "scoped_write_unavailable"),result.body);
  assert.equal(result.done?.isError,true,result.body);
  assert.ok(!result.events.some(e=>e.kind === "progress" && e.id === "runtime-write-scope-read-only"),result.body);
  await assert.rejects(access(log),"even stale fallback opt-ins must never launch Claude");
  // Explicit Explore requests still use the supported read-only boundary.
  const explore = await send({permissionMode:"read"});
  assert.equal(explore.done?.isError,false,explore.body);
  const launches = await calls();
  assert.equal(launches.length,1);
  assert.equal(launches[0].argv[launches[0].argv.indexOf("--permission")+1],"read-only");
  const buildAgain = await send({sessionId:explore.done.sessionId,allowReadOnlyFallback:true});
  assert.equal(buildAgain.done?.isError,true,buildAgain.body);
  assert.ok(buildAgain.events.some(e=>e.kind === "error" && e.code === "scoped_write_unavailable"),buildAgain.body);
  assert.equal((await calls()).length,1,"switching back to Build cannot resume the read-only native session");

} else {
  const first = await send({allowReadOnlyFallback:true});
  assert.equal(first.status,200,first.body);
  let launches = await calls();
  const scope = launches[0].scope;
  assert.ok(!launches[0].argv.includes("--permission"),"a Coven with the flag keeps Full access even when the fallback is allowed");
  assert.ok(!first.events.some(e=>e.kind==="progress"&&e.id==="runtime-write-scope-read-only"),first.body);
  assert.ok(scope,"the real route must forward a separate scope document");
  assert.doesNotMatch(launches[0].argv.at(-1),/Effective access for this turn: Read-only/);
  const authorityDirectory = path.dirname(launches[0].scopeFile);
  assert.equal(path.dirname(authorityDirectory),await realpath(path.join(process.env.COVEN_CAVE_HOME,"claude-authority")),"authority files live under Cave's home, not temp");
  assert.ok(scope.protectedRoots.includes(authorityDirectory),"a launch denies its own authority directory to its own sandbox");
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
  assert.match(launches.at(-1).argv.at(-1),/Effective access for this turn: Read-only/);
  assert.doesNotMatch(launches.at(-1).argv.at(-1),/You may read, edit|\(read \+ write\)/);
  const buildAgain = await send({sessionId:readMode.done.sessionId});
  assert.equal(buildAgain.done?.isError,false,buildAgain.body);
  launches = await calls();
  assert.ok(launches.at(-1).scope,"switching back to Build applies scoped write authority");
  assert.ok(!launches.at(-1).argv.includes("--continue"),"Build starts a fresh native session after Explore");
  assert.ok(!launches.at(-1).argv.includes("read-only"));
  for (const launch of launches.filter(call=>call.scopeFile)) await assert.rejects(access(launch.scopeFile), "per-turn scope files are retired after the stream");
  // A stale native session makes the route retry within the turn, reusing its authority files.
  const staleFirst = await send();
  assert.ok(!staleFirst.events.some(e=>e.kind==="progress"&&e.id==="runtime-mcp-servers-excluded"),"no notice without an excluded server");
  const beforeRetry = (await calls()).length;
  process.env.CAVE_6393_STALE_RESUME = "clean";
  const retried = await send({sessionId:staleFirst.done.sessionId});
  const attempts = (await calls()).slice(beforeRetry);
  assert.equal(attempts.length,2,retried.body);
  assert.ok(attempts[0].argv.includes("--continue") && !attempts[1].argv.includes("--continue"),"the retry starts a fresh native session");
  assert.equal(attempts[0].scopeFile,attempts[1].scopeFile,"a retry inside one turn reuses its authority files");
  assert.equal(retried.done?.isError,false,retried.body);
  // So a change made during the first attempt must never reach the second.
  const tamperFirst = await send();
  const beforeTamper = (await calls()).length;
  process.env.CAVE_6393_STALE_RESUME = "tamper";
  const tampered = await send({sessionId:tamperFirst.done.sessionId});
  delete process.env.CAVE_6393_STALE_RESUME;
  const tamperAttempts = (await calls()).slice(beforeTamper);
  assert.equal(tamperAttempts.length,1,"a changed scope never reaches another launch");
  assert.ok(tampered.events.some(e=>e.kind==="error"&&e.code==="runtime_write_scope_unavailable"),tampered.body);
  assert.equal(tampered.done?.isError,true,tampered.body);
  await assert.rejects(access(tamperAttempts[0].scopeFile),"the turn still retires its files");
  // An MCP server that names a writable folder runs outside the sandbox, so it stays out and the turn says so.
  process.env.CLAUDE_CONFIG_DIR = path.join(home,"claude-config");
  await mkdir(process.env.CLAUDE_CONFIG_DIR);
  await writeFile(path.join(process.env.CLAUDE_CONFIG_DIR,".claude.json"),JSON.stringify({mcpServers:{
    rewritable:{command:"node",args:[path.join(await realpath(primary),"server.mjs")]},
    kept:{command:"npx",args:["-y","@acme/server"]},
  }}));
  const beforeMcp = (await calls()).length;
  const withMcp = await send();
  assert.equal(withMcp.status,200,withMcp.body);
  const mcpNotice = withMcp.events.find(e=>e.kind==="progress"&&e.id==="runtime-mcp-servers-excluded");
  assert.equal(mcpNotice?.status,"notice",withMcp.body);
  assert.match(mcpNotice.detail,/Left out of this turn: rewritable\./);
  const mcpLaunch = (await calls())[beforeMcp];
  assert.deepEqual(mcpLaunch.scope.mcpServerNames,["kept"]);
  delete process.env.CLAUDE_CONFIG_DIR;
  await grantProjectToFamiliar({familiarId:"sage",projectId:project.id,source:"human",access:"read"});
  const before = (await calls()).length;
  const readPrimary = await send();
  assert.equal(readPrimary.status,403,readPrimary.body);
  assert.match(readPrimary.body,/project_write_access_required/);
  assert.equal((await calls()).length,before,"read-only primary cannot launch scoped writes");
}
console.log(`route-claude-write-scope.integration.test.ts (${legacy ? "legacy" : "scoped"}): ok`);
