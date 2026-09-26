/**
 * Where the inbox toast stack may start so it never covers a surface header's
 * controls (#5531).
 *
 * The stack is pinned top-right under the shell's own top band. Surface
 * headers sit right below that band and carry their actions on the right —
 * Tasks' Filter / New task / Select tasks / ⋯ — which is exactly the column
 * the stack occupies. Header bands wrap on narrow widths, so no static offset
 * clears them; the stack measures the shared header primitives instead.
 */

/** The shared surface header bands. A surface whose header is not one of these
 *  keeps the stack's default position under the shell band. */
export const TOAST_CLEARANCE_HEADER_SELECTOR = [
  ".ui-surface-toolbar",
  ".ui-view-header",
  ".surface-compact-header",
  ".gh-compact-header",
].join(", ");

/** Space between a header's bottom edge and the first toast. */
export const TOAST_HEADER_GAP_PX = 8;

export type ClearanceRect = { left: number; right: number; top: number; bottom: number };

/**
 * The lowest bottom edge (plus the gap) of any header band that shares the
 * stack's column, or null when none does. Only bands in the top third of the
 * viewport count: a header deep in a scrolled pane or a lower split is not the
 * chrome the stack is stacked against, and following it would push toasts off
 * screen.
 */
export function toastHeaderClearance(
  column: Pick<ClearanceRect, "left" | "right">,
  headers: readonly ClearanceRect[],
  viewportHeight: number,
): number | null {
  let lowest: number | null = null;
  for (const header of headers) {
    if (header.bottom <= header.top) continue;
    if (header.right <= column.left || header.left >= column.right) continue;
    if (header.top >= viewportHeight / 3) continue;
    if (lowest === null || header.bottom > lowest) lowest = header.bottom;
  }
  return lowest === null ? null : Math.ceil(lowest + TOAST_HEADER_GAP_PX);
}
