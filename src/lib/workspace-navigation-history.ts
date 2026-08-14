export type WorkspaceNavigationHistory<T> = {
  entries: T[];
  index: number;
};

/**
 * How two entries are compared for sameness.
 *
 * The stack originally held primitives (a `CaveMode`, a session id) and
 * compared them with `===`. Levels below the mode — a tab strip's scope, a
 * settings section — want richer entries, so every comparison routes through
 * a key function. The default returns the entry itself, which makes `===` the
 * comparison again: existing primitive call sites are unchanged.
 */
export type NavigationKeyOf<T> = (entry: T) => unknown;

const identityKey = <T,>(entry: T): unknown => entry;

export function createWorkspaceNavigationHistory<T>(initial: T): WorkspaceNavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function pushWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
  keyOf: NavigationKeyOf<T> = identityKey,
): WorkspaceNavigationHistory<T> {
  if (keyOf(history.entries[history.index]) === keyOf(destination)) return history;
  return {
    entries: [...history.entries.slice(0, history.index + 1), destination],
    index: history.index + 1,
  };
}

export function moveWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  direction: number,
  keyOf: NavigationKeyOf<T> = identityKey,
): WorkspaceNavigationHistory<T> {
  const current = keyOf(history.entries[history.index]);
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (keyOf(history.entries[index]) !== current) return { ...history, index };
  }
  return history;
}

export function canMoveWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  direction: -1 | 1,
  keyOf: NavigationKeyOf<T> = identityKey,
): boolean {
  const current = keyOf(history.entries[history.index]);
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (keyOf(history.entries[index]) !== current) return true;
  }
  return false;
}

/** Update the current browser-backed entry without adding a destination. */
export function replaceWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
  keyOf: NavigationKeyOf<T> = identityKey,
): WorkspaceNavigationHistory<T> {
  if (keyOf(history.entries[history.index]) === keyOf(destination)) return history;
  const entries = [...history.entries];
  entries[history.index] = destination;
  return { ...history, entries };
}

/** Restore a browser-backed entry without creating another history entry. */
export function restoreWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
  direction: number | null,
  keyOf: NavigationKeyOf<T> = identityKey,
): WorkspaceNavigationHistory<T> {
  const target = keyOf(destination);
  if (direction !== null) {
    const moved = moveWorkspaceNavigation(history, direction, keyOf);
    if (keyOf(moved.entries[moved.index]) === target) return moved;
  }
  if (keyOf(history.entries[history.index]) === target) return history;
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < history.entries.length; index += 1) {
    if (keyOf(history.entries[index]) !== target || index === history.index) continue;
    const distance = Math.abs(index - history.index);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex === -1 ? createWorkspaceNavigationHistory(destination) : { ...history, index: closestIndex };
}
