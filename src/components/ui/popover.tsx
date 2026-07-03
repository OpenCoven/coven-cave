"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/lib/icon";

export type PopoverProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Element whose rect anchors the popover. Trigger DOM stays where it is. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Vertical placement relative to the anchor. */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Pixel gap between anchor and popover. */
  offset?: number;
  /** Optional minimum width override; defaults to anchor width. */
  minWidth?: number;
  className?: string;
  /** Accessible name for the dialog. role="dialog" requires a name; without one
   *  screen readers announce the popover with no title. */
  ariaLabel?: string;
  children: ReactNode;
};

/**
 * Lightweight portal-rendered popover. Closes on Escape, outside click,
 * scroll, or window resize. Positions itself relative to the anchor; for
 * complex flipping/collision use a real positioning library.
 */
export function Popover({
  open,
  onOpenChange,
  anchorRef,
  placement = "bottom-start",
  offset = 6,
  minWidth,
  className,
  ariaLabel,
  children,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const compute = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const pop = popoverRef.current;
    // scrollHeight = natural content height, stable regardless of the maxHeight we
    // apply below (so the flip decision doesn't oscillate on reflow).
    const popH = pop?.scrollHeight ?? 0;
    const popW = pop?.offsetWidth ?? minWidth ?? r.width;
    const MARGIN = 8;

    // Measure against the VISUAL viewport, not the layout viewport, so the
    // on-screen keyboard (iOS) is treated as unavailable space. getBoundingClientRect
    // is in layout-viewport coords, so the visible region's bounds in those same
    // coords are [offsetTop, offsetTop + height]. Falls back to innerHeight/Width
    // where visualViewport is unavailable (older webviews, SSR is guarded by callers).
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewLeft = vv?.offsetLeft ?? 0;
    const viewH = vv?.height ?? window.innerHeight;
    const viewW = vv?.width ?? window.innerWidth;
    const visibleBottom = viewTop + viewH;

    // Vertical auto-flip: honor the requested side, but flip to the opposite side
    // when the popover can't fit there and the other side has more room. Keeps it
    // on-screen when the anchor sits low (or high) in the viewport — or when the
    // keyboard has eaten the space below.
    const spaceBelow = visibleBottom - r.bottom - offset;
    const spaceAbove = r.top - viewTop - offset;
    const isTop = placement.startsWith("top")
      ? !(popH > spaceAbove && spaceBelow > spaceAbove)
      : popH > spaceBelow && spaceAbove > spaceBelow;
    const isEnd = placement.endsWith("end");

    const next: CSSProperties = {
      position: "absolute",
      minWidth: minWidth ?? r.width,
      // Never exceed the chosen side's visible space; scroll inside if it must. Floor
      // low (120px) rather than 160 so a keyboard-shrunk viewport still clamps inside
      // the visible band instead of disappearing under the keyboard.
      maxHeight: `${Math.round(Math.max(Math.min(isTop ? spaceAbove : spaceBelow, viewH - 2 * MARGIN), 120))}px`,
      overflowY: "auto",
    };
    if (isTop) {
      next.bottom = window.innerHeight - r.top + offset;
    } else {
      next.top = r.bottom + offset;
    }
    // Horizontal clamp: keep both edges within the visible viewport.
    if (isEnd) {
      next.right = Math.max(MARGIN, window.innerWidth - r.right);
    } else {
      next.left = Math.max(MARGIN, Math.min(r.left, viewLeft + viewW - popW - MARGIN));
    }
    setStyle(next);
  }, [anchorRef, placement, offset, minWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    compute();
  }, [open, compute]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Consume the Escape so it doesn't bubble to a parent dialog's keydown
        // handler (e.g. the Settings panel, which closes itself on Escape). The
        // listener is registered in the capture phase below so it runs before any
        // such parent handler; stopPropagation then prevents that handler firing.
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    const onReflow = () => compute();
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    // Recompute when the on-screen keyboard opens/closes or the page pinch-zooms,
    // so the popover re-clamps to the shrunken visible band instead of hiding under it.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onReflow);
    vv?.addEventListener("scroll", onReflow);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
      vv?.removeEventListener("resize", onReflow);
      vv?.removeEventListener("scroll", onReflow);
    };
  }, [open, onOpenChange, anchorRef, compute]);

  // Return focus to the trigger when the popover closes, so keyboard users aren't
  // stranded (Escape, item-select, or outside-click on empty space all leave focus
  // on document.body once the popover unmounts). If the user moved focus to another
  // control, leave it there — only reclaim focus when it would otherwise be lost.
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) anchor?.focus?.();
    };
  }, [open, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ui-popover-portal">
      <div
        ref={popoverRef}
        className={["ui-popover", className ?? ""].filter(Boolean).join(" ")}
        style={style}
        role="dialog"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Common popover content scaffold. Pass role="menu" (with an ariaLabel) when the
 *  body is a pure menu of menuitem/menuitemradio children, so the ARIA hierarchy
 *  is menu > menuitemradio rather than items loose in the dialog. */
export function PopoverBody({
  children,
  className,
  role,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  role?: "menu";
  ariaLabel?: string;
}) {
  return (
    <div
      className={["ui-popover-body", className ?? ""].filter(Boolean).join(" ")}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function PopoverLabel({ children }: { children: ReactNode }) {
  return <div className="ui-popover-label" role="presentation">{children}</div>;
}

export function PopoverSeparator() {
  return <div className="ui-popover-separator" role="separator" />;
}

export function PopoverItem({
  icon,
  children,
  onSelect,
  active,
  danger,
  disabled,
  checked,
}: {
  icon?: IconName;
  children: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** When set (true/false) the item is a menuitemradio with aria-checked and a
   *  trailing check glyph — for mutually exclusive option groups. */
  checked?: boolean;
}) {
  const classes = [
    "ui-popover-item",
    danger ? "ui-popover-item--danger" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      className={classes}
      onClick={onSelect}
      data-active={active || undefined}
      disabled={disabled}
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? checked : undefined}
    >
      {icon ? <Icon name={icon} width={13} aria-hidden /> : null}
      <span>{children}</span>
      {radio && checked ? (
        <Icon name="ph:check" width={12} aria-hidden className="ml-auto" />
      ) : null}
    </button>
  );
}
