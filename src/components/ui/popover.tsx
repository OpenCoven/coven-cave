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
  children,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const compute = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const isTop = placement.startsWith("top");
    const isEnd = placement.endsWith("end");
    const next: CSSProperties = {
      position: "absolute",
      minWidth: minWidth ?? r.width,
    };
    if (isTop) {
      next.bottom = window.innerHeight - r.top + offset;
    } else {
      next.top = r.bottom + offset;
    }
    if (isEnd) {
      next.right = window.innerWidth - r.right;
    } else {
      next.left = r.left;
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
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, onOpenChange, anchorRef, compute]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ui-popover-portal">
      <div
        ref={popoverRef}
        className={["ui-popover", className ?? ""].filter(Boolean).join(" ")}
        style={style}
        role="dialog"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Common popover content scaffold. */
export function PopoverBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["ui-popover-body", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

export function PopoverLabel({ children }: { children: ReactNode }) {
  return <div className="ui-popover-label">{children}</div>;
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
}: {
  icon?: IconName;
  children: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const classes = [
    "ui-popover-item",
    danger ? "ui-popover-item--danger" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      onClick={onSelect}
      data-active={active || undefined}
      disabled={disabled}
      role="menuitem"
    >
      {icon ? <Icon name={icon} width={13} aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}
