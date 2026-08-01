import type { CodeTopTab } from "./code-surface.ts";
import type { GitHubItemTarget } from "./github-item-url.ts";

export type PendingCodeNavigation =
  | { kind: "tab"; topTab: CodeTopTab; nonce: number }
  | { kind: "github-item"; target: GitHubItemTarget; nonce: number };

export function codeTopTabForGitHubTarget(
  target: GitHubItemTarget,
): Extract<CodeTopTab, "prs" | "issues"> {
  return target.kind === "pr" ? "prs" : "issues";
}

let pending: PendingCodeNavigation | null = null;
const listeners = new Set<() => void>();

export function enqueuePendingCodeNavigation(request: PendingCodeNavigation): void {
  pending = request;
  for (const listener of listeners) listener();
}

export function acknowledgePendingCodeNavigation(nonce: number): void {
  if (pending?.nonce !== nonce) return;
  pending = null;
  for (const listener of listeners) listener();
}

export function clearPendingCodeNavigation(): void {
  if (pending === null) return;
  pending = null;
  for (const listener of listeners) listener();
}

export function getPendingCodeNavigation(): PendingCodeNavigation | null {
  return pending;
}

export function subscribePendingCodeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
