"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const rightChatRef = useRef<HTMLElement | null>(null);
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

  // Make the shell chrome behind the right Chat modal inert so Tab/AT users
  // can't reach it while the dialog is up. `.shell-frame` is Shell's own
  // root (shell.tsx) — this portal mounts to document.body, OUTSIDE that
  // subtree, so making it inert never reaches the modal we're keeping
  // interactive. Restores whatever inert state `.shell-frame` actually had
  // before, rather than assuming it was false.
  //
  // Declared BEFORE useFocusTrap below on purpose: React runs a component's
  // passive-effect cleanups in the same top-down order they were declared
  // (not reversed), for both updates and unmount. useFocusTrap's own cleanup
  // calls `returnFocusRef.current?.focus()` to return focus to the shell
  // toggle that opened the drawer — but `.focus()` on an element inside an
  // `inert` subtree is a silent no-op. So this effect's cleanup (clearing
  // `shell.inert`) MUST run first, or the restored focus call lands while
  // the shell is still inert and does nothing. Both effects intentionally
  // stay plain `useEffect` (matching useFocusTrap's own passive-effect
  // implementation) — mixing in `useLayoutEffect` here would just move this
  // ahead of ALL passive effects regardless of declaration order, which
  // works too, but decouples the ordering guarantee from something a future
  // reader can see at a glance the way declaration order can.
  useEffect(() => {
    if (open !== "right-chat") return;
    const shell = document.querySelector<HTMLElement>(".shell-frame");
    if (!shell) return;
    const prevInert = shell.inert;
    shell.inert = true;
    return () => {
      shell.inert = prevInert;
    };
  }, [open]);

  // The right Chat modal owns Escape + focus trap/return entirely through
  // the shared hook (the same contract Modal uses) — the legacy standalone
  // listener below is scoped away from it so Escape never fires two close
  // paths for this slot.
  useFocusTrap(open === "right-chat", rightChatRef, { onEscape: onClose });

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (ownsEscape) window.addEventListener("keydown", onKey);
    const prevRootOverflow = document.documentElement.style.overflow;
    const prevRootOverscroll = document.documentElement.style.overscrollBehavior;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      if (ownsEscape) window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevRootOverflow;
      document.documentElement.style.overscrollBehavior = prevRootOverscroll;
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  if (!open && !rightChat) return null;

  return createPortal(
    <>
      {open ? (
        <button
          type="button"
          className="mobile-drawer-backdrop"
          data-drawer-slot={open}
          aria-label="Close drawer"
          onClick={onClose}
        />
      ) : null}
      {rightChat ? (
        <section
          id="shell-right-chat-drawer"
          ref={rightChatRef}
          className="mobile-right-chat-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Chat panel"
          aria-hidden={open !== "right-chat"}
          hidden={open !== "right-chat"}
          inert={open !== "right-chat"}
          tabIndex={-1}
        >
          {rightChat}
        </section>
      ) : null}
    </>,
    document.body,
  );
}
