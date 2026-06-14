import {
  classifyProtection,
  detectStale,
  normalizeCovenEntry,
  normalizeFileEntry,
  type GroupBy,
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
  path: string;             // identity path: file fullPath | coven relative path (delete/display)
  contentPath?: string;     // absolute, allow-listed path the reader fetches; undefined → use excerpt
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
        contentPath: e.fullPath,
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
        contentPath: e.fullPath,
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

export type MemoryRowGroup = { key: string; label: string; rows: MemoryRow[] };

const TYPE_LABEL: Record<MemoryRowKind, string> = { agent: "Agent memories", file: "Files" };

function rowDateBucket(iso: string, now: number): { key: string; label: string } {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || !t) return { key: "z-unknown", label: "Unknown" };
  const ageDays = (now - t) / 86_400_000;
  if (ageDays < 1) return { key: "a-today", label: "Today" };
  if (ageDays < 7) return { key: "b-week", label: "This week" };
  if (ageDays < 31) return { key: "c-month", label: "This month" };
  return { key: "d-older", label: "Older" };
}

/**
 * Partition already-sorted rows into labelled groups for the list pane. Within-group
 * order is preserved from the input (i.e. the active sort still applies inside a group).
 * Groups are ordered by a sort key: date uses time buckets (Today→Older), others sort
 * alphabetically. `none` returns a single "All" group.
 */
export function groupMemoryRows(rows: MemoryRow[], by: GroupBy, now = Date.now()): MemoryRowGroup[] {
  if (by === "none") return [{ key: "all", label: "All", rows: [...rows] }];
  const map = new Map<string, MemoryRowGroup>();
  for (const r of rows) {
    let key: string;
    let label: string;
    if (by === "type") {
      key = r.kind;
      label = TYPE_LABEL[r.kind] ?? r.kind;
    } else if (by === "source") {
      key = r.sourceLabel;
      label = r.sourceLabel;
    } else if (by === "date") {
      const b = rowDateBucket(r.sortTime, now);
      key = b.key;
      label = b.label;
    } else {
      // "familiar": agent rows group under their familiar label; files bucket together.
      if (r.kind === "agent") {
        key = `a:${r.sourceLabel}`;
        label = r.sourceLabel;
      } else {
        key = "z:files";
        label = "Files";
      }
    }
    if (!map.has(key)) map.set(key, { key, label, rows: [] });
    map.get(key)!.rows.push(r);
  }
  return [...map.values()].sort((x, y) => x.key.localeCompare(y.key));
}
