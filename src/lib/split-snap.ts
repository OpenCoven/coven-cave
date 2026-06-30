/**
 * split-snap — pure geometry for the drag-to-split secondary pane.
 *
 * The detail area can host a second "page" beside the primary surface. The
 * secondary pane is resizable, and — like a modern desktop window manager —
 * the divider *snaps* to a set of clean ratios (a third, a half, two thirds)
 * when the user drags close to them, and the pane closes entirely when dragged
 * past the near edge. All sizes are expressed as the **secondary pane's**
 * fraction of the split group (0..1), independent of which side it sits on.
 */

export type SnapPoint = {
  /** Secondary-pane fraction of the group (0..1). */
  ratio: number;
  /** Short glyph shown on the snap guide. */
  label: string;
};

/** The clean ratios the divider snaps to (secondary-pane fraction). */
export const SPLIT_SNAP_POINTS: readonly SnapPoint[] = [
  { ratio: 1 / 3, label: "⅓" },
  { ratio: 1 / 2, label: "½" },
  { ratio: 2 / 3, label: "⅔" },
];

/** The ratio the secondary opens at when a page is first dropped in. */
export const SPLIT_DEFAULT_RATIO = 1 / 2;

/** Below this secondary fraction, releasing the drag closes the split. */
export const SPLIT_CLOSE_RATIO = 0.16;

/** Secondary cannot grow beyond this (the primary keeps a usable column). */
export const SPLIT_MAX_RATIO = 0.84;

/** Snap engages when the divider is within this fraction of a snap point. */
export const SPLIT_SNAP_THRESHOLD = 0.04;

/** Clamp a secondary fraction into the open/usable range. */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_DEFAULT_RATIO;
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_CLOSE_RATIO, ratio));
}

/**
 * The snap point nearest `ratio` within `threshold`, or null when the divider
 * is in free space between snap points.
 */
export function nearestSnap(
  ratio: number,
  threshold: number = SPLIT_SNAP_THRESHOLD,
): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestDist = threshold;
  for (const point of SPLIT_SNAP_POINTS) {
    const dist = Math.abs(point.ratio - ratio);
    if (dist <= bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best;
}

export type SplitRelease =
  | { action: "close" }
  | { action: "snap"; ratio: number; label: string }
  | { action: "keep"; ratio: number };

/**
 * Resolve what should happen when the user *releases* the divider at `ratio`:
 * close the split if it was dragged past the near edge, snap to the nearest
 * clean ratio if within the threshold, otherwise keep the freely-chosen size.
 */
export function resolveSplitRelease(ratio: number): SplitRelease {
  if (ratio < SPLIT_CLOSE_RATIO) return { action: "close" };
  const snap = nearestSnap(ratio);
  if (snap) return { action: "snap", ratio: snap.ratio, label: snap.label };
  return { action: "keep", ratio: clampSplitRatio(ratio) };
}

/**
 * Where to draw the live snap guide while dragging, as a left-offset fraction
 * of the group (0..1). The divider sits at the boundary between the two panes;
 * `side` is the side the *secondary* pane occupies.
 */
export function dividerOffset(ratio: number, side: "left" | "right"): number {
  return side === "right" ? 1 - ratio : ratio;
}
