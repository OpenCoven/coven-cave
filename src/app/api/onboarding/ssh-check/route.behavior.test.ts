// Exercise the actual route with synthetic child events; never invoke SSH or Vault.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { transformSync } from "esbuild";
import { BoundedProcessOutput, safeProcessErrorMessage } from "../../../../lib/process-execution.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(options: { spawnError?: Error; cleanup?: () => Promise<boolean> } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345,
    kills: [] as string[], kill(signal: string) { this.kills.push(signal); return true; },
  });
  const launches: unknown[][] = [];
  const cleaned: unknown[] = [];
  const timers = new Set<() => void>();
  const env = { PATH: "/fixture path/工具", HOME: "/fixture home" };
  const modules: Record<string, unknown> = {
    "@/lib/harness-spawn-env": { warmHarnessSpawnPath: async () => undefined },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "node:child_process": { spawn: (...args: unknown[]) => { launches.push(args); if (options.spawnError) throw options.spawnError; return child; } },
    "@/lib/coven-bin": { covenSpawnEnv: () => env },
    "@/lib/ansi": { stripAnsi: (value: string) => value },
    "@/lib/process-execution": {
      BoundedProcessOutput, safeProcessErrorMessage,
      terminateProcessTree: async (owned: unknown) => { cleaned.push(owned); return options.cleanup ? options.cleanup() : true; },
    },
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const module = { exports };
  const context = createContext({ exports, module, process: { platform: "darwin" },
    require(name: string) { assert.ok(name in modules, `unexpected route import ${name}`); return modules[name]; },
    setTimeout(fn: () => void) { timers.add(fn); return fn; }, clearTimeout(fn: () => void) { timers.delete(fn); },
  });
  runInContext(code, context, { filename: "ssh-check-route.cjs" });
  const request = (signal?: AbortSignal, host = "fixture-host") => new Request("http://localhost/api/onboarding/ssh-check", { method: "POST", body: JSON.stringify({ host }), signal });
  return { child, launches, cleaned, timers, env, post: module.exports.POST!, request };
}

test("SSH preflight preserves array args, scoped env and owns the child group", async () => {
  const h = harness();
  const result = h.post(h.request());
  await turn();
  const [command, args, options] = h.launches[0] as [string, string[], Record<string, unknown>];
  assert.equal(command, "ssh");
  assert.equal(args[args.indexOf("--") + 1], "fixture-host");
  assert.ok(args.includes("BatchMode=yes"));
  assert.equal(options.env, h.env);
  assert.equal(options.shell, false);
  assert.equal(options.detached, true);
  h.child.stdout.write("__coven_cave_ssh_probe__\n/fixture path/工具/coven\n");
  h.child.emit("close", 0);
  assert.equal((await (await result).json()).covenPath, "/fixture path/工具/coven");
  assert.equal(h.timers.size, 0);
});

test("SSH diagnostic output stays bounded and redacts split secrets", async () => {
  const h = harness();
  const result = h.post(h.request());
  await turn();
  h.child.stderr.write("x".repeat(256 * 1024));
  h.child.stderr.write("\nAuthorization: Bear");
  h.child.stderr.write("er github_pat_abcdefghijklmnopqrstuvwxyz123456789\n");
  h.child.emit("close", 1);
  const body = await (await result).json();
  assert.ok(Buffer.byteLength(body.stderr) <= 8192);
  assert.doesNotMatch(body.stderr, /github_pat_|abcdefghijklmnopqrstuvwxyz/);
});

test("timeout cannot become success and waits for owned-tree cleanup", async () => {
  let release!: (value: boolean) => void;
  const cleanup = new Promise<boolean>((resolve) => { release = resolve; });
  const h = harness({ cleanup: () => cleanup });
  let settled = false;
  const result = h.post(h.request()).then((response) => { settled = true; return response; });
  await turn();
  for (const timer of [...h.timers]) timer();
  h.child.stdout.write("__coven_cave_ssh_probe__\n/bin/coven\n");
  h.child.emit("close", 0);
  await turn();
  assert.deepEqual(h.cleaned, [h.child]);
  assert.equal(settled, false);
  release(true);
  assert.equal((await result).status, 504);
});

test("request cancellation cleans the owned tree; already aborted never spawns", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const h = harness();
  const result = h.post(h.request(controller.signal));
  await turn();
  controller.abort();
  assert.equal((await result).status, 499);
  assert.deepEqual(h.cleaned, [h.child]);
  const before = harness();
  assert.equal((await before.post(before.request(controller.signal))).status, 499);
  assert.equal(before.launches.length, 0);
});

test("asynchronous and synchronous spawn failures return path-free diagnostics", async () => {
  const error = Object.assign(new Error("spawn /private/credential/path EACCES"), { code: "EACCES" });
  for (const synchronous of [false, true]) {
    const h = harness(synchronous ? { spawnError: error } : {});
    const result = h.post(h.request());
    await turn();
    if (!synchronous) h.child.emit("error", error);
    const response = await result;
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|credential|EACCES/);
    assert.equal(h.timers.size, 0);
  }
});

test("invalid hosts are rejected before spawning", async () => {
  const h = harness();
  assert.equal((await h.post(h.request(undefined, "host; command"))).status, 400);
  assert.equal(h.launches.length, 0);
});
