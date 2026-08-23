export type ProjectScope =
  | { kind: "all-projects" }
  | { kind: "project"; projectId: string };

export type FamiliarScope =
  | { kind: "all-eligible" }
  | { kind: "selected"; familiarIds: readonly string[] };

export type ActingFamiliar =
  | { kind: "resolved"; familiarId: string }
  | { kind: "required" };

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].sort();
}

export function allProjectsScope(): ProjectScope {
  return { kind: "all-projects" };
}

export function projectScope(projectId: string): ProjectScope {
  const normalized = projectId.trim();
  return normalized ? { kind: "project", projectId: normalized } : allProjectsScope();
}

export function familiarScopeFromIds(ids: Iterable<string>): FamiliarScope {
  const familiarIds = uniqueIds(ids);
  return familiarIds.length > 0
    ? { kind: "selected", familiarIds }
    : { kind: "all-eligible" };
}

/**
 * Return the selected scope's familiar ids exactly as stored.
 *
 * This accessor is a passthrough for hand-constructed selected scopes and
 * intentionally does not re-normalize or reorder the array.
 */
export function familiarIdsForScope(scope: FamiliarScope): readonly string[] {
  return scope.kind === "selected" ? scope.familiarIds : [];
}

export function reconcileCrewForProject(
  current: FamiliarScope,
  eligibleFamiliarIds: Iterable<string>,
): FamiliarScope {
  if (current.kind === "all-eligible") return current;
  const eligible = new Set(uniqueIds(eligibleFamiliarIds));
  return familiarScopeFromIds(uniqueIds(current.familiarIds).filter((id) => eligible.has(id)));
}

export function resolveActingFamiliar(
  scope: FamiliarScope,
  eligibleFamiliarIds: Iterable<string>,
): ActingFamiliar {
  const eligible = new Set(uniqueIds(eligibleFamiliarIds));
  const candidates = scope.kind === "all-eligible"
    ? [...eligible]
    : uniqueIds(scope.familiarIds).filter((id) => eligible.has(id));
  return candidates.length === 1
    ? { kind: "resolved", familiarId: candidates[0]! }
    : { kind: "required" };
}
