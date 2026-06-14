import {
  classifyProtection,
  detectStale,
  normalizeCovenEntry,
  normalizeFileEntry,
  type ProtectionTier,
  type RawCovenEntry,
  type RawFileEntry,
  type SortMode,
} from "./memory-management.ts";

export type MemoryRowKind = "agent" | "file";

export type MemoryRow = {
  rowId: string;            // "coven:<id>" | "file:<fullPath>"
  kind: MemoryRowKind;
  title: string;
  path: string;             // full path for reader fetch + delete
  sortTime: string;         // raw iso string
  size?: number;            // files only
  sourceLabel: string;      // familiar display name (resolved by caller) | sourceKindLabel
  stale: boolean;
  protection: ProtectionTier;
  excerpt?: string;         // agent rows only
};

type BuildArgs = {
  coven: RawCovenEntry[];
  files: RawFileEntry[];
  familiarFilter: string;
  query: string;
  sourceFilter: "all" | string;   // file sourceKind or "all"
  sortMode: SortMode;
  staleOnly: boolean;
  familiarLabel?: (id: string) => string;
  now?: number;
};

function baseName(p: string): string {
  const segs = p.split("/").filter(Boolean);
  return segs[segs.length - 1] ?? p;
}

function matches(row: MemoryRow, q: string): boolean {
  if (!q) return true;
  return [row.title, row.path, row.sourceLabel, row.excerpt ?? ""].join(" ").toLowerCase().includes(q);
}

export function buildMemoryRows(args: BuildArgs): MemoryRow[] {
  const now = args.now ?? Date.now();
  const q = args.query.trim().toLowerCase();

  const covenRows: MemoryRow[] = args.coven
    .filter((e) => e.familiar_id === args.familiarFilter)
    .map((e) => {
      const managed = normalizeCovenEntry(e, now);
      return {
        rowId: `coven:${e.id}`,
        kind: "agent" as MemoryRowKind,
        title: e.title,
        path: e.path,
        sortTime: e.updated_at,
        sourceLabel: args.familiarLabel ? args.familiarLabel(e.familiar_id) : e.familiar_id,
        stale: detectStale(managed).stale,
        protection: classifyProtection(e.path),
        excerpt: e.excerpt,
      };
    });

  const fileRows: MemoryRow[] = args.files
    .filter((e) => args.sourceFilter === "all" || e.sourceKind === args.sourceFilter)
    .map((e) => {
      const managed = normalizeFileEntry(e);
      return {
        rowId: `file:${e.fullPath}`,
        kind: "file" as MemoryRowKind,
        title: baseName(e.relPath),
        path: e.fullPath,
        sortTime: e.modified,
        size: e.size,
        sourceLabel: e.sourceKindLabel,
        stale: detectStale(managed).stale,
        protection: classifyProtection(e.fullPath),
      };
    });

  let rows = [...covenRows, ...fileRows];
  if (q) rows = rows.filter((r) => matches(r, q));
  if (args.staleOnly) rows = rows.filter((r) => r.stale);

  const cmp: Record<SortMode, (a: MemoryRow, b: MemoryRow) => number> = {
    recent: (a, b) => (a.sortTime < b.sortTime ? 1 : a.sortTime > b.sortTime ? -1 : 0),
    oldest: (a, b) => (a.sortTime > b.sortTime ? 1 : a.sortTime < b.sortTime ? -1 : 0),
    name: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => (b.size ?? 0) - (a.size ?? 0),
    staleFirst: (a, b) => Number(b.stale) - Number(a.stale),
  };
  return rows.sort(cmp[args.sortMode]);
}
