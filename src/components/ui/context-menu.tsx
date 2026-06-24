"use client";

import { useRef, type ReactNode } from "react";

import { Popover } from "@/components/ui/popover";

/** Cursor position for an open context menu, or null when closed. */
export type ContextMenuState = { x: number; y: number } | null;

/**
 * Right-click context menu built on the shared Popover. Instead of anchoring to
 * a trigger element, it anchors to a 0-size element pinned at the cursor
 * position, so the menu opens where the user clicked. Inherits the Popover's
 * Escape / outside-click / viewport-clamp / focus-return behavior.
 *
 * Usage: keep a ContextMenuState, set it from `onContextMenu` (preventDefault +
 * `{ x: e.clientX, y: e.clientY }`), and render <ContextMenu> with PopoverItem
 * children.
 */
export function ContextMenu({
  state,
  onClose,
  ariaLabel,
  children,
}: {
  state: ContextMenuState;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        style={{ position: "fixed", left: state?.x ?? 0, top: state?.y ?? 0, width: 0, height: 0 }}
      />
      <Popover
        open={state !== null}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        anchorRef={anchorRef}
        placement="bottom-start"
        ariaLabel={ariaLabel}
      >
        <div role="menu" className="ui-popover-body">
          {children}
        </div>
      </Popover>
    </>
  );
}

/**
 * Build an `onContextMenu` handler that opens the menu at the cursor. Returns a
 * handler that preventDefaults the native menu and reports the click position.
 */
export function openContextMenuAt(set: (state: ContextMenuState) => void) {
  return (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
    e.preventDefault();
    set({ x: e.clientX, y: e.clientY });
  };
}
