"use client";

import { createContext, useContext, useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type Options = {
  /** Called on Escape. Caller usually closes the dialog. Identity-stable
   *  internally (we keep it in a ref) so passing an inline arrow is fine. */
  onEscape?: () => void;
  /** Focus the first focusable element on activate (default true). If no
   *  focusable child exists, focuses the container itself — caller MUST give
   *  the container `tabIndex={-1}` so this is reachable. */
  focusFirst?: boolean;
};

/**
 * One entry per currently-ACTIVE trap, in activation order — the
 * module-level stack every useFocusTrap instance in the app shares. Keyed by
 * a stable per-hook-instance `id` (see `idRef` below), never by object
 * identity, so a React StrictMode mount→cleanup→mount cycle registers and
 * unregisters the SAME logical trap without ever leaving a duplicate behind:
 * `registerTrap` removes any existing entry for `id` before pushing, and
 * `unregisterTrap` finds and removes `id` from wherever it sits — not just
 * the top — because an ancestor trap can legitimately deactivate while a
 * still-active nested trap remains above it (e.g. a drawer closing out from
 * under an open child dialog; see FocusTrapOwnerHiddenContext below, which
 * exists to make that the rare case rather than the normal one).
 */
type TrapEntry = { readonly id: number };

const trapStack: TrapEntry[] = [];
let nextTrapId = 1;

function registerTrap(id: number): void {
  const stale = trapStack.findIndex((entry) => entry.id === id);
  if (stale !== -1) trapStack.splice(stale, 1);
  trapStack.push({ id });
}

/** Removes `id` (wherever it sits) and reports whether a still-active trap
 *  was layered above it — the caller uses this to decide whether restoring
 *  its own saved focus is safe right now, or whether the trap still on top
 *  owns focus until IT deactivates and performs its own restoration. */
function unregisterTrap(id: number): { hadTrapAbove: boolean } {
  const index = trapStack.findIndex((entry) => entry.id === id);
  if (index === -1) return { hadTrapAbove: false };
  const hadTrapAbove = index < trapStack.length - 1;
  trapStack.splice(index, 1);
  return { hadTrapAbove };
}

function isTopmostTrap(id: number): boolean {
  return trapStack.length > 0 && trapStack[trapStack.length - 1].id === id;
}

/** Test seam — drops every registered trap. Prevents a test that mounts a
 *  trap and errors before unmounting from leaking a stale entry into a
 *  later test in the same file/process. */
export function resetFocusTrapStackForTest(): void {
  trapStack.length = 0;
}

/**
 * Signals that an ancestor "modal owner" has become hidden while remaining
 * mounted — e.g. RightChatPanel's persistent panel/drawer, which stays
 * mounted-but-`aria-hidden`/`inert` when closed rather than unmounting (see
 * its "truthful accessibility, not a mount gate" contract) so ChatRouter's
 * transcript/stream survive a close. `createPortal` moves a dialog's DOM
 * node OUTSIDE its owner's subtree — so the owner's own `inert` never
 * reaches a body-portaled child — but never changes its REACT ancestry, so
 * this context still reaches every descendant regardless of where it
 * portals to. Every useFocusTrap call consumes it automatically below: a
 * trap whose owner disappears is asked to close through the SAME onEscape
 * callback it already wires up for the Escape key, so a hidden/inert owner
 * never leaves a body-portaled child dialog visible or interactive with
 * nothing left to contain it. Default `false` (not hidden) — every existing
 * useFocusTrap call site has no owner boundary above it and behaves exactly
 * as before.
 */
export const FocusTrapOwnerHiddenContext = createContext(false);

/**
 * Trap focus inside `containerRef` while `active` is true. Saves the
 * previously-focused element on activate→deactivate and restores it on
 * deactivate. Tab/Shift+Tab cycle through focusable descendants. Escape
 * calls onEscape.
 *
 * Stack-aware: every active trap in the app registers on a shared
 * module-level stack (see trapStack above), and only the TOPMOST one ever
 * acts on a keydown or restores focus on deactivation — everything below it
 * is a complete no-op until the trap above it deactivates, at which point it
 * "resumes" (the very next keydown routes to it again; no explicit re-focus
 * step is needed). This is what lets a body-portaled child dialog opened
 * from inside another active trap's content — e.g. an artifact fullscreen
 * viewer opened from the chat transcript hosted inside the right-Chat
 * drawer — layer correctly above it: Escape closes only the child, Tab stays
 * contained to the child, and the parent regains both the moment the child
 * closes, instead of both traps fighting over the same keydown.
 *
 * `onEscape` is stored in a ref so the effect deps don't include it — that
 * prevents tear-down/re-run loops when callers pass an inline arrow each
 * render. (Without this, returnFocusRef gets re-captured on every render and
 * deactivate restores focus to inside the modal, not to the trigger.)
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  { onEscape, focusFirst = true }: Options = {},
) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  // Stable per-hook-instance identity for the trap stack — assigned once
  // (lazy ref init) and unaffected by StrictMode's double render/effect
  // invocation, which reuses this same ref cell rather than re-creating it.
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextTrapId++;
  const ownerHidden = useContext(FocusTrapOwnerHiddenContext);

  // Keep the latest callback reachable from the keydown handler without
  // making it a useEffect dep.
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    if (focusFirst) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
      } else {
        // Fallback: focus the container so Tab/Esc still hit. Caller must
        // set tabIndex={-1} on the container element for this to land.
        container.focus();
      }
    }

    const trapId = idRef.current;
    registerTrap(trapId);

    function onKey(e: KeyboardEvent) {
      // Only the topmost active trap owns the keyboard (see trapStack doc
      // comment above) — a background trap is a silent no-op here, and
      // "resumes" on its own once the trap above it deactivates and
      // unregisters, with no extra bookkeeping needed on this side.
      if (!isTopmostTrap(trapId)) return;

      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (e.key === "Tab" && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        // Recapture: if focus escaped the container (a late autofocus
        // elsewhere, a click on the backdrop, a removed element), Tab must
        // pull it back in — otherwise every subsequent Tab silently walks
        // the page BEHIND the dialog and the "trap" never applies again.
        // (Live-reproduced: the home composer's mount autofocus stole focus
        // from the onboarding wizard and Tab toured the covered workspace.)
        if (!activeEl || !container.contains(activeEl)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const { hadTrapAbove } = unregisterTrap(trapId);
      // Skip restoring focus if a still-active nested trap sits above where
      // we were: an ancestor closing out from under an open child must not
      // fight that child's own containment. That trap owns focus until IT
      // deactivates, at which point ITS OWN cleanup restores focus — either
      // back to us (if we're still mounted and active) or, chaining
      // outward, to whatever was focused before the outermost trap ever
      // activated.
      if (!hadTrapAbove) {
        returnFocusRef.current?.focus();
      }
    };
  }, [active, containerRef, focusFirst]); // intentionally no onEscape

  // If an ancestor "modal owner" becomes hidden while this trap is still
  // active, ask it to close through the SAME callback Escape already uses
  // (see FocusTrapOwnerHiddenContext above). A no-op when onEscape is
  // undefined (e.g. gated behind an in-flight submit), matching Escape's own
  // no-op contract in that case.
  useEffect(() => {
    if (!active || !ownerHidden) return;
    onEscapeRef.current?.();
  }, [active, ownerHidden]);
}
