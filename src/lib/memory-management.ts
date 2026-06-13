// src/lib/memory-management.ts

/** Best-effort parse of Coven's human-relative timestamps ("5m ago") into
 *  epoch ms. Returns 0 for anything unrecognized so callers can sort it last. */
export function parseRelativeTime(label: string, now = Date.now()): number {
  const t = label.trim().toLowerCase();
  if (t === "just now" || t === "now") return now;
  const m = t.match(/^(\d+)\s*(s|m|h|d|w)\b/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return now - n * unit[m[2]];
}

export type ManagedSource = "coven" | "file";
export type ProtectionTier = "structural" | "bulk-protected" | "normal";

export type ManagedMemoryEntry = {
  /** Stable selection/dedup key — the absolute path. */
  key: string;
  /** Absolute fs path; the delete target. */
  path: string;
  source: ManagedSource;
  familiarId: string | null;
  title: string;
  /** sourceKind for files; "coven" for daemon entries. */
  kind: string;
  /** Epoch ms (best-effort), 0 if unknown. */
  updatedAt: number;
  /** Human label for display. */
  updatedAtLabel: string;
  size: number | null;
  /** Excerpt/body used by the stale scorer. */
  bodyHint: string;
  protection: ProtectionTier;
};

export type RawCovenEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
  source_context?: string;
};

export type RawFileEntry = {
  fullPath: string;
  relPath: string;
  title?: string;
  sourceKind: string;
  sourceKindLabel: string;
  rootLabel: string;
  size: number;
  modified: string;
  familiarId?: string | null;
  excerpt?: string;
};

export function normalizeCovenEntry(e: RawCovenEntry, now = Date.now()): ManagedMemoryEntry {
  return {
    key: e.path,
    path: e.path,
    source: "coven",
    familiarId: e.familiar_id || null,
    title: e.title,
    kind: "coven",
    updatedAt: parseRelativeTime(e.updated_at, now),
    updatedAtLabel: e.updated_at,
    size: null,
    bodyHint: e.excerpt ?? "",
    protection: classifyProtection(e.path),
  };
}

export function normalizeFileEntry(e: RawFileEntry): ManagedMemoryEntry {
  return {
    key: e.fullPath,
    path: e.fullPath,
    source: "file",
    familiarId: e.familiarId ?? null,
    title: e.title ?? e.relPath,
    kind: e.sourceKind,
    updatedAt: Number.isNaN(Date.parse(e.modified)) ? 0 : Date.parse(e.modified),
    updatedAtLabel: e.modified,
    size: e.size,
    bodyHint: e.excerpt ?? "",
    protection: classifyProtection(e.fullPath),
  };
}

/** Classify a memory file by deletion protection tier, purely from its path.
 *  - structural: machine-managed indices/artifacts; never deletable via UI.
 *  - bulk-protected: dream summaries; individually deletable, never in bulk.
 *  - normal: everything else. */
