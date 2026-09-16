/**
 * One file-memory search policy for every surface (cave-she6o.1).
 *
 * The compact view (familiars-memory-utils' memoryMatches) and the
 * master-detail view (memory-rows' fileMatches) each grew their own copy of
 * this logic and had drifted. Both consume this module, so a field added or
 * removed here changes every surface together.
 *
 * The canonical half of this policy went with the canonical vault, which now
 * lives in the dedicated memory application. Its field list was a PRIVACY
 * boundary — summaries reached surfaces that must never leak where a memory
 * lives — so it was deleted with the store rather than left behind guarding
 * nothing.
 */

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
