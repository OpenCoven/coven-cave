import { fileMemoryMatches } from "./memory-search-policy.ts";
import {
  classifyProtection,
  detectStale,
  normalizeFileEntry,
  type GroupBy,
  type ProtectionTier,
  type RawFileEntry,
  type SortMode,
} from "./memory-management.ts";

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

/** Memory rows are files. The canonical-vault variant went with the vault
 *  itself — that store lives in the dedicated memory application now. */
export type MemoryRow = FileMemoryRow;
export type MemoryFeedState = "loading" | "ready" | "error";
export type MemoryListPresentation =
  | "loading"
  | "rows"
  | "empty"
  | "unavailable";

type BuildArgs = {
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
  filesState: MemoryFeedState;
  rowCount: number;
}): MemoryListPresentation {
  if (input.rowCount > 0) return "rows";
  if (input.filesState === "loading") return "loading";
  if (input.filesState === "ready") return "empty";
  return "unavailable";
}

export function reconcileMemorySelection(input: {
  selectedRowId: string | null;
  rowIds: readonly string[];
  filesState: MemoryFeedState;
}): string | null {
  const { selectedRowId } = input;
  if (!selectedRowId || input.rowIds.includes(selectedRowId)) {
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

function baseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}


export function buildMemoryRows(args: BuildArgs): MemoryRow[] {
  const query = args.query.trim().toLowerCase();

  const fileRows: FileMemoryRow[] = args.files
    .filter(
      (entry) =>
        args.sourceFilter === "all" || entry.sourceKind === args.sourceFilter,
    )
    .filter((entry) => entry.familiarId === args.familiarFilter)
    .filter((entry) => fileMemoryMatches(entry, query))
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

  const rows: MemoryRow[] = args.staleOnly
    ? fileRows.filter((row) => row.stale)
    : fileRows;
  const size = (row: MemoryRow): number => row.size;
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
    } else {
      key = "z:files";
      label = "Files";
    }
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
