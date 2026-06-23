import type { MemoryEntry } from "@/lib/server/memory-file-inventory";

export type JournalMemoryStats = {
  covenOrigin: number;
  externalRuntimes: number;
  runtimeMemory: number;
};

type MemoryStatsEntry = Pick<MemoryEntry, "sourceKind" | "familiarId">;

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function journalMemoryEntriesForFamiliar<T extends MemoryStatsEntry>(
  entries: T[],
  familiarId: string | null,
): T[] {
  if (!familiarId) return entries;
  return entries.filter((entry) => entry.familiarId === familiarId);
}

export function buildJournalMemoryStats(
  entries: MemoryStatsEntry[],
  familiarId: string | null,
): JournalMemoryStats {
  const scoped = journalMemoryEntriesForFamiliar(entries, familiarId);
  return {
    covenOrigin: scoped.filter((entry) => entry.sourceKind === "coven-origin").length,
    externalRuntimes: scoped.filter((entry) => entry.sourceKind === "external-harness").length,
    runtimeMemory: scoped.filter((entry) => entry.sourceKind === "runtime").length,
  };
}

export function buildJournalMemoryContext(
  date: string,
  familiarId: string | null,
  stats: JournalMemoryStats,
): string {
  const who = familiarId ? `${familiarId} memory` : "familiar memory";
  const total = stats.covenOrigin + stats.externalRuntimes + stats.runtimeMemory;
  if (total === 0) return `${date}: ${who} has no indexed memory files.`;
  return [
    `${date}: ${who} spans ${plural(stats.covenOrigin, "Coven origin file")}, ` +
      `${plural(stats.externalRuntimes, "external runtime file")}, and ` +
      `${plural(stats.runtimeMemory, "runtime memory file")}.`,
    "Reflect only on files attributed to the selected familiar; ignore shared, global, or unattributed memory files.",
  ].join("\n");
}
