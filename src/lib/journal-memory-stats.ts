import type { MemoryEntry } from "@/lib/server/memory-file-inventory";

export type JournalMemoryStats = {
  covenOrigin: number;
  externalRuntimes: number;
  runtimeMemory: number;
};

type MemoryStatsEntry = Pick<MemoryEntry, "sourceKind" | "familiarId">;

export type JournalDaySource = {
  relPath: string;
  fullPath: string;
  rootLabel: string;
};

type MemorySourceEntry = Pick<
  MemoryEntry,
  "sourceKind" | "familiarId" | "relPath" | "fullPath" | "rootLabel" | "modified"
>;

/** Local-day slug for an ISO timestamp (journal dates are local days). */
function localDateSlug(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The day's sources ("Memories Prototype" journal entry pane): memory files
 * whose mtime falls on the entry's local day, scoped to the familiar like the
 * stats block, newest-first, capped. Honest attribution — a file edited on a
 * later day moves to that day.
 */
export function journalDaySources(
  entries: MemorySourceEntry[],
  date: string,
  familiarId: string | null,
  limit = 6,
): JournalDaySource[] {
  const scoped = journalMemoryEntriesForFamiliar(entries, familiarId)
    .filter((entry) => localDateSlug(entry.modified) === date)
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  return scoped.slice(0, limit).map((entry) => ({
    relPath: entry.relPath,
    fullPath: entry.fullPath,
    rootLabel: entry.rootLabel,
  }));
}

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
