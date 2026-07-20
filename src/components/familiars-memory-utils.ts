import type { CovenMemoryEntry } from "@/components/familiars-view-stats";

export type FileMemoryEntry = {
  root: string; rootLabel: string; relPath: string; fullPath: string; size: number; modified: string; sourceId: string; sourceKind: "coven-origin" | "external-harness" | "runtime"; sourceKindLabel: string; rootPath: string; origin?: "coven"; harnessId?: string; runtimeId?: string; sourceContext?: string; familiarId?: string;
};

export function compactPath(path: string): string {
  const collapsed = path.replace(/^\/Users\/[^/]+/, "~");
  const THRESHOLD = 52;
  if (collapsed.length <= THRESHOLD) return collapsed;
  const segments = collapsed.split("/").filter(Boolean);
  if (segments.length <= 4) return collapsed;
  const first = collapsed.startsWith("~") ? "~" : `/${segments[0]}`;
  return `${first}/…/${segments.slice(-3).join("/")}`;
}

export function fileBase(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function fileDir(fullPath: string): string {
  const base = fileBase(fullPath);
  const parent = fullPath.slice(0, Math.max(0, fullPath.length - base.length)).replace(/\/$/, "");
  return parent ? compactPath(parent) : "";
}

export function formatBytes(n: number | undefined): string {
  if (!n || n < 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function memoryMatches(entry: CovenMemoryEntry | FileMemoryEntry, query: string): boolean {
  if (!query) return true;
  const values = "familiar_id" in entry
    ? [entry.title, entry.excerpt ?? "", entry.familiar_id, entry.path, entry.source_context ?? ""]
    : [entry.rootLabel, entry.sourceKindLabel, entry.harnessId ?? "", entry.runtimeId ?? "", entry.origin ?? "", entry.familiarId ?? "", entry.relPath, entry.fullPath, entry.sourceContext ?? ""];
  return values.some((value) => value.toLowerCase().includes(query));
}
