import type { GitHubItemTarget } from "@/lib/github-item-url";

export type PendingCodeGithubOpen = {
  tab: "prs" | "issues" | "reviews";
  target?: GitHubItemTarget;
  nonce: number;
};

let pending: PendingCodeGithubOpen | null = null;
const listeners = new Set<() => void>();

export function enqueuePendingCodeGithubOpen(open: PendingCodeGithubOpen): void {
  pending = open;
  for (const listener of listeners) listener();
}

export function clearPendingCodeGithubOpen(): void {
  if (pending === null) return;
  pending = null;
  for (const listener of listeners) listener();
}

export function getPendingCodeGithubOpen(): PendingCodeGithubOpen | null {
  return pending;
}

export function subscribePendingCodeGithubOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
