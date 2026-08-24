export type SurfaceToolbarActionPlacement = "primary" | "visible" | "overflow";

export type SurfaceToolbarActionBase = {
  id: string;
  placement: SurfaceToolbarActionPlacement;
  disabled?: boolean;
  /** Whether the button is in a toggled/active state (sets aria-pressed). */
  active?: boolean;
};

export type PartitionedSurfaceToolbarActions<T extends SurfaceToolbarActionBase> = {
  primary: T | null;
  visible: T[];
  overflow: T[];
};

export const MAX_SURFACE_TOOLBAR_VISIBLE_ACTIONS = 3;

function duplicateActionIdError(id: string) {
  return new Error(
    `Duplicate action id "${id}" in SurfaceToolbar actions. Every action id must be unique so no item can silently disappear.`,
  );
}

function multiplePrimaryActionsError(firstId: string, secondId: string) {
  return new Error(
    `SurfaceToolbar accepts at most one primary action. Received both "${firstId}" and "${secondId}".`,
  );
}

export function partitionSurfaceToolbarActions<T extends SurfaceToolbarActionBase>(
  actions: readonly T[],
): PartitionedSurfaceToolbarActions<T> {
  const requestedVisible: T[] = [];
  let primary: T | null = null;
  const seenIds = new Set<string>();

  for (const action of actions) {
    if (seenIds.has(action.id)) throw duplicateActionIdError(action.id);
    seenIds.add(action.id);

    switch (action.placement) {
      case "primary":
        if (primary) throw multiplePrimaryActionsError(primary.id, action.id);
        primary = action;
        break;
      case "visible":
        requestedVisible.push(action);
        break;
      case "overflow":
        break;
      default:
        throw new Error(`Unsupported SurfaceToolbar placement "${String(action.placement)}".`);
    }
  }

  const visibleBudget = primary
    ? MAX_SURFACE_TOOLBAR_VISIBLE_ACTIONS - 1
    : MAX_SURFACE_TOOLBAR_VISIBLE_ACTIONS;
  const visible = primary
    ? [primary, ...requestedVisible.slice(0, visibleBudget)]
    : requestedVisible.slice(0, visibleBudget);
  const visibleIds = new Set(visible.map((action) => action.id));
  const overflow = actions.filter((action) => !visibleIds.has(action.id));

  return { primary, visible, overflow };
}
