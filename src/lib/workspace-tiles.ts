export const MAX_WORKSPACE_TILES = 4;
export const MAX_SECONDARY_WORKSPACE_TILES = MAX_WORKSPACE_TILES - 1;

export type WorkspaceTileVariant = "single" | "split" | "triad" | "quad";

export function addSecondaryWorkspaceTile<T>(
  tiles: readonly T[],
  next: T,
  keyOf: (tile: T) => string,
): T[] {
  const nextKey = keyOf(next);
  const withoutDuplicate = tiles.filter((tile) => keyOf(tile) !== nextKey);
  if (withoutDuplicate.length >= MAX_SECONDARY_WORKSPACE_TILES) {
    return [...withoutDuplicate.slice(0, MAX_SECONDARY_WORKSPACE_TILES - 1), next];
  }
  return [...withoutDuplicate, next];
}

export function removeSecondaryWorkspaceTile<T>(
  tiles: readonly T[],
  key: string,
  keyOf: (tile: T) => string,
): T[] {
  return tiles.filter((tile) => keyOf(tile) !== key);
}

export function workspaceTileVariant(count: number): WorkspaceTileVariant {
  if (count <= 1) return "single";
  if (count === 2) return "split";
  if (count === 3) return "triad";
  return "quad";
}
