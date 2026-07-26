import type { GitHubItem } from "@/lib/github-tasks";

/**
 * Free-text match for the GitHub activity list. Searches the item's title,
 * repo ("owner/name"), and number. Every whitespace-separated term must match
 * (AND), so "auth pr" narrows progressively. Empty query matches everything.
 *
 * (The type-only import above is erased at runtime, so this module is
 * dependency-free and runs in the plain test runner.)
 */
export function githubItemMatchesQuery(item: GitHubItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${item.title} ${item.repo} #${item.number ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}
