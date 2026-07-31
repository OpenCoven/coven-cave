import { waitFor } from "../testing/wait-for.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  clearClaudeModelCache,
  listClaudeModels,
} from "./claude-models.ts";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function versionSpawn(
  output: string | null,
  options: {
    delayMs?: number;
    code?: number;
    onSpawn?: (
      args: readonly string[],
      spawnOptions: import("node:child_process").SpawnOptions | undefined,
    ) => void;
    signals?: Array<NodeJS.Signals | undefined>;
  } = {},
): typeof import("node:child_process").spawn {
  return ((
    _command: string,
    args: readonly string[] = [],
    spawnOptions?: import("node:child_process").SpawnOptions,
  ) => {
    options.onSpawn?.(args, spawnOptions);
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let killed = false;
    child.kill = (signal) => {
      options.signals?.push(signal);
      killed = true;
      return true;
    };
    if (output !== null) {
      setTimeout(() => {
        if (killed) return;
        child.stdout.end(output);
        child.stderr.end();
        child.emit("close", options.code ?? 0);
      }, options.delayMs ?? 0);
    }
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

clearClaudeModelCache();
let capturedArgs: readonly string[] = [];
let capturedEnv: NodeJS.ProcessEnv | undefined;
const direct = await listClaudeModels("sage", {
  scopedEnv: () => ({
    PATH: "/scoped",
    ANTHROPIC_API_KEY: "fixture",
  }),
  probeEnv: () => ({
    PATH: "/canonical",
    ANTHROPIC_API_KEY: "fixture",
  }),
  spawnImpl: versionSpawn("2.1.219 (Claude Code)\n", {
    onSpawn: (args, options) => {
      capturedArgs = args;
      capturedEnv = options?.env;
    },
  }),
});
assert.equal(direct[0]?.id, "anthropic/claude-opus-5");
assert.deepEqual(capturedArgs, ["--version"]);
assert.equal(capturedEnv?.PATH, "/canonical");
assert.equal(capturedEnv?.ANTHROPIC_API_KEY, undefined, "metadata probes never inherit provider credentials");

clearClaudeModelCache();
const foundryWithoutMapping = await listClaudeModels("sage", {
  scopedEnv: () => ({ CLAUDE_CODE_USE_FOUNDRY: "1" }),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: versionSpawn("2.1.219 (Claude Code)\n"),
});
assert.ok(
  !foundryWithoutMapping.some((model) => model.id === "anthropic/claude-opus-5"),
  "a user-defined Foundry deployment is not guessed",
);

clearClaudeModelCache();
const foundryWithMapping = await listClaudeModels("sage", {
  scopedEnv: () => ({
    CLAUDE_CODE_USE_FOUNDRY: "1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "prod-claude-opus-5",
  }),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: versionSpawn("2.1.219 (Claude Code)\n"),
});
assert.equal(foundryWithMapping[0]?.id, "anthropic/claude-opus-5");

clearClaudeModelCache();
let coalescedSpawns = 0;
const slowSpawn = versionSpawn("2.1.219 (Claude Code)\n", {
  delayMs: 5,
  onSpawn: () => { coalescedSpawns += 1; },
});
const [first, second] = await Promise.all([
  listClaudeModels("nova", {
    scopedEnv: () => ({}),
    probeEnv: () => ({ PATH: "/canonical" }),
    spawnImpl: slowSpawn,
  }),
  listClaudeModels("nova", {
    scopedEnv: () => ({}),
    probeEnv: () => ({ PATH: "/canonical" }),
    spawnImpl: slowSpawn,
  }),
]);
assert.deepEqual(first, second);
assert.equal(coalescedSpawns, 1, "concurrent identical inventories share one version probe");
await listClaudeModels("nova", {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: (() => { throw new Error("successful result should be cached"); }) as typeof import("node:child_process").spawn,
});

clearClaudeModelCache();
let capacitySpawns = 0;
const capacitySpawn = versionSpawn("2.1.219 (Claude Code)\n", {
  onSpawn: () => { capacitySpawns += 1; },
});
const capacityDependencies = {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: capacitySpawn,
  maxCacheEntries: 2,
};
await listClaudeModels("capacity-a", capacityDependencies);
await listClaudeModels("capacity-b", capacityDependencies);
await listClaudeModels("capacity-a", capacityDependencies);
await listClaudeModels("capacity-c", capacityDependencies);
await listClaudeModels("capacity-b", capacityDependencies);
assert.equal(capacitySpawns, 4, "the bounded cache evicts its least-recent entry");

clearClaudeModelCache();
let expirySpawns = 0;
let expiryNow = 0;
const expiryDependencies = {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: versionSpawn("2.1.219 (Claude Code)\n", {
    onSpawn: () => { expirySpawns += 1; },
  }),
  now: () => expiryNow,
  maxCacheEntries: 2,
};
await listClaudeModels("expiry-live", { ...expiryDependencies, cacheMs: 100 });
await listClaudeModels("expiry-stale", { ...expiryDependencies, cacheMs: 1 });
expiryNow = 2;
await listClaudeModels("expiry-new", { ...expiryDependencies, cacheMs: 100 });
await listClaudeModels("expiry-live", { ...expiryDependencies, cacheMs: 100 });
assert.equal(expirySpawns, 3, "expired entries are pruned before LRU eviction");

clearClaudeModelCache();
let boundedSpawns = 0;
const boundedSpawn = versionSpawn("2.1.219 (Claude Code)\n", {
  delayMs: 10,
  onSpawn: () => { boundedSpawns += 1; },
});
const boundedDependencies = {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: boundedSpawn,
  maxConcurrentDiscoveries: 1,
};
const boundedFirst = listClaudeModels("bounded-a", boundedDependencies);
const boundedOverflow = await listClaudeModels("bounded-b", boundedDependencies);
assert.ok(
  !boundedOverflow.some((model) => model.id === "anthropic/claude-opus-5"),
  "a distinct discovery above the global limit fails soft to the seed",
);
await boundedFirst;
assert.equal(boundedSpawns, 1, "the global discovery limit bounds subprocess fan-out");

clearClaudeModelCache();
const timeoutSignals: Array<NodeJS.Signals | undefined> = [];
const timedOut = await listClaudeModels("sage", {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: versionSpawn(null, { signals: timeoutSignals }),
  timeoutMs: 5,
  forceKillGraceMs: 5,
});
assert.ok(!timedOut.some((model) => model.id === "anthropic/claude-opus-5"));
// The escalation is what's under test — SIGTERM, then SIGKILL once the grace
// timer expires — not how promptly this host's event loop delivers two 5ms
// timers. Sleeping a fixed 15ms here left ~2ms of headroom at p99 on an IDLE
// machine (measured: p50 11.4ms, p99 13.0ms, max 15.5ms), so it failed
// outright under load. Wait for the signals themselves (cave-2nhfe).
await waitFor(() => timeoutSignals.length >= 2, {
  describe: "the probe timeout to escalate SIGTERM to SIGKILL",
});
assert.deepEqual(timeoutSignals, ["SIGTERM", "SIGKILL"]);

clearClaudeModelCache();
const oversizedSignals: Array<NodeJS.Signals | undefined> = [];
const oversized = await listClaudeModels("sage", {
  scopedEnv: () => ({}),
  probeEnv: () => ({ PATH: "/canonical" }),
  spawnImpl: versionSpawn("x".repeat(5_000), { signals: oversizedSignals }),
});
assert.ok(!oversized.some((model) => model.id === "anthropic/claude-opus-5"));
assert.equal(oversizedSignals[0], "SIGTERM", "oversized metadata output terminates the child");

console.log("server/claude-models.test.ts: ok");
