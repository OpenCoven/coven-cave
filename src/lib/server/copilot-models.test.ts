import { waitFor } from "../testing/wait-for.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  CopilotRpcFrameDecoder,
  clearCopilotModelCache,
  encodeCopilotRpcFrame,
  listCopilotModels,
} from "./copilot-models.ts";

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals) => boolean;
};

const frame = (value: unknown) => encodeCopilotRpcFrame(value);

{
  const decoder = new CopilotRpcFrameDecoder();
  const payload = frame({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  assert.deepEqual(decoder.push(payload.subarray(0, 7)), []);
  assert.deepEqual(decoder.push(payload.subarray(7, 23)), []);
  assert.deepEqual(decoder.push(payload.subarray(23)), [
    { jsonrpc: "2.0", id: 1, result: { ok: true } },
  ]);
  assert.deepEqual(
    decoder.push(Buffer.concat([
      frame({ jsonrpc: "2.0", id: 2, result: {} }),
      frame({ jsonrpc: "2.0", method: "notice", params: {} }),
    ])),
    [
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", method: "notice", params: {} },
    ],
  );
  assert.throws(
    () => new CopilotRpcFrameDecoder().push(Buffer.from("Content-Length: nope\r\n\r\n{}")),
    /frame/i,
  );
  assert.throws(
    () => new CopilotRpcFrameDecoder({ maxBodyBytes: 8 }).push(
      Buffer.from("Content-Length: 9\r\n\r\n123456789"),
    ),
    /large/i,
  );
}

function rpcSpawn(options: {
  models?: unknown[];
  connectMethodMissing?: boolean;
  malformedResponse?: boolean;
  noResponse?: boolean;
  signals?: Array<NodeJS.Signals | undefined>;
  onSpawn?: (
    args: readonly string[],
    spawnOptions: import("node:child_process").SpawnOptions | undefined,
  ) => void;
  onRequest?: (method: string) => void;
} = {}): typeof import("node:child_process").spawn {
  return ((
    _command: string,
    args: readonly string[] = [],
    spawnOptions?: import("node:child_process").SpawnOptions,
  ) => {
    options.onSpawn?.(args, spawnOptions);
    const child = new EventEmitter() as FakeChild;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      options.signals?.push(signal);
      return true;
    };
    const requests = new CopilotRpcFrameDecoder();
    child.stdin.on("data", (chunk) => {
      for (const value of requests.push(chunk)) {
        const request = value as { id?: number; method?: string };
        if (!request.method || request.id === undefined) continue;
        options.onRequest?.(request.method);
        if (options.noResponse) continue;
        if (options.malformedResponse) {
          child.stdout.write("Content-Length: nope\r\n\r\n{}");
          continue;
        }
        let response: unknown;
        if (request.method === "connect" && options.connectMethodMissing) {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: "Method not found" },
          };
        } else if (request.method === "models.list") {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            result: { models: options.models ?? [] },
          };
        } else {
          response = {
            jsonrpc: "2.0",
            id: request.id,
            result: { protocolVersion: 1 },
          };
        }
        const encoded = frame(response);
        child.stdout.write(encoded.subarray(0, 11));
        child.stdout.write(encoded.subarray(11));
      }
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

const readyLaunch = async (
  _executable: string,
  options: { spawnEnv?: () => NodeJS.ProcessEnv },
) => ({
  env: options.spawnEnv?.() ?? {},
  command: process.execPath,
  fixedArgs: ["copilot-entry.js"],
  requiredFiles: ["copilot-entry.js"],
  deadline: Date.now() + 2_500,
  availability: {
    state: "ready" as const,
    runner: "copilot" as const,
    resolvedPath: process.execPath,
  },
});

clearCopilotModelCache();
const methods: string[] = [];
let launchArgs: readonly string[] = [];
let launchEnv: NodeJS.ProcessEnv | undefined;
const available = await listCopilotModels("sage", {
  scopedEnv: () => ({ PATH: "/copilot", COPILOT_GITHUB_TOKEN: "scoped-token" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: rpcSpawn({
    models: [
      { id: "claude-opus-5", name: "Claude Opus 5", policy: { state: "enabled" } },
      { id: "disabled", name: "Disabled", policy: { state: "disabled" } },
    ],
    onRequest: (method) => methods.push(method),
    onSpawn: (args, options) => {
      launchArgs = args;
      launchEnv = options?.env;
    },
  }),
});
assert.deepEqual(available, [
  { id: "github/auto", label: "Auto (Copilot picks)" },
  { id: "github/claude-opus-5", label: "Claude Opus 5" },
]);
assert.deepEqual(methods, ["connect", "models.list"]);
assert.deepEqual(launchArgs, [
  "copilot-entry.js",
  "--headless",
  "--no-auto-update",
  "--log-level",
  "error",
  "--stdio",
]);
assert.equal(launchEnv?.COPILOT_GITHUB_TOKEN, "scoped-token");

clearCopilotModelCache();
const environmentOrder: string[] = [];
await listCopilotModels("deadline-proof", {
  scopedEnv: () => {
    environmentOrder.push("scoped-env");
    return { PATH: "/copilot" };
  },
  resolveRuntimeLaunch: (async (
    _executable: string,
    options: { spawnEnv?: () => NodeJS.ProcessEnv },
  ) => {
    environmentOrder.push("resolve-launch");
    const env = options.spawnEnv?.() ?? {};
    return {
      env,
      command: process.execPath,
      fixedArgs: ["copilot-entry.js"],
      requiredFiles: ["copilot-entry.js"],
      deadline: Date.now() + 2_500,
      availability: {
        state: "ready" as const,
        runner: "copilot" as const,
        resolvedPath: process.execPath,
      },
    };
  }) as never,
  spawnImpl: rpcSpawn({ models: [] }),
});
assert.deepEqual(
  environmentOrder.slice(0, 2),
  ["scoped-env", "resolve-launch"],
  "familiar-scoped env construction finishes before launch resolution starts its deadline",
);

clearCopilotModelCache();
const legacyMethods: string[] = [];
const legacy = await listCopilotModels("sage", {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: rpcSpawn({
    connectMethodMissing: true,
    models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
    onRequest: (method) => legacyMethods.push(method),
  }),
});
assert.equal(legacy.some((model) => model.id === "github/claude-opus-5"), true);
assert.deepEqual(legacyMethods, ["connect", "ping", "models.list"]);

clearCopilotModelCache();
let coalescedSpawns = 0;
const coalescedSpawn = rpcSpawn({
  models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
  onSpawn: () => { coalescedSpawns += 1; },
});
const [coalescedA, coalescedB] = await Promise.all([
  listCopilotModels("nova", {
    scopedEnv: () => ({ PATH: "/copilot" }),
    resolveRuntimeLaunch: readyLaunch as never,
    spawnImpl: coalescedSpawn,
  }),
  listCopilotModels("nova", {
    scopedEnv: () => ({ PATH: "/copilot" }),
    resolveRuntimeLaunch: readyLaunch as never,
    spawnImpl: coalescedSpawn,
  }),
]);
assert.deepEqual(coalescedA, coalescedB);
assert.equal(coalescedSpawns, 1, "concurrent model requests share one authenticated RPC");

clearCopilotModelCache();
let capacitySpawns = 0;
const capacitySpawn = rpcSpawn({
  models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
  onSpawn: () => { capacitySpawns += 1; },
});
const capacityDependencies = {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: capacitySpawn,
  maxCacheEntries: 2,
};
await listCopilotModels("capacity-a", capacityDependencies);
await listCopilotModels("capacity-b", capacityDependencies);
await listCopilotModels("capacity-a", capacityDependencies);
await listCopilotModels("capacity-c", capacityDependencies);
await listCopilotModels("capacity-b", capacityDependencies);
assert.equal(capacitySpawns, 4, "the bounded cache evicts its least-recent entry");

clearCopilotModelCache();
let expirySpawns = 0;
let expiryNow = 0;
const expiryDependencies = {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: rpcSpawn({
    models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
    onSpawn: () => { expirySpawns += 1; },
  }),
  now: () => expiryNow,
  maxCacheEntries: 2,
};
await listCopilotModels("expiry-live", { ...expiryDependencies, cacheMs: 100 });
await listCopilotModels("expiry-stale", { ...expiryDependencies, cacheMs: 1 });
expiryNow = 2;
await listCopilotModels("expiry-new", { ...expiryDependencies, cacheMs: 100 });
await listCopilotModels("expiry-live", { ...expiryDependencies, cacheMs: 100 });
assert.equal(expirySpawns, 3, "expired entries are pruned before LRU eviction");

clearCopilotModelCache();
let boundedSpawns = 0;
const boundedSpawn = rpcSpawn({
  models: [{ id: "claude-opus-5", name: "Claude Opus 5" }],
  onSpawn: () => { boundedSpawns += 1; },
});
const boundedDependencies = {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: boundedSpawn,
  maxConcurrentDiscoveries: 1,
};
const boundedFirst = listCopilotModels("bounded-a", boundedDependencies);
const boundedOverflow = await listCopilotModels("bounded-b", boundedDependencies);
assert.deepEqual(
  boundedOverflow,
  [],
  "a distinct discovery above the global limit fails soft to an empty inventory",
);
await boundedFirst;
assert.equal(boundedSpawns, 1, "the global discovery limit bounds subprocess fan-out");

clearCopilotModelCache();
const malformedSignals: Array<NodeJS.Signals | undefined> = [];
const malformed = await listCopilotModels("sage", {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: rpcSpawn({ malformedResponse: true, signals: malformedSignals }),
});
assert.deepEqual(malformed, []);
assert.equal(malformedSignals[0], "SIGTERM");

clearCopilotModelCache();
const timeoutSignals: Array<NodeJS.Signals | undefined> = [];
const timedOut = await listCopilotModels("sage", {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: readyLaunch as never,
  spawnImpl: rpcSpawn({ noResponse: true, signals: timeoutSignals }),
  timeoutMs: 5,
  forceKillGraceMs: 5,
});
assert.deepEqual(timedOut, []);
// The escalation is what's under test — SIGTERM, then SIGKILL once the grace
// timer expires — not how promptly this host's event loop delivers two 5ms
// timers. Sleeping a fixed 15ms here left ~2ms of headroom at p99 on an IDLE
// machine (measured: p50 11.4ms, p99 13.0ms, max 15.5ms), so it failed
// outright under load. Wait for the signals themselves (cave-2nhfe).
await waitFor(() => timeoutSignals.length >= 2, {
  describe: "the probe timeout to escalate SIGTERM to SIGKILL",
});
assert.deepEqual(timeoutSignals, ["SIGTERM", "SIGKILL"]);

clearCopilotModelCache();
let blockedSpawns = 0;
const blocked = await listCopilotModels("sage", {
  scopedEnv: () => ({ PATH: "/copilot" }),
  resolveRuntimeLaunch: (async () => ({
    env: {},
    command: "copilot",
    fixedArgs: [],
    deadline: Date.now() + 2_500,
    availability: {
      state: "missing" as const,
      runner: "copilot" as const,
      code: "runtime_missing" as const,
      message: "missing",
    },
  })) as never,
  spawnImpl: (() => {
    blockedSpawns += 1;
    throw new Error("must not spawn");
  }) as typeof import("node:child_process").spawn,
});
assert.deepEqual(blocked, []);
assert.equal(blockedSpawns, 0);

console.log("server/copilot-models.test.ts: ok");
