declare global {
  var __caveResearchMissionActionLocks: Map<string, Promise<void>> | undefined;
}

/** Serialize all read-modify-write mission actions for one durable mission. */
export function withResearchMissionActionLock<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  globalThis.__caveResearchMissionActionLocks ??= new Map();
  const locks = globalThis.__caveResearchMissionActionLocks;
  const previous = locks.get(id) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return result;
}
