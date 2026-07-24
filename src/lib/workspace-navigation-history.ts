export type WorkspaceNavigationHistory<T extends string> = {
  entries: T[];
  index: number;
};

export function createWorkspaceNavigationHistory<T extends string>(initial: T): WorkspaceNavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function pushWorkspaceNavigation<T extends string>(
  history: WorkspaceNavigationHistory<T>,
  destination: T,
): WorkspaceNavigationHistory<T> {
  if (history.entries[history.index] === destination) return history;
  return {
    entries: [...history.entries.slice(0, history.index + 1), destination],
    index: history.index + 1,
  };
}

export function moveWorkspaceNavigation<T extends string>(
  history: WorkspaceNavigationHistory<T>,
  direction: -1 | 1,
): WorkspaceNavigationHistory<T> {
  const index = history.index + direction;
  if (index < 0 || index >= history.entries.length) return history;
  return { ...history, index };
}

export function canMoveWorkspaceNavigation<T extends string>(
  history: WorkspaceNavigationHistory<T>,
  direction: -1 | 1,
): boolean {
  const index = history.index + direction;
  return index >= 0 && index < history.entries.length;
}
