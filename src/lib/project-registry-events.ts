"use client";

const listeners = new Set<() => void>();

export function subscribeProjectRegistryMutation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeProjectRegistryReload(reload: () => void | Promise<void>): () => void {
  return subscribeProjectRegistryMutation(() => {
    void Promise.resolve(reload()).catch(() => {});
  });
}

export function emitProjectRegistryMutation(): void {
  for (const listener of [...listeners]) listener();
}

export function resetProjectRegistryListenersForTests(): void {
  listeners.clear();
}
