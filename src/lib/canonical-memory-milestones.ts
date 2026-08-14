import type { CanonicalMemoryListLoad } from "./canonical-memory-resources.ts";

/**
 * Count canonical summaries for renown-derived milestone checks.
 * `null` means the list is unavailable, so callers must defer tier awards.
 */
export function canonicalMemoryCountsForMilestones(
  memory: CanonicalMemoryListLoad,
): Map<string, number> | null {
  if (memory.state !== "ready") return null;
  const counts = new Map<string, number>();
  for (const entry of memory.entries) {
    counts.set(entry.familiarId, (counts.get(entry.familiarId) ?? 0) + 1);
  }
  return counts;
}
