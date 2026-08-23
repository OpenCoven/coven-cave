/**
 * Serialize model/runtime intent writes that share a familiar binding. A
 * model PATCH and a runtime PATCH are both read-modify-write operations on
 * config, so letting them overlap can apply an older selection after a newer
 * one even when the UI ignores the stale response.
 */
export type ModelSelectionMutationQueue = {
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  whenIdle(): Promise<void>;
};

export function createModelSelectionMutationQueue(): ModelSelectionMutationQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.then(operation, operation);
      // Keep the chain alive after either outcome so one failed write cannot
      // permanently block later user selections.
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    whenIdle(): Promise<void> {
      return tail;
    },
  };
}
