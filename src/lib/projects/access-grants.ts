/**
 * Pure helpers for the Access card's grant selection + bulk operations. The
 * grant model is binary (a familiar either holds a grant on a project or it
 * doesn't — POST/DELETE /api/project-grants); these helpers turn a checkbox
 * selection into the minimal set of real mutations, never inventing levels
 * the backend lacks.
 */

export type BulkGrantAction = "grant" | "revoke";

export type BulkGrantOp = { familiarId: string; next: boolean };

/**
 * The mutations a bulk action actually needs: no-ops (already granted /
 * already revoked) are skipped, and the supreme familiar is never mutated —
 * its access is implicit and can't be toggled.
 */
export function bulkGrantOps(
  selectedIds: readonly string[],
  grantedIds: ReadonlySet<string>,
  supremeFamiliarId: string | null,
  action: BulkGrantAction,
): BulkGrantOp[] {
  const next = action === "grant";
  const ops: BulkGrantOp[] = [];
  for (const familiarId of selectedIds) {
    if (familiarId === supremeFamiliarId) continue;
    if (grantedIds.has(familiarId) === next) continue;
    ops.push({ familiarId, next });
  }
  return ops;
}

/** Header summary: "None granted" / "3 granted · 1 always". */
export function accessSummary(grantedCount: number, supremeCount: number): string {
  const total = grantedCount + supremeCount;
  if (total === 0) return "None granted";
  const base = `${total} granted`;
  return supremeCount > 0 ? `${base} · ${supremeCount} always` : base;
}

/** Select-all toggles: everything selectable → clear; otherwise select all
 *  (the supreme familiar stays out — it has nothing to toggle). */
export function nextSelectAll(
  selectableIds: readonly string[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  return allSelected ? new Set() : new Set(selectableIds);
}
