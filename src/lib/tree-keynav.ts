// Pure index math for roving keyboard navigation over a flattened, visible tree
// (the Code workspace project tree). The component computes the visible row
// order + depths from the DOM; this module owns the where-does-focus-go
// decisions so they're testable without a DOM.

/** Next focus index for the linear keys, clamped to [0, count-1]; null otherwise. */
export function nextVisibleIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(current + 1, count - 1);
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The nearest preceding row shallower than `current` — i.e. its parent — or null. */
export function parentIndexByDepth(depths: readonly number[], current: number): number | null {
  if (current < 0 || current >= depths.length) return null;
  const depth = depths[current];
  for (let j = current - 1; j >= 0; j--) {
    if (depths[j] < depth) return j;
  }
  return null;
}
