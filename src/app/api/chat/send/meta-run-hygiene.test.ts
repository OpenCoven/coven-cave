// @ts-nocheck
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const scratch = await mkdtemp(path.join(tmpdir(), "cave-meta-run-"));
const home = path.join(scratch, ".coven");
const caveHome = path.join(home, "cave");
const workspace = path.join(home, "workspaces", "familiars", "sage");
const bin = path.join(scratch, "bin");
const capture = path.join(scratch, "calls.jsonl");
const previous = { ...process.env };
Object.assign(process.env, {
  HOME: scratch, USERPROFILE: scratch, COVEN_HOME: home, COVEN_CAVE_HOME: caveHome,
  SHELL: path.join(scratch, "missing-shell"), PATH: bin, COVEN_WORKSPACES_ROOT: path.join(home, "workspaces"),
  COVEN_BIN: path.join(bin, process.platform === "win32" ? "coven.cmd" : "coven"),
  HERMES_BIN: path.join(bin, "missing-hermes"),
});
delete process.env.Path;
delete process.env.COVEN_SOCKET;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
await mkdir(bin, { recursive: true });
await mkdir(path.join(workspace, "memory"), { recursive: true });
await writeFile(capture, "");
async function shim(name, source) {
  const script = path.join(bin, `${name}.js`);
  await writeFile(script, source);
  await writeFile(path.join(bin, process.platform === "win32" ? `${name}.cmd` : name),
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
}
await shim("coven", `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(${JSON.stringify(process.env.META_RUN_NO_PERMISSION ? '--model --stream-json' : '--permission --model --stream-json')}); process.exit(0); }
if (args[0] !== 'run') process.exit(0);
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(args) + '\\n');
const id = require('node:crypto').randomUUID();
for (const frame of [
  {type:'system',subtype:'init',session_id:id,model:'claude-opus-5'},
  {type:'assistant',message:{content:[{type:'text',text:'synthetic response'}]},session_id:id},
  {type:'result',subtype:'success',is_error:false,duration_ms:1,session_id:id}
]) console.log(JSON.stringify(frame));
`);
await shim("claude", `
if (process.argv.includes('--version')) console.log('2.1.220 (Claude Code)');
if (process.argv.includes('--help')) console.log('--output-format <format> text json stream-json --permission-mode <mode>');
`);
const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
refreshCovenBin();
refreshCovenSpawnEnv();
const { saveConfig } = await import("@/lib/cave-config");
const { createProject } = await import("@/lib/cave-projects");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
const { familiarDailyMemoryRelativePath } = await import("@/lib/server/familiar-startup-context");
const { POST } = await import("./route.ts");
const { POST: generatePOST } = await import("../generate/[origin]/route.ts");
const sentinel = "SYNTHETIC_DAILY_MEMORY_SENTINEL";
await writeFile(path.join(workspace, familiarDailyMemoryRelativePath()), sentinel);
await saveConfig({ familiars: { sage: { harness: "claude" }, hermes: { harness: "hermes" }, opencode: { harness: "opencode" } } });
const project = await createProject({ name: "Synthetic meta-run fixture", root: workspace });
await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });

after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  refreshCovenBin();
  refreshCovenSpawnEnv();
  await rm(scratch, { recursive: true, force: true });
});
async function calls() { return (await readFile(capture, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
async function request(origin, overrides = {}) {
  const req = new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "sage", prompt: "synthetic task", projectRoot: workspace, ...overrides }),
  });
  return origin === "chat" ? POST(req) : generatePOST(req, { params: Promise.resolve({ origin }) });
}
async function run(origin, overrides, meta, permission = "full") {
  const before = (await calls()).length;
  const response = await request(origin, overrides);
  assert.equal(response.status, 200, await response.clone().text());
  const stream = await response.text();
  const captured = await calls();
  assert.equal(captured.length, before + 1, stream);
  const args = captured.at(-1);
  assert.equal(args.includes("--permission") ? args[args.indexOf("--permission") + 1] : null, meta || permission === "read" ? "read-only" : null);
  assert.equal(args.join(" ").includes(sentinel), !meta, "daily memory follows authoritative origin");
}
async function saved(origin, familiarId = "sage") {
  const sessionId = randomUUID();
  await mkdir(path.join(caveHome, "conversations"), { recursive: true });
  await writeFile(path.join(caveHome, "conversations", `${sessionId}.json`), JSON.stringify({
    sessionId, familiarId, harness: "claude", origin,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turns: [],
  }));
  return sessionId;
}
if (process.env.META_RUN_NO_PERMISSION) {
  test("Coven without permission forwarding rejects meta runs without launching", async () => {
    const response = await request("journal", { permissionMode: "full" });
    assert.equal(response.status, 501, await response.clone().text());
    assert.equal((await response.json()).code, "read_only_unavailable");
    assert.deepEqual(await calls(), []);
  });
} else {
  test("missing Coven capability fails closed in a fresh probe process", async () => {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
        env: { ...process.env, META_RUN_NO_PERMISSION: "1" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
  });
  for (const origin of ["enhance", "journal"]) {
    for (const permissionMode of ["full", undefined, "read"]) {
      test(`${origin} forces read-only and omits daily memory (${permissionMode ?? "omitted"})`, async () => {
        await run(origin, { permissionMode, origin: "canvas" }, true);
      });
    }
    test(`saved ${origin} remains meta on ordinary chat resume`, async () => {
      await run("chat", { sessionId: await saved(origin), permissionMode: "full", origin: "canvas" }, true);
    });
  }
  for (const origin of ["canvas", "chat"]) {
    for (const permissionMode of ["full", undefined, "read"]) {
      test(`${origin} retains requested ${permissionMode ?? "omitted"} access and memory`, async () => {
        await run(origin, { permissionMode, origin: "enhance" }, false, permissionMode);
      });
    }
    test(`saved ${origin} wins over enhance generation surface`, async () => {
      await run("enhance", { sessionId: await saved(origin), permissionMode: "full" }, false);
    });
  }
  for (const familiarId of ["hermes", "opencode"]) {
    test(`${familiarId} refuses meta runs before launching`, async () => {
      const before = (await calls()).length;
      const response = await request("enhance", { familiarId, permissionMode: "full", projectRoot: undefined });
      assert.equal(response.status, 501, await response.clone().text());
      assert.deepEqual(await response.json(), { ok: false, error: `${familiarId === "hermes" ? "Hermes" : "OpenCode"} does not support Cave's Read-only mode yet. Switch Access to Full access to run it.` });
      assert.equal((await calls()).length, before);
    });
  }
  test("foreign conversation is rejected before execution", async () => {
    const before = (await calls()).length;
    const response = await request("enhance", { sessionId: await saved("enhance", "someone-else") });
    assert.equal(response.status, 404);
    assert.equal((await calls()).length, before);
  });

}