export function classifyProtection(filePath: string): ProtectionTier {
  const p = filePath.replace(/\\/g, "/");
  if (/\/MEMORY\.md$/i.test(p)) return "structural";
  if (/\/\.dreams\//.test(p)) return "structural";
  if (/\/memory\/dreaming\/(light|deep)\//.test(p)) return "bulk-protected";
  return "normal";
}

export function isStructuralMemoryPath(filePath: string): boolean {
  return classifyProtection(filePath) === "structural";
}

export type StaleVerdict = { stale: boolean; reason: string; confidence: number };
export interface StaleScorer {
  score(entry: ManagedMemoryEntry): StaleVerdict;
}

const NOT_STALE: StaleVerdict = { stale: false, reason: "", confidence: 0 };

/** Deterministic stale detection. AI scoring can later implement StaleScorer
 *  and be passed to detectStale() with no caller changes. */
export const ruleBasedStaleScorer: StaleScorer = {
  score(entry) {
    if (entry.protection === "structural") return NOT_STALE;
    const stripped = entry.bodyHint
      .replace(/^#.*$/gm, "")   // drop markdown headings
      .replace(/^[-*]\s*/gm, "") // drop list bullets
      .trim();
    if (/^no notable updates\.?$/i.test(stripped)) {
      return { stale: true, reason: "No notable updates", confidence: 0.95 };
    }
    if (stripped.length === 0) {
      // File entries set bodyHint="" because excerpts aren't loaded;
      // trust the file has content if it has a non-zero size.
      if (entry.size !== null && entry.size > 0) return NOT_STALE;
      return { stale: true, reason: "Empty entry", confidence: 0.8 };
    }
    if (stripped.length < 40 && /^\d{4}-\d{2}-\d{2}/.test(entry.title)) {
      return { stale: true, reason: "Trivial dated entry", confidence: 0.5 };
    }
    return NOT_STALE;
  },
};

export function detectStale(
  entry: ManagedMemoryEntry,
  scorer: StaleScorer = ruleBasedStaleScorer,
): StaleVerdict {
  return scorer.score(entry);
}

export type GroupBy = "none" | "familiar" | "source" | "type" | "date";
export type SortMode = "recent" | "oldest" | "name" | "size" | "staleFirst";
export type MemoryFacets = {
  familiarId?: string;
  source?: ManagedSource;
  kind?: string;
  staleOnly?: boolean;
};
export type MemoryGroup = { key: string; label: string; entries: ManagedMemoryEntry[] };

export function sortMemories(entries: ManagedMemoryEntry[], sort: SortMode): ManagedMemoryEntry[] {
  const out = [...entries];
  switch (sort) {
    case "recent": out.sort((x, y) => y.updatedAt - x.updatedAt); break;
    case "oldest": out.sort((x, y) => x.updatedAt - y.updatedAt); break;
    case "name": out.sort((x, y) => x.title.localeCompare(y.title)); break;
    case "size": out.sort((x, y) => (y.size ?? -1) - (x.size ?? -1)); break;
    case "staleFirst":
      out.sort((x, y) => Number(detectStale(y).stale) - Number(detectStale(x).stale));
      break;
  }
  return out;
}

function dateBucket(updatedAt: number, now = Date.now()): { key: string; label: string } {
  if (!updatedAt) return { key: "z-unknown", label: "Unknown" };
  const ageDays = (now - updatedAt) / 86_400_000;
  if (ageDays < 1) return { key: "a-today", label: "Today" };
  if (ageDays < 7) return { key: "b-week", label: "This week" };
  if (ageDays < 31) return { key: "c-month", label: "This month" };
  return { key: "d-older", label: "Older" };
}

export function groupMemories(entries: ManagedMemoryEntry[], by: GroupBy, now = Date.now()): MemoryGroup[] {
  if (by === "none") return [{ key: "all", label: "All", entries: [...entries] }];
  const map = new Map<string, MemoryGroup>();
  for (const e of entries) {
    let key: string;
    let label: string;
    if (by === "familiar") { key = e.familiarId ?? "—"; label = e.familiarId ?? "Unassigned"; }
    else if (by === "source") { key = e.source; label = e.source === "coven" ? "Coven" : "Files"; }
    else if (by === "type") { key = e.kind; label = e.kind; }
    else { const b = dateBucket(e.updatedAt, now); key = b.key; label = b.label; }
    if (!map.has(key)) map.set(key, { key, label, entries: [] });
    map.get(key)!.entries.push(e);
  }
  return [...map.values()].sort((x, y) => x.key.localeCompare(y.key));
}

export function filterMemories(entries: ManagedMemoryEntry[], query: string, facets: MemoryFacets): ManagedMemoryEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (facets.familiarId && e.familiarId !== facets.familiarId) return false;
    if (facets.source && e.source !== facets.source) return false;
    if (facets.kind && e.kind !== facets.kind) return false;
    if (facets.staleOnly && !detectStale(e).stale) return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      e.bodyHint.toLowerCase().includes(q) ||
      (e.familiarId ?? "").toLowerCase().includes(q)
    );
  });
}
