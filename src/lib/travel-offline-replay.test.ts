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
  /const projectRoot = stringValue\(payload\.projectRoot\) \?\? runtimeCwd \?\? process\.cwd\(\)/,
  "chat replay should derive projectRoot from queued local runtime when payload omits it",
);

assert.match(
  replay,
  /await assertProjectRootAccess\(\{ familiarId \}, projectRoot, "chat"\)/,
  "chat replay should revalidate the current familiar project grant before spawning a hub session",
);

console.log("travel-offline-replay.test.ts: ok");
