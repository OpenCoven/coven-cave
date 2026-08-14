import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  claudeOpus5Routability,
  clearClaudeModelCache,
  listClaudeModels,
} from "./claude-models.ts";
import { needsClaudeOpus5Routability } from "../../app/api/chat/send/chat-send-models.ts";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals) => boolean;
};

/** `output === null` models a probe that never answers — a missing binary, a
 * refused spawn, or a timeout. That is the case the tri-state exists for. */
function versionSpawn(
  output: string | null,
  options: { code?: number; onSpawn?: () => void } = {},
): typeof import("node:child_process").spawn {
  return ((_command: string, _args: readonly string[] = []) => {
    options.onSpawn?.();
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    if (output !== null) {
      setTimeout(() => {
        child.stdout.end(output);
        child.stderr.end();
        child.emit("close", options.code ?? 0);
      }, 0);
    }
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

const probeEnv = () => ({ PATH: "/canonical" });

// ── The predicate that decides whether to ask at all ─────────────────────────
// Scoped to the one selection whose launch value is an alias rather than the id
// itself. Everything else already round-trips as the id the user picked.
assert.equal(
  needsClaudeOpus5Routability({ harness: "claude", desiredModel: "anthropic/claude-opus-5" }),
  true,
);
assert.equal(
  needsClaudeOpus5Routability({ harness: "claude", desiredModel: "anthropic/claude-sonnet-5" }),
  false,
  "a model forwarded as its own id needs no second probe",
);
assert.equal(
  needsClaudeOpus5Routability({ harness: "codex", desiredModel: "anthropic/claude-opus-5" }),
  false,
  "the alias translation is claude-only",
);

// ── available ────────────────────────────────────────────────────────────────
clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => ({ PATH: "/scoped" }),
    probeEnv,
    spawnImpl: versionSpawn("2.1.219 (Claude Code)\n"),
  }),
  "available",
  "a current Claude Code with stock provider config routes Opus 5",
);

// ── unavailable: the two cases the acceptance criteria name ──────────────────
clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => ({ PATH: "/scoped" }),
    probeEnv,
    // One patch below the minimum that shipped the verified contract.
    spawnImpl: versionSpawn("2.1.218 (Claude Code)\n"),
  }),
  "unavailable",
  "a sub-minimum Claude Code cannot promise the alias means Opus 5",
);

clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => ({
      PATH: "/scoped",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-5",
    }),
    probeEnv,
    spawnImpl: versionSpawn("2.1.219 (Claude Code)\n"),
  }),
  "unavailable",
  "an explicit mapping pointing the Opus alias elsewhere is decisive",
);

// ── unknown: a probe that could not run is not evidence about the model ──────
// This is the half that makes the fix safe to ship. Reusing the model inventory
// as the verdict would report every one of these as "unavailable" and refuse a
// legitimate turn for reasons that say nothing about Opus 5.
clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => ({ PATH: "/scoped" }),
    probeEnv,
    spawnImpl: versionSpawn(null),
    timeoutMs: 5,
    forceKillGraceMs: 1,
  }),
  "unknown",
  "a version probe that never answers must not read as a rejected model",
);

clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => ({ PATH: "/scoped" }),
    probeEnv,
    spawnImpl: versionSpawn("claude: command not found\n", { code: 127 }),
  }),
  "unknown",
  "a non-zero probe exit is an absent CLI, not an unavailable model",
);

clearClaudeModelCache();
assert.equal(
  await claudeOpus5Routability("sage", {
    scopedEnv: () => {
      throw new Error("scoped env unavailable");
    },
    probeEnv,
    spawnImpl: versionSpawn("2.1.219 (Claude Code)\n"),
  }),
  "unknown",
  "an env read that throws says nothing about the model either",
);

// Prove the above is not vacuous: the same degraded inputs make the model
// inventory drop Opus 5, which is exactly why it must not be the verdict.
clearClaudeModelCache();
const degradedInventory = await listClaudeModels("sage", {
  scopedEnv: () => ({ PATH: "/scoped" }),
  probeEnv,
  spawnImpl: versionSpawn("claude: command not found\n", { code: 127 }),
});
assert.ok(
  !degradedInventory.some((model) => model.id === "anthropic/claude-opus-5"),
  "inventory omits Opus 5 on a failed probe — reading that as 'unavailable' is the bug being avoided",
);

// ── a cache hit answers without spawning, and stays authoritative ────────────
// discoverClaudeModels only caches when the version parsed, so a cached entry
// is always a real verdict rather than a degraded one.
clearClaudeModelCache();
let spawns = 0;
const counted = {
  scopedEnv: () => ({ PATH: "/scoped" }),
  probeEnv,
  spawnImpl: versionSpawn("2.1.219 (Claude Code)\n", { onSpawn: () => { spawns += 1; } }),
};
await listClaudeModels("sage", counted);
const spawnsAfterDiscovery = spawns;
assert.equal(await claudeOpus5Routability("sage", counted), "available");
assert.equal(
  spawns,
  spawnsAfterDiscovery,
  "a warm picker cache makes the launch-time check free",
);

clearClaudeModelCache();
console.log("claude-opus5-routability.test.ts passed");
