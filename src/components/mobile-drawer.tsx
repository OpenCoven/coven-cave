"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/modal";
import { acquirePageScrollLock } from "@/lib/modal-environment";
import { useFocusTrap } from "@/lib/use-focus-trap";

export type MobileDrawerSlot = "nav" | "list" | "right-chat" | null;

type MobileDrawerProps = {
  /** Which shell panel is currently open as a drawer, or null when closed. */
  open: MobileDrawerSlot;
  onClose: () => void;
  /**
   * The global right Chat panel's mobile/tablet modal content. Stays
   * portal-mounted whenever this is non-null, even while `open` is not
   * "right-chat" — closing only hides/inerts it (aria-hidden + hidden +
   * inert), never unmounts it, so ChatRouter's transcript/stream/scroll
   * position/draft survive a close exactly like the desktop persistent
   * panel. See right-chat-panel.tsx's own "truthful accessibility, not a
   * mount gate" rationale for the same pattern on the desktop side.
   */
  rightChat?: ReactNode;
};

/**
 * Mobile drawer overlay. Renders a portal-mounted backdrop and handles
 * Escape / tap-outside dismissal for the nav/list drawers, plus a dedicated
 * accessible modal slot for the global right Chat panel. The nav/list slide
 * itself is CSS-driven by the `[data-mobile-drawer]` attribute on
 * `.shell-root` (see globals.css); this component owns the dismiss surface,
 * the body-scroll lock, and — for the right Chat modal — the focus trap and
 * background inert state.
 *
 * Mount once at shell-level — not per panel — because only one drawer is
 * open at a time and we only want one backdrop in the layer tree. The right
 * Chat modal renders into the SAME portal so it shares that one backdrop
 * instead of stacking a second overlay.
 */
export function MobileDrawer({ open, onClose, rightChat }: MobileDrawerProps) {
  // nav/list panels are Shell's own persistent nav/list landmarks (rendered
  // in shell.tsx, not by this portal) that CSS merely slides into an
  // overlay at mobile widths — same cross-boundary reach as the `.shell-
  // frame` query below, since this component has no direct render access to
  // them. Refreshed on every render (not a dedicated effect) so useFocusTrap's
  // own activation effect always reads the live node; assigning a ref's
  // `.current` directly in the render body is the same pattern chat-router.tsx
  // uses for its always-current `viewRef`.
  const navContainerRef = useRef<HTMLElement | null>(null);
  const listContainerRef = useRef<HTMLElement | null>(null);
  if (typeof document !== "undefined") {
    navContainerRef.current = document.querySelector<HTMLElement>(".shell-nav-panel");
    listContainerRef.current = document.querySelector<HTMLElement>(".shell-list-panel");
  }

  // nav/list drawers previously had NO focus management beyond the legacy
  // standalone Escape listener below — capture-on-open/restore-on-close and
  // Tab containment reuse the SAME shared hook right-chat and Modal already
  // use (cave-rl980 Task 5 finding). Deliberately NOT given an `onEscape`
  // here: nav/list keep Escape owned by the legacy listener below exactly as
  // before (unlike right-chat, which owns Escape solely through its own
  // trap), so this addition changes nothing about WHEN nav/list dismiss —
  // only that every dismissal path (Escape, the backdrop button, or any
  // other programmatic close) now restores focus to whatever opened the
  // drawer, and Tab stays contained inside it while open. Also deliberately
  // NOT given role="dialog"/aria-modal — nav/list are persistent shell
  // landmarks that merely slide over content at mobile widths, not
  // transient dialogs, so only this BEHAVIORAL trap is reused, never modal
  // semantics.
  useFocusTrap(open === "nav", navContainerRef);
  useFocusTrap(open === "list", listContainerRef);

  useEffect(() => {
    if (!open) return;
    const ownsEscape = open !== "right-chat";
    if (!ownsEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (ownsEscape) window.addEventListener("keydown", onKey);
    const releaseScroll = acquirePageScrollLock();
    return () => {
      if (ownsEscape) window.removeEventListener("keydown", onKey);
      releaseScroll();
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  if (!open && !rightChat) return null;

  return (
    <>
      {open && open !== "right-chat" ? createPortal(
        <button
          type="button"
          className="mobile-drawer-backdrop"
          data-drawer-slot={open}
          aria-label="Close drawer"
          onClick={onClose}
        />,
        document.body,
      ) : null}
      {rightChat ? (
        <Modal
          id="shell-right-chat-drawer"
          open={open === "right-chat"}
          keepMounted
          onClose={onClose}
          title="Chat panel"
          presentation="sheet-right"
          bodyLayout="fill"
        >
          {rightChat}
        </Modal>
      ) : null}
    </>
  );
}
