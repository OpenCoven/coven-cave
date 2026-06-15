/**
 * Decide how many familiar avatars render inline in the dock vs. collapse into
 * the overflow popover. Pure + UI-agnostic so it can be unit-tested without a
 * DOM; the component feeds it a measured container width (ResizeObserver).
 *
 * `reservedWidth` accounts for the fixed controls that always render (the All
 * chip, the overflow ··· button, the + add button, and inter-item gaps).
 */
export function computeDockInlineCount(opts: {
  containerWidth: number;
  itemWidth: number;
  reservedWidth: number;
  total: number;
}): number {
  const { containerWidth, itemWidth, reservedWidth, total } = opts;
  if (total <= 0 || itemWidth <= 0) return 0;
  const available = containerWidth - reservedWidth;
  if (available <= 0) return 0;
  const fit = Math.floor(available / itemWidth);
  return Math.max(0, Math.min(total, fit));
}
