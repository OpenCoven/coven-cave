import type { CanonicalMemorySummary } from "./canonical-memory.ts";

/**
 * One familiar-memory search policy for every surface (cave-she6o.1).
 *
 * The compact view (familiars-memory-utils' memoryMatches) and the
 * master-detail view (memory-rows' canonicalMatches/fileMatches) each grew
 * their own copy of this logic; the canonical field lists agreed but the
 * match semantics and file field sets had drifted. Both now consume this
 * module, so a field added or removed here changes every surface together.
 */

/**
 * The ONLY fields canonical search may see. Storage paths, raw bodies, and
 * private detail fields are deliberately absent: canonical summaries reach
 * surfaces that must never leak where a memory lives or what its unredacted
 * content says. Widening this list is a privacy decision, not a convenience —
 * memory-search-policy.test.ts proxies an entry to prove no other property
 * is even read.
 */
export function canonicalSearchFields(entry: CanonicalMemorySummary): string[] {
  return [
    entry.title,
    entry.excerpt,
    entry.familiarId,
    entry.source.kind,
    entry.source.label,
    entry.privacy.classification ?? "",
    entry.verification.state,
  ];
}

/**
 * Per-field substring match. Deliberately NOT a joined-string match: joining
 * with spaces let a query span two adjacent fields ("excerpt-end familiarId")
 * and match rows no single field justified — one of the drifts this module
 * retires.
 */
export function canonicalMemoryMatches(entry: CanonicalMemorySummary, query: string): boolean {
  if (!query) return true;
  return canonicalSearchFields(entry).some((value) => value.toLowerCase().includes(query));
}

/**
 * Structural view of a searchable file entry: covers memory-rows'
 * RawFileEntry and the components' FileMemoryEntry without importing either.
 */
export type FileSearchableEntry = {
  relPath: string;
  fullPath: string;
  sourceKind: string;
  sourceKindLabel: string;
  rootLabel: string;
  title?: string | null;
  excerpt?: string | null;
  familiarId?: string | null;
  harnessId?: string | null;
  runtimeId?: string | null;
  origin?: string | null;
  sourceContext?: string | null;
};

/**
 * File search fields: the union of what the two views historically matched
 * (the master-detail view knew title/excerpt/sourceKind; the compact view
 * knew harnessId/runtimeId/origin/sourceContext), so no previously-findable
 * file becomes unfindable in either view. Files are local artifacts the user
 * already owns — paths are searchable here, unlike canonical summaries.
 */
export function fileSearchFields(entry: FileSearchableEntry): string[] {
  return [
    entry.title ?? "",
    entry.excerpt ?? "",
    entry.relPath,
    entry.fullPath,
    entry.sourceKind,
    entry.sourceKindLabel,
    entry.rootLabel,
    entry.familiarId ?? "",
    entry.harnessId ?? "",
    entry.runtimeId ?? "",
    entry.origin ?? "",
    entry.sourceContext ?? "",
  ];
}

export function fileMemoryMatches(entry: FileSearchableEntry, query: string): boolean {
  if (!query) return true;
  return fileSearchFields(entry).some((value) => value.toLowerCase().includes(query));
}
