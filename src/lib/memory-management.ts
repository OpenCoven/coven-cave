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
    bodyHint: "",
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
