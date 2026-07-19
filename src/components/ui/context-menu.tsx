"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { Popover, PopoverBody, activatedMenuItem } from "@/components/ui/popover";

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
  closeOnSelect = false,
}: {
  state: ContextMenuState;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
  closeOnSelect?: boolean;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Capture the pre-open active element before the menu's own autofocus runs so
  // close can restore focus to the invoking row/project rather than to a menu
  // item that will unmount with the popover.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusPendingRef = useRef(false);
  const open = state !== null;

  useLayoutEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    restoreFocusPendingRef.current = true;
  }, [open]);

  useEffect(() => {
    if (open) return;
    if (!restoreFocusPendingRef.current) return;
    restoreFocusPendingRef.current = false;
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    const active = document.activeElement as HTMLElement | null;
    if (canRestoreFocus(el) && (!active || active === document.body)) el.focus();
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        style={{ position: "fixed", left: state?.x ?? 0, top: state?.y ?? 0, width: 0, height: 0 }}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) return;
          if (!next) onClose();
        }}
        anchorRef={anchorRef}
        placement="bottom-start"
        ariaLabel={ariaLabel}
      >
        <PopoverBody
          role="menu"
          ariaLabel={ariaLabel}
          onClick={(e) => {
            const shouldCloseOnSelect = closeOnSelect && Boolean(activatedMenuItem(e.target));
            if (shouldCloseOnSelect) onClose();
          }}
        >
          {children}
        </PopoverBody>
      </Popover>
    </>
  );
}

function canRestoreFocus(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || typeof el.focus !== "function") return false;
  if (el.matches("[disabled], [aria-disabled='true'], [hidden], [inert]")) return false;
  return (
    el.matches('[tabindex], a[href], button, input, select, textarea, summary, iframe, [contenteditable="true"]')
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
