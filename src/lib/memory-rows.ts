import type { CanonicalMemorySummary } from "./canonical-memory.ts";
import {
  classifyProtection,
  detectStale,
  normalizeFileEntry,
  type GroupBy,
  type ProtectionTier,
  type RawFileEntry,
  type SortMode,
} from "./memory-management.ts";

export type CanonicalMemoryRow = {
  kind: "canonical";
  rowId: `coven:${string}`;
  memoryId: string;
  title: string;
  sortTime: string;
  sourceLabel: string;
  excerpt: string;
  privacy: CanonicalMemorySummary["privacy"];
  verification: CanonicalMemorySummary["verification"];
  stale: false;
};

export type FileMemoryRow = {
  kind: "file";
  rowId: `file:${string}`;
  title: string;
  path: string;
  contentPath: string;
  sortTime: string;
  size: number;
  sourceLabel: string;
  stale: boolean;
  protection: ProtectionTier;
};

export type MemoryRow = CanonicalMemoryRow | FileMemoryRow;
export type MemoryFeedState = "loading" | "ready" | "error";
export type MemoryListPresentation =
  | "loading"
  | "rows"
  | "empty"
  | "unavailable";

type BuildArgs = {
  canonical: CanonicalMemorySummary[];
  files: RawFileEntry[];
  familiarFilter: string;
  query: string;
  sourceFilter: "all" | string;
  sortMode: SortMode;
  staleOnly: boolean;
  familiarLabel?: (id: string) => string;
  now?: number;
};

export function memoryListPresentation(input: {
  canonicalState: MemoryFeedState;
  filesState: MemoryFeedState;
  rowCount: number;
}): MemoryListPresentation {
  if (input.rowCount > 0) return "rows";
  if (input.canonicalState === "loading" || input.filesState === "loading") {
    return "loading";
  }
  if (input.canonicalState === "ready" && input.filesState === "ready") {
    return "empty";
  }
  return "unavailable";
}

export function reconcileMemorySelection(input: {
  selectedRowId: string | null;
  rowIds: readonly string[];
  canonicalState: MemoryFeedState;
  filesState: MemoryFeedState;
}): string | null {
  const { selectedRowId } = input;
  if (!selectedRowId || input.rowIds.includes(selectedRowId)) {
    return selectedRowId;
  }
  if (
    selectedRowId.startsWith("coven:") &&
    input.canonicalState === "loading"
  ) {
    return selectedRowId;
  }
  if (
    selectedRowId.startsWith("file:") &&
    input.filesState === "loading"
  ) {
    return selectedRowId;
  }
  return null;
}

export function excludeMissingCanonicalMemory<T extends { id: string }>(
  entries: readonly T[],
  memoryId: string | null,
): T[] {
  return memoryId
    ? entries.filter((entry) => entry.id !== memoryId)
    : [...entries];
}

export function reconcileMissingCanonicalRefresh<T extends { id: string }>(
  input: {
    missingMemoryId: string | null;
    notice: string | null;
    refreshState: "ready" | "error";
    entries: readonly T[];
  },
): { missingMemoryId: string | null; notice: string | null } {
  if (input.refreshState === "error") {
    return {
      missingMemoryId: input.missingMemoryId,
      notice: input.notice,
    };
  }
  if (
    input.missingMemoryId !== null &&
    input.entries.some((entry) => entry.id === input.missingMemoryId)
  ) {
    return {
      missingMemoryId: input.missingMemoryId,
      notice: input.notice,
    };
  }
  return {
    missingMemoryId: null,
    notice: null,
  };
}

function baseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function canonicalMatches(entry: CanonicalMemorySummary, query: string): boolean {
  if (!query) return true;
  return [
    entry.title,
    entry.excerpt,
    entry.familiarId,
    entry.source.kind,
    entry.source.label,
    entry.privacy.classification ?? "",
    entry.verification.state,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function fileMatches(entry: RawFileEntry, query: string): boolean {
  if (!query) return true;
  return [
    entry.title ?? "",
    entry.relPath,
    entry.fullPath,
    entry.sourceKind,
    entry.sourceKindLabel,
    entry.rootLabel,
    entry.familiarId ?? "",
    entry.excerpt ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function buildMemoryRows(args: BuildArgs): MemoryRow[] {
  const query = args.query.trim().toLowerCase();

  const canonicalRows: CanonicalMemoryRow[] = args.canonical
    .filter((entry) => entry.familiarId === args.familiarFilter)
    .filter((entry) => canonicalMatches(entry, query))
    .map((entry) => ({
      kind: "canonical",
      rowId: `coven:${entry.id}`,
      memoryId: entry.id,
      title: entry.title,
      sortTime: entry.updatedAt,
      sourceLabel: args.familiarLabel
        ? args.familiarLabel(entry.familiarId)
        : entry.familiarId,
      excerpt: entry.excerpt,
      privacy: entry.privacy,
      verification: entry.verification,
      stale: false,
    }));

  const fileRows: FileMemoryRow[] = args.files
    .filter(
      (entry) =>
        args.sourceFilter === "all" || entry.sourceKind === args.sourceFilter,
    )
    .filter((entry) => entry.familiarId === args.familiarFilter)
    .filter((entry) => fileMatches(entry, query))
    .map((entry) => {
      const managed = normalizeFileEntry(entry);
      return {
        kind: "file",
        rowId: `file:${entry.fullPath}`,
        title: baseName(entry.relPath),
        path: entry.fullPath,
        contentPath: entry.fullPath,
        sortTime: entry.modified,
        size: entry.size,
        sourceLabel: entry.sourceKindLabel,
        stale: detectStale(managed).stale,
        protection: classifyProtection(entry.fullPath),
      };
    });

  const rows: MemoryRow[] = args.staleOnly ? fileRows.filter((row) => row.stale) : [
    ...canonicalRows,
    ...fileRows,
  ];
  const size = (row: MemoryRow): number => row.kind === "file" ? row.size : 0;
  const compare: Record<SortMode, (a: MemoryRow, b: MemoryRow) => number> = {
    recent: (a, b) =>
      a.sortTime < b.sortTime ? 1 : a.sortTime > b.sortTime ? -1 : 0,
    oldest: (a, b) =>
      a.sortTime > b.sortTime ? 1 : a.sortTime < b.sortTime ? -1 : 0,
    name: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => size(b) - size(a),
    staleFirst: (a, b) => Number(b.stale) - Number(a.stale),
  };
  return rows.sort(compare[args.sortMode]);
}

export type MemoryRowGroup = {
  key: string;
  label: string;
  rows: MemoryRow[];
};

const TYPE_LABEL = {
  canonical: "Familiar memories",
  file: "Files",
} satisfies Record<MemoryRow["kind"], string>;

function rowDateBucket(
  iso: string,
  now: number,
): { key: string; label: string } {
  const time = Date.parse(iso);
  if (Number.isNaN(time) || !time) return { key: "z-unknown", label: "Unknown" };
  const ageDays = (now - time) / 86_400_000;
  if (ageDays < 1) return { key: "a-today", label: "Today" };
  if (ageDays < 7) return { key: "b-week", label: "This week" };
  if (ageDays < 31) return { key: "c-month", label: "This month" };
  return { key: "d-older", label: "Older" };
}

export function groupMemoryRows(
  rows: MemoryRow[],
  by: GroupBy,
  now = Date.now(),
): MemoryRowGroup[] {
  if (by === "none") return [{ key: "all", label: "All", rows: [...rows] }];
  const groups = new Map<string, MemoryRowGroup>();
  for (const row of rows) {
    let key: string;
    let label: string;
    if (by === "type") {
      key = row.kind;
      label = TYPE_LABEL[row.kind];
    } else if (by === "source") {
      key = row.sourceLabel;
      label = row.sourceLabel;
    } else if (by === "date") {
      ({ key, label } = rowDateBucket(row.sortTime, now));
    } else if (row.kind === "canonical") {
      key = `a:${row.sourceLabel}`;
      label = row.sourceLabel;
    } else {
      key = "z:files";
      label = "Files";
    }
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
