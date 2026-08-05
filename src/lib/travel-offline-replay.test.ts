// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const replay = await readFile(new URL("./travel-offline-replay.ts", import.meta.url), "utf8");
const config = await readFile(new URL("./cave-config.ts", import.meta.url), "utf8");
const state = await readFile(new URL("./travel-client-state.ts", import.meta.url), "utf8");

assert.match(
  config,
  /export async function offlineTravelItemsNeedingSync\(\)/,
  "travel replay should be able to list unsynced queue items",
);

assert.match(
  config,
  /export async function markOfflineTravelItemSyncing\(itemId: string\)/,
  "travel replay should mark an item syncing before side effects",
);

assert.match(
  config,
  /export async function failOfflineTravelItem\(itemId: string, error: string\)/,
  "travel replay should persist sync failures for visible handoff state",
);

assert.match(
  state,
  /item\.status === "pending" \|\| item\.status === "syncing" \|\| item\.status === "failed"/,
  "handoff should remain pending while any item is pending, syncing, or failed",
);

assert.match(
  replay,
  /let syncMutex: Promise<TravelOfflineReplayResult> \| null = null/,
  "travel replay should serialize reconnect sync attempts in-process",
);

assert.match(
  replay,
  /await markOfflineTravelItemSyncing\(candidate\.id\)[\s\S]*await replayTravelQueueItem\(item, config\)[\s\S]*await completeOfflineTravelItem\(item\.id\)/,
  "queue replay should claim, replay, then mark items synced only after side effects succeed",
);

assert.match(
  replay,
  /catch \(err\) \{[\s\S]*await failOfflineTravelItem\(item\.id, error\)/,
  "queue replay should mark failed items instead of dropping them",
);

assert.match(
  replay,
  /if \(config\.multiHost\.mode !== "hub"\) return result/,
  "queue replay should only sync back to a configured hub",
);

assert.match(
  replay,
  /path: "\/api\/v1\/sessions"/,
  "chat and flow replay should spawn hub sessions",
);

assert.match(
  replay,
  /path: "\/api\/v1\/workflows\/run"/,
  "workflow replay should try the daemon workflow engine before session fallback",
);

assert.match(
  replay,
  /startAutomationRun/,
  "queued automation jobs should be replayed through the automation runner",
);

assert.match(
  replay,
  /function queuedRuntime\(payload: Record<string, unknown>\): string \| null \{[\s\S]*payload\.responseMetadata[\s\S]*metadata\.runtime/,
  "chat replay should inspect the queued runtime metadata before launching a local hub session",
);

assert.match(
  replay,
  /if \(runtime\?\.startsWith\("ssh:"\)\) \{[\s\S]*queued SSH-runtime chat cannot be replayed as a local hub session/,
  "chat replay should not convert queued SSH-runtime work into a local hub session",
);

assert.match(
  replay,
  /queuedModelOverride\(payload\)[\s\S]*modelOverrideScope:[\s\S]*reasoningEffort: stringValue\(payload\.reasoningEffort\),[\s\S]*responseSpeed: stringValue\(payload\.responseSpeed\),[\s\S]*modelControls: record\(payload\.modelControls\)/,
  "travel replay extracts queued model and capability intent before the daemon boundary",
);
assert.match(
  replay,
  /const model = cleanModelId\(queuedModel\)[\s\S]*queued chat model id is not safe for launch/,
  "travel replay rejects a malformed persisted model instead of silently using the runtime default",
);
assert.match(
  replay,
  /modelSource === "familiar-default"[\s\S]*metadata\.desiredModel \?\? metadata\.model/,
  "travel replay preserves model intent from older queued items that predate the explicit override field",
);
assert.match(
  replay,
  /modelOverride && !isModelAllowedByRuntime\(binding\.harness, modelOverride\)[\s\S]*queued chat model id is not allowed by the selected runtime/,
  "travel replay validates a queued model against the current runtime before spawning",
);
assert.match(
  replay,
  /const harness = canonicalHarnessId\(args\.harness\)[\s\S]*path: "\/api\/v1\/sessions"[\s\S]*body:[\s\S]*harness,/,
  "travel replay canonicalizes runtime aliases before the hub launch boundary",
);

assert.match(
  replay,
  /export function daemonReplayControlFamilies\([\s\S]*?if \(stringValue\(payload\.reasoningEffort\)\)[\s\S]*?if \(stringValue\(payload\.responseSpeed\)\)/,
  "travel replay identifies legacy and typed control intent before it reaches the daemon",
);

assert.match(
  replay,
  /const controlFamilies = daemonReplayControlFamilies\(payload\);[\s\S]*?queued model controls cannot be replayed through the current hub session contract/,
  "travel replay must fail visibly instead of marking unsupported controls synced",
);

assert.match(
  replay,
  /queuedMetadata = record\(payload\.responseMetadata\)[\s\S]*canonicalHarnessId\(queuedHarness\) !== canonicalHarnessId\(binding\.harness\)/,
  "travel replay must not silently move a queued turn onto a newly selected harness",
);

assert.match(
  replay,
  /runtime\?\.startsWith\("local:"\) && isSshRuntime\(binding\.runtime\)[\s\S]*queued local-runtime chat cannot be replayed after this familiar moved to SSH/,
  "travel replay must fail closed across a local-to-SSH binding change",
);

assert.match(
  replay,
  /const payloadProjectRoot = stringValue\(payload\.projectRoot\)[\s\S]*const projectRoot = payloadProjectRoot \?\? runtimeCwd \?\? process\.cwd\(\)/,
  "chat replay should derive projectRoot from queued local runtime when payload omits it",
);

assert.match(
  replay,
  /const allowLocalRuntimeCwd = normalizeProjectRoot\(projectRoot\) === normalizeProjectRoot\(process\.cwd\(\)\)[\s\S]*await assertProjectRootAccess\(\{ familiarId \}, projectRoot, "chat", \{[\s\S]*allowUnregisteredRoot: allowLocalRuntimeCwd/,
  "chat replay should revalidate the current familiar project grant before spawning a hub session",
);

assert.doesNotMatch(
  replay,
  /travel-replay-output|replayAssistantStatus|collectReplayEventPages|\/api\/v1\/events|assistantText/,
  "baseline travel replay must not decode or mirror daemon assistant output",
);

console.log("travel-offline-replay.test.ts: ok");

assert.match(
  replay,
  /const placeholderRunId = stringValue\(payload\.placeholderRunId\);[\s\S]*?if \(placeholderRunId\) \{[\s\S]*?await updateFlowRun\(placeholderRunId, runFields\);[\s\S]*?if \(updated\) return;[\s\S]*?await recordFlowRun\(runFields\);/,
  "flow replay must update the queued placeholder run in place (mission iterations keep its id), falling back to a fresh record only for legacy/evicted items",
);

console.log("travel-offline-replay.test.ts: placeholder-run pin ok");
