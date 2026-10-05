import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  clearCliRuntimeModelCache,
  listCliRuntimeModels,
  normalizeCliRuntimeModels,
} from "./cli-runtime-models.ts";

assert.deepEqual(normalizeCliRuntimeModels("codex", [
  { model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", hidden: false },
  { model: "hidden", hidden: true },
  { model: "old", upgrade: "gpt-6.1-sol" },
  { model: "retired", upgradeInfo: { retirementAt: 1 } },
  { model: "unsafe\nmodel" },
  { model: "gpt-6.1-sol" },
]), [{ id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" }]);
assert.deepEqual(normalizeCliRuntimeModels("claude", [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)" },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
  { value: "unresolved-alias", displayName: "Alias" },
]), [
  { id: "anthropic/claude-opus-5-5", label: "Opus 5.5" },
  { id: "anthropic/claude-haiku-4-5-20251001", label: "Haiku 4.5" },
]);

const methods: string[] = [];
const signals: string[] = [];
let spawns = 0;
const spawnImpl = ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
  spawns++;
  assert.equal(options.env.TEST_SCOPE, "a");
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill(signal: string) { signals.push(signal); queueMicrotask(() => child.emit("close", 0)); return true; },
  });
  child.stdin.on("data", (bytes) => {
    const request = JSON.parse(String(bytes));
    methods.push(request.method ?? request.request.subtype);
    let response;
    if (request.method === "initialized") return;
    if (request.method === "initialize") response = { id: request.id, result: {} };
    else if (request.method === "model/list") response = {
      id: request.id,
      result: {
        data: [{ model: request.params.cursor ? "gpt-6-astra" : "gpt-6.1-sol" }],
        nextCursor: request.params.cursor ? null : "page-2",
      },
    };
    else response = { type: "control_response", response: {
      subtype: "success", request_id: request.request_id,
      response: { models: [{ value: "opus", resolvedModel: "claude-opus-5-5" }] },
    } };
    queueMicrotask(() => {
      const frame = Buffer.from(JSON.stringify(response) + "\n");
      child.stdout.write(frame.subarray(0, 13));
      child.stdout.write(frame.subarray(13));
    });
  });
  return child;
}) as unknown as typeof import("node:child_process").spawn;
const dependencies = { spawnImpl, scopedEnv: () => ({ TEST_SCOPE: "a", NODE_ENV: "test" as const }),
  launch: () => ({ command: "fixture", args: [] }) };
clearCliRuntimeModelCache();
const [first, joined] = await Promise.all([
  listCliRuntimeModels("codex", "sage", dependencies),
  listCliRuntimeModels("codex", "sage", dependencies),
]);
assert.equal(spawns, 1, "same-scope concurrent requests share one probe");
assert.deepEqual(first.models.map((m) => m.id), ["openai/gpt-6.1-sol", "openai/gpt-6-astra"]);
assert.deepEqual(joined, first);
assert.deepEqual(methods, ["initialize", "initialized", "model/list", "model/list"]);
assert.equal((await listCliRuntimeModels("codex", "sage", dependencies)).provenance, "cached");
await listCliRuntimeModels("codex", "nova", dependencies);
assert.equal(spawns, 2, "familiar scopes do not share cached inventories");
assert.deepEqual((await listCliRuntimeModels("claude", "sage", dependencies)).models,
  [{ id: "anthropic/claude-opus-5-5", label: "claude-opus-5-5" }]);
assert.ok(signals.every((signal) => signal === "SIGTERM"));

clearCliRuntimeModelCache();
const unavailable = await listCliRuntimeModels("codex", null, {
  ...dependencies,
  spawnImpl: (() => { throw new Error("missing CLI"); }) as never,
});
assert.deepEqual(unavailable, { models: [], provenance: "unavailable" }, "failure never restores stale models");

for (const mode of ["timeout", "malformed", "oversized", "repeated-cursor", "broken-stdin"] as const) {
  clearCliRuntimeModelCache();
  let killed = false;
  const brokenSpawn = (() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { killed = true; queueMicrotask(() => child.emit("close", 0)); return true; },
    });
    child.stdin.on("data", (bytes) => {
      const request = JSON.parse(String(bytes));
      queueMicrotask(() => {
        if (mode === "malformed") child.stdout.write("not json\n");
        if (mode === "oversized") child.stdout.write("x".repeat(2049));
        if (mode === "broken-stdin") child.stdin.emit("error", new Error("EPIPE"));
        if (mode === "repeated-cursor" && request.id) child.stdout.write(JSON.stringify({
          id: request.id, result: request.method === "initialize" ? {} : { data: [], nextCursor: "same" },
        }) + "\n");
      });
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  const result = await listCliRuntimeModels("codex", null, {
    ...dependencies, spawnImpl: brokenSpawn, timeoutMs: 50, maxBytes: 2048,
  });
  assert.deepEqual(result, unavailable, `${mode} fails closed with no partial inventory`);
  assert.equal(killed, true, `${mode} terminates its probe`);
}
console.log("cli-runtime-models.test.ts: ok");
