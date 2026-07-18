"use client";

import { advanceProjectsCacheGeneration } from "./use-projects-cache.ts";

const listeners = new Set<(generation: number) => void>();
let generation = 0;

export function subscribeProjectRegistryMutation(listener: (generation: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeProjectRegistryReload(
  reload: (generation: number) => void | Promise<void>,
): () => void {
  return subscribeProjectRegistryMutation((nextGeneration) => {
    void Promise.resolve(reload(nextGeneration)).catch(() => {});
  });
}

export function emitProjectRegistryMutation(): void {
  generation = advanceProjectsCacheGeneration();
  for (const listener of [...listeners]) listener(generation);
}

export function getProjectRegistryMutationGenerationForTests(): number {
  return generation;
}

export function resetProjectRegistryListenersForTests(): void {
  listeners.clear();
  generation = 0;
}
