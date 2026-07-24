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
  direction: -1 | 1,
): WorkspaceNavigationHistory<T> {
  const index = history.index + direction;
  if (index < 0 || index >= history.entries.length) return history;
  return { ...history, index };
}

export function canMoveWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  direction: -1 | 1,
): boolean {
  const index = history.index + direction;
  return index >= 0 && index < history.entries.length;
}

/** Restore a browser-backed entry without creating another history entry. */
export function restoreWorkspaceNavigation<T>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
  direction: -1 | 1 | null,
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
