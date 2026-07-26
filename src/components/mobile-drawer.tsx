"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export type MobileDrawerSlot = "nav" | "list" | null;

type MobileDrawerProps = {
  /** Which shell panel is currently open as a drawer, or null when closed. */
  open: MobileDrawerSlot;
  onClose: () => void;
};

/**
 * Mobile drawer overlay. Renders a portal-mounted backdrop and handles
 * Escape / tap-outside dismissal. The actual panel slide is CSS-driven by
 * the `[data-mobile-drawer]` attribute on `.shell-root` (see globals.css);
 * this component only owns the dismiss surface and the body-scroll lock.
 *
 * Mount once at shell-level — not per panel — because only one drawer is
 * open at a time and we only want one backdrop in the layer tree.
 */
export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevRootOverflow = document.documentElement.style.overflow;
    const prevRootOverscroll = document.documentElement.style.overscrollBehavior;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevRootOverflow;
      document.documentElement.style.overscrollBehavior = prevRootOverscroll;
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="mobile-drawer-backdrop"
      data-drawer-slot={open}
      onClick={onClose}
      role="presentation"
    />,
    document.body,
  );
}
