export type WorkspaceNavigationHistory<T> = {
  entries: T[];
  index: number;
};

export function createWorkspaceNavigationHistory<T>(initial: T): WorkspaceNavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function pushWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
): WorkspaceNavigationHistory<T> {
  if (history.entries[history.index] === destination) return history;
  return {
    entries: [...history.entries.slice(0, history.index + 1), destination],
    index: history.index + 1,
  };
}

export function moveWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  direction: number,
): WorkspaceNavigationHistory<T> {
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (history.entries[index] !== history.entries[history.index]) return { ...history, index };
  }
  return history;
}

export function canMoveWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  direction: -1 | 1,
): boolean {
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    if (history.entries[index] !== history.entries[history.index]) return true;
  }
  return false;
}

/** Update the current browser-backed entry without adding a destination. */
export function replaceWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
): WorkspaceNavigationHistory<T> {
  if (history.entries[history.index] === destination) return history;
  const entries = [...history.entries];
  entries[history.index] = destination;
  return { ...history, entries };
}

/** Restore a browser-backed entry without creating another history entry. */
export function restoreWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
  direction: number | null,
): WorkspaceNavigationHistory<T> {
  if (direction !== null) {
    const moved = moveWorkspaceNavigation(history, direction);
    if (moved.entries[moved.index] === destination) return moved;
  }
  if (history.entries[history.index] === destination) return history;
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < history.entries.length; index += 1) {
    if (history.entries[index] !== destination || index === history.index) continue;
    const distance = Math.abs(index - history.index);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex === -1 ? createWorkspaceNavigationHistory(destination) : { ...history, index: closestIndex };
}
