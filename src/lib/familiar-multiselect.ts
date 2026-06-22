// Pure selection logic for the automation familiar filter / picker. The empty
// set is the canonical "All" state. No React — unit-tested in isolation.

/**
 * Plain click (`multi=false`) selects only `id`. ⌘/Ctrl click (`multi=true`)
 * toggles `id` in/out of the current set; emptying the set returns the "All"
 * state (empty set).
 */
export function toggleFamiliarSelection(
  current: ReadonlySet<string>,
  id: string,
  multi: boolean,
): Set<string> {
  if (!multi) return new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The canonical "All" selection (empty set). */
export function selectAll(): Set<string> {
  return new Set();
}

/** True when nothing is explicitly selected — i.e. "All". */
export function isAllSelected(selected: ReadonlySet<string>): boolean {
  return selected.size === 0;
}

/**
 * Does an automation pass the filter? Empty filter → everything. Otherwise the
 * automation must be scoped to at least one selected familiar.
 */
export function automationMatchesFilter(
  automationFamiliars: readonly string[],
  filter: ReadonlySet<string>,
): boolean {
  if (filter.size === 0) return true;
  return automationFamiliars.some((id) => filter.has(id));
}
