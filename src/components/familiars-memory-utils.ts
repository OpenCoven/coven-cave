import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import { canonicalMemoryMatches, fileMemoryMatches } from "@/lib/memory-search-policy";

export type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  sourceId: string;
  sourceKind: "coven-origin" | "external-harness" | "runtime";
  sourceKindLabel: string;
  rootPath: string;
  origin?: "coven";
  harnessId?: string;
  runtimeId?: string;
  sourceContext?: string;
  familiarId?: string;
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

export function memoryMatches(
  entry: CanonicalMemorySummary | FileMemoryEntry,
  query: string,
): boolean {
  // One policy for every memory surface (cave-she6o.1): canonical summaries
  // search only the safe field allowlist; files search the unified field
  // union. See src/lib/memory-search-policy.ts for the rationale.
  return "verification" in entry
    ? canonicalMemoryMatches(entry, query)
    : fileMemoryMatches(entry, query);
}
