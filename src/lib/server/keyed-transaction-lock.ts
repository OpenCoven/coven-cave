export type KeyedTransactionLock = <T>(
  key: string,
  operation: () => Promise<T>,
) => Promise<T>;

/** FIFO, process-local serialization for transactions that mutate one key. */
export function createKeyedTransactionLock(): KeyedTransactionLock {
  const queues = new Map<string, Promise<void>>();

  return async function withKeyedTransaction<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    queues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(key) === queued) queues.delete(key);
    }
  };
}

/** Shared by default Craft install/remove and Role equip/detach services. */
export const withCraftTransaction = createKeyedTransactionLock();

/** Serializes read-modify-write updates to each canonical ROLE.md. */
export const withRoleManifestTransaction = createKeyedTransactionLock();
