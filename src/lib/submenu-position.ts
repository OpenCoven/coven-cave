// Pure positioning math for cascading submenu flyouts (PopoverSubmenu).
// Kept free of DOM access so the flip/clamp behavior is unit-testable: the
// caller measures the trigger row, panel, and visual viewport and gets back
// absolute coordinates plus the side actually used.

export type SubmenuRect = { top: number; left: number; right: number; bottom: number };
export type SubmenuViewport = {
  /** Visual-viewport offsets (layout-viewport coords) — 0 when unavailable. */
  top: number;
  left: number;
  width: number;
  height: number;
};

export type SubmenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
  side: "right" | "left";
};

/** Gap between the parent panel edge and the flyout. */
export const SUBMENU_GAP = 4;
/** Viewport margin the flyout never crosses. */
export const SUBMENU_MARGIN = 8;
/** Vertical offset so the flyout's first item aligns with the trigger row
 *  (compensates the panel's body padding). */
export const SUBMENU_ALIGN = 6;

/**
 * Position a flyout beside its trigger row.
 *
 * - Prefers the right side; flips left when the right can't fit the panel and
 *   the left has more room.
 * - Horizontal + vertical clamp inside the visual viewport (margin 8px).
 * - Vertically top-aligns with the row, shifting up when the panel would
 *   overflow the bottom; maxHeight caps at the viewport band.
 */
export function computeSubmenuPosition(
  row: SubmenuRect,
  panel: { width: number; height: number },
  view: SubmenuViewport,
): SubmenuPosition {
  const viewRight = view.left + view.width;
  const viewBottom = view.top + view.height;

  const spaceRight = viewRight - row.right - SUBMENU_GAP - SUBMENU_MARGIN;
  const spaceLeft = row.left - view.left - SUBMENU_GAP - SUBMENU_MARGIN;
  const side: "right" | "left" =
    panel.width <= spaceRight || spaceRight >= spaceLeft ? "right" : "left";

  let left =
    side === "right" ? row.right + SUBMENU_GAP : row.left - SUBMENU_GAP - panel.width;
  // Clamp both edges inside the viewport regardless of side.
  left = Math.min(left, viewRight - panel.width - SUBMENU_MARGIN);
  left = Math.max(left, view.left + SUBMENU_MARGIN);

  const maxHeight = Math.max(view.height - 2 * SUBMENU_MARGIN, 120);
  const height = Math.min(panel.height, maxHeight);

  let top = row.top - SUBMENU_ALIGN;
  if (top + height > viewBottom - SUBMENU_MARGIN) top = viewBottom - SUBMENU_MARGIN - height;
  top = Math.max(top, view.top + SUBMENU_MARGIN);

  return { top: Math.round(top), left: Math.round(left), maxHeight: Math.round(maxHeight), side };
}
