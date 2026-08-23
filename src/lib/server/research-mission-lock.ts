import path from "node:path";
import {
  assertResearchMissionActionLockRoot,
  isValidResearchMissionId,
} from "./research-mission-store.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";

declare global {
  var __caveResearchMissionActionLocks: Map<string, Promise<void>> | undefined;
}

/**
 * Serialize all read-modify-write mission actions for one durable mission.
 * Node lacks portable openat/renameat coordination, so the private intent
 * directory provides the cross-process boundary; the runner's active-session
 * exclusion keeps familiar child writes out of the complete action window.
 */
export function withResearchMissionActionLock<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isValidResearchMissionId(id)) {
    return Promise.reject(new Error("invalid mission id"));
  }
  globalThis.__caveResearchMissionActionLocks ??= new Map();
  const locks = globalThis.__caveResearchMissionActionLocks;
  const previous = locks.get(id) ?? Promise.resolve();
  const run = async (): Promise<T> => {
    const root = await assertResearchMissionActionLockRoot();
    const release = await acquireProcessIntentLock({
      intentsDirectory: path.join(/* turbopackIgnore: true */ root, `${id}.locks`),
      label: `Research mission action ${id}`,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  };
  const result = previous.then(run, run);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return result;
}
