"use client";

import { advanceProjectsCacheGeneration } from "./use-projects-cache.ts";

export type ProjectRegistryMutation =
  | { kind: "refresh" }
  | { kind: "delete"; projectId: string };

export type ProjectRegistryMutationEvent = {
  generation: number;
  mutation: ProjectRegistryMutation;
};

const listeners = new Set<(event: ProjectRegistryMutationEvent) => void>();
let generation = 0;

export function subscribeProjectRegistryMutation(
  listener: (event: ProjectRegistryMutationEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeProjectRegistryReload(
  reload: (event: ProjectRegistryMutationEvent) => void | Promise<void>,
): () => void {
  return subscribeProjectRegistryMutation((event) => {
    void Promise.resolve(reload(event)).catch(() => {});
  });
}

export function emitProjectRegistryMutation(
  mutation: ProjectRegistryMutation = { kind: "refresh" },
): void {
  generation = advanceProjectsCacheGeneration();
  const event = { generation, mutation };
  for (const listener of [...listeners]) listener(event);
}

export function getProjectRegistryMutationGenerationForTests(): number {
  return generation;
}

export function resetProjectRegistryListenersForTests(): void {
  listeners.clear();
  generation = 0;
}
