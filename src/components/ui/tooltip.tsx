"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useIsCoarsePointer } from "@/lib/use-viewport";

type Placement = "top" | "bottom";

const LONG_PRESS_MS = 500;

export type TooltipProps = {
  label: ReactNode;
  placement?: Placement;
  delay?: number;
  children: ReactElement;
};

/**
 * Lightweight tooltip. Wraps a single child element and shows the label
 * after `delay` ms of hover/focus. Closes on blur/leave/escape. Does not
 * attempt complex positioning — flips to top/bottom only.
 *
 * Touch behavior: on coarse pointers (`(hover: none)`), the mouse-enter
 * / mouse-leave path is suppressed — otherwise the synthetic events that
 * fire on tap would pop the tooltip on every press and race the click
 * handler. Instead, a long-press of LONG_PRESS_MS reveals the tooltip,
 * and the synthetic click that fires on the release is swallowed so the
 * action doesn't run when the user only wanted the help label. Tap
 * outside dismisses; Escape still dismisses too.
 */
export function Tooltip({ label, placement = "top", delay = 300, children }: TooltipProps) {
  const id = useId();
  const coarse = useIsCoarsePointer();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const isTop = placement === "top";
    setStyle({
      ...(isTop
        ? { top: r.top - 6, transform: "translate(-50%, -100%)" }
        : { top: r.bottom + 6, transform: "translate(-50%, 0)" }),
      left: r.left + r.width / 2,
    });
  }, [placement]);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      place();
      setOpen(true);
    }, delay);
  }, [delay, place]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  // Tap-outside dismiss for touch. The desktop path closes on mouseleave
  // already; coarse pointers don't have hover, so we lean on global
  // pointerdown instead.
  useEffect(() => {
    if (!open || !coarse) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = triggerRef.current;
      if (t && t.contains(e.target as Node)) return;
      hide();
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true } as EventListenerOptions);
  }, [open, coarse, hide]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  if (!isValidElement(children)) return children;

  const childProps = children.props as Record<string, unknown>;
  const childRef = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref;

  const callOriginal = <E,>(name: string, e: E) => {
    const handler = childProps[name] as ((e: E) => void) | undefined;
    handler?.(e);
  };

  const merged = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      if (typeof childRef === "function") childRef(node);
      else if (childRef && typeof childRef === "object") {
        (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onMouseEnter: (e: MouseEvent) => {
      callOriginal("onMouseEnter", e);
      // Skip on touch — synthetic mouseenter on tap would race click.
      if (coarse) return;
      show();
    },
    onMouseLeave: (e: MouseEvent) => {
      callOriginal("onMouseLeave", e);
      if (coarse) return;
      hide();
    },
    onFocus: (e: FocusEvent) => {
      callOriginal("onFocus", e);
      show();
    },
    onBlur: (e: FocusEvent) => {
      callOriginal("onBlur", e);
      hide();
    },
    onPointerDown: (e: ReactPointerEvent) => {
      callOriginal("onPointerDown", e);
      if (!coarse || e.pointerType !== "touch") return;
      longPressFiredRef.current = false;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        place();
        setOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerUp: (e: ReactPointerEvent) => {
      callOriginal("onPointerUp", e);
      if (!coarse) return;
      clearLongPress();
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      callOriginal("onPointerCancel", e);
      if (!coarse) return;
      clearLongPress();
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      callOriginal("onPointerLeave", e);
      if (!coarse) return;
      clearLongPress();
    },
    onClick: (e: MouseEvent) => {
      // Swallow the synthetic click that follows a touch long-press —
      // otherwise revealing the tooltip would also trigger the action.
      if (coarse && longPressFiredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressFiredRef.current = false;
        return;
      }
      callOriginal("onClick", e);
    },
    "aria-describedby": open ? id : (childProps["aria-describedby"] as string | undefined),
  });

  return (
    <>
      {merged}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div id={id} role="tooltip" className="ui-tooltip" style={style}>
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
