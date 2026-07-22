"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/lib/icon";
import { computeSubmenuPosition } from "@/lib/submenu-position";

// ── Submenu plumbing ─────────────────────────────────────────────────────────
// Cascading flyouts (PopoverSubmenu) portal to document.body — the popover
// panel's backdrop-filter creates a containing block and overflow:hidden would
// clip any in-panel fixed layer. The root Popover treats registered flyout
// elements as "inside" for its outside-click and focus-out dismissal checks.
const PopoverLayersContext = createContext<{
  register: (el: HTMLElement) => () => void;
  contains: (node: Node | null) => boolean;
} | null>(null);

// One open flyout per menu level: siblings coordinate through their level's
// group; each open flyout provides a fresh group for its own children.
const SubmenuGroupContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

// Deepest-first Escape routing: the root Popover's window-capture Escape
// listener (which stopPropagation()s before React handlers run) pops this
// stack — closing one submenu level per press — and only closes the popover
// itself once no flyout remains open.
const submenuEscapeStack: Array<() => void> = [];



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
  /**
   * Which layer owns vertical scrolling when content exceeds the available
   * viewport height. "popover" preserves the simple-menu default; "content"
   * lets a composite child keep its own header/footer fixed around a scroller.
   */
  scrollStrategy?: "popover" | "content";
  /**
   * Adds data-compact when the visual-viewport-aware available height is at or
   * below this pixel threshold, so composite children can tighten fixed chrome.
   */
  compactAtHeight?: number;
  className?: string;
  /** Accessible name for the dialog. role="dialog" requires a name; without one
   *  screen readers announce the popover with no title. */
  ariaLabel?: string;
  children: ReactNode;
};

export function usePopoverInitialFocus(open: boolean, panelSelector: string) {
  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(panelSelector)
        ?.querySelector<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [open, panelSelector]);
}

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
  scrollStrategy = "popover",
  compactAtHeight,
  className,
  ariaLabel,
  children,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [compact, setCompact] = useState(false);

  // Registry of portal-rendered descendant layers (cascading submenus): they
  // live outside this panel's DOM subtree but count as "inside" for dismissal.
  const layersRef = useRef<Set<HTMLElement>>(new Set());
  const layers = useMemo(
    () => ({
      register: (el: HTMLElement) => {
        layersRef.current.add(el);
        return () => {
          layersRef.current.delete(el);
        };
      },
      contains: (node: Node | null) => {
        if (!node) return false;
        if (popoverRef.current?.contains(node)) return true;
        for (const el of layersRef.current) if (el.contains(node)) return true;
        return false;
      },
    }),
    [],
  );

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

    const availableHeight = Math.round(
      Math.max(Math.min(isTop ? spaceAbove : spaceBelow, viewH - 2 * MARGIN), 120),
    );
    setCompact(compactAtHeight !== undefined && availableHeight <= compactAtHeight);

    const next: CSSProperties = {
      position: "absolute",
      minWidth: minWidth ?? r.width,
      // Never exceed the chosen side's visible space; scroll inside if it must. Floor
      // low (120px) rather than 160 so a keyboard-shrunk viewport still clamps inside
      // the visible band instead of disappearing under the keyboard.
      maxHeight: `${availableHeight}px`,
      overflowY: scrollStrategy === "content" ? "hidden" : "auto",
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
  }, [anchorRef, placement, offset, minWidth, scrollStrategy, compactAtHeight]);

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
        // An open cascading submenu absorbs the press first (one level per
        // Escape); the popover itself closes only when none remain.
        const closeDeepest = submenuEscapeStack[submenuEscapeStack.length - 1];
        if (closeDeepest) {
          closeDeepest();
          return;
        }
        onOpenChange(false);
      }
    };
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (layers.contains(t)) return;
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
  }, [open, onOpenChange, anchorRef, compute, layers]);

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
        // Non-modal dialog: the page behind stays interactive (light dismiss on
        // outside click/scroll), so no aria-modal and no focus trap — instead
        // the popover closes when keyboard focus moves out of it, so an open
        // "dialog" never floats astray while Tab walks the page behind it.
        role="dialog"
        aria-label={ariaLabel}
        data-compact={compact || undefined}
        tabIndex={-1}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          // relatedTarget is null when focus leaves the document (window blur,
          // native pickers) — don't treat that as Tab-out.
          if (!next) return;
          if (layers.contains(next)) return;
          if (anchorRef.current?.contains(next)) return;
          onOpenChange(false);
        }}
      >
        <PopoverLayersContext.Provider value={layers}>
          <SubmenuGroup>{children}</SubmenuGroup>
        </PopoverLayersContext.Provider>
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

export function PopoverLabel({ children, id }: { children: ReactNode; id?: string }) {
  return <div id={id} className="ui-popover-label" role="presentation">{children}</div>;
}

export function PopoverSeparator() {
  return <div className="ui-popover-separator" role="separator" />;
}

export type PopoverItemSemantic = "menuitem" | "button";

export function PopoverItem({
  icon,
  leading,
  children,
  onSelect,
  active,
  danger,
  disabled,
  checked,
  title,
  semantic = "menuitem",
}: {
  icon?: IconName;
  /** Rich leading visual (e.g. a ProjectAvatar); wins over `icon`. */
  leading?: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Native tooltip / AT description for items whose label abbreviates a
   *  longer explanation. */
  title?: string;
  /** When set (true/false) the item is a menuitemradio with aria-checked and a
   *  trailing check glyph — for mutually exclusive option groups. */
  checked?: boolean;
  /** Composite dialogs can retain native button semantics instead of exposing
   *  rows as menuitems. Pure menus keep the menuitem default. */
  semantic?: PopoverItemSemantic;
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
      title={title}
      role={semantic === "button" ? undefined : radio ? "menuitemradio" : "menuitem"}
      aria-checked={semantic === "button" ? undefined : radio ? checked : undefined}
    >
      {leading ?? (icon ? <Icon name={icon} width={13} aria-hidden /> : null)}
      <span>{children}</span>
      {radio && checked ? (
        <Icon name="ph:check" width={12} aria-hidden className="ml-auto" />
      ) : null}
    </button>
  );
}

// ── Cascading submenu ────────────────────────────────────────────────────────

/** Coordinates one-open-flyout-per-level among sibling PopoverSubmenus. The
 *  root Popover mounts one; each open flyout mounts another for its children. */
function SubmenuGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <SubmenuGroupContext.Provider value={value}>{children}</SubmenuGroupContext.Provider>;
}

const SUBMENU_HOVER_DELAY = 120;

/**
 * PopoverSubmenu — a menu row with a trailing caret that opens a cascading
 * flyout beside it (Claude-Desktop-style "+"-menu hierarchy).
 *
 * - Portal-rendered to document.body: the parent panel's backdrop-filter is a
 *   containing block and its overflow:hidden would clip an in-panel layer. The
 *   flyout registers with the root Popover so outside-click/focus-out dismissal
 *   treats it as inside.
 * - Opens on click/tap, on hover after a short intent delay (fine pointers),
 *   and via ArrowRight/Enter (focusing the first item). ArrowLeft or Escape
 *   inside the flyout returns focus to the trigger row without closing the
 *   root menu; only one sibling flyout is open at a time.
 * - Positioning: right of the row, top-aligned; flips left / clamps inside the
 *   visual viewport (computeSubmenuPosition).
 */
export function PopoverSubmenu({
  icon,
  label,
  hint,
  disabled,
  minWidth = 200,
  className,
  children,
}: {
  icon?: IconName;
  label: ReactNode;
  /** Trailing muted hint before the caret (e.g. a count). */
  hint?: ReactNode;
  disabled?: boolean;
  minWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const layers = useContext(PopoverLayersContext);
  const group = useContext(SubmenuGroupContext);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const lastPointerType = useRef("");
  const [selfOpen, setSelfOpen] = useState(false);
  // Pre-measure style carries minWidth so the flip/clamp math measures the
  // panel at its real rendered width (the CSS floor is narrower than the
  // call sites' minWidth props).
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", minWidth });
  // Keyboard-open intent: the first item can only be focused once the panel
  // is positioned and visible — focus() on a visibility:hidden subtree is
  // silently ignored by the browser.
  const wantsFirstItemFocus = useRef(false);

  // Grouped mode: openId decides; ungrouped fallback keeps local state.
  const open = group ? group.openId === id : selfOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (group) group.setOpenId(next ? id : group.openId === id ? null : group.openId);
      else setSelfOpen(next);
    },
    [group, id],
  );

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  useEffect(() => clearHoverTimer, []);

  // Register the flyout as an inside layer of the root popover while open.
  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el || !layers) return;
    return layers.register(el);
  }, [open, layers]);

  // While open, join the Escape stack so the root popover's window-capture
  // Escape handler closes this flyout (deepest first) instead of the menu.
  useEffect(() => {
    if (!open) return;
    const closeSelf = () => {
      setOpen(false);
      rowRef.current?.focus();
    };
    submenuEscapeStack.push(closeSelf);
    return () => {
      const i = submenuEscapeStack.indexOf(closeSelf);
      if (i !== -1) submenuEscapeStack.splice(i, 1);
    };
  }, [open, setOpen]);

  const position = useCallback(() => {
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!row || !panel) return;
    const r = row.getBoundingClientRect();
    const vv = window.visualViewport;
    const pos = computeSubmenuPosition(
      { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
      { width: panel.offsetWidth, height: panel.scrollHeight },
      {
        top: vv?.offsetTop ?? 0,
        left: vv?.offsetLeft ?? 0,
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      },
    );
    setStyle({
      position: "fixed",
      top: pos.top,
      left: pos.left,
      maxHeight: pos.maxHeight,
      minWidth,
      visibility: "visible",
    });
  }, [minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      wantsFirstItemFocus.current = false;
      return;
    }
    setStyle({ visibility: "hidden", minWidth });
    const frame = requestAnimationFrame(position);
    return () => cancelAnimationFrame(frame);
  }, [open, minWidth, position]);

  // Deferred keyboard focus: runs on the commit where position() flipped the
  // panel visible — never against the hidden pre-measure pass.
  useLayoutEffect(() => {
    if (!open || style.visibility !== "visible" || !wantsFirstItemFocus.current) return;
    wantsFirstItemFocus.current = false;
    panelRef.current
      ?.querySelector<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex=\"-1\"])")
      ?.focus();
  }, [open, style]);

  useEffect(() => {
    if (!open) return;
    const onReflow = () => position();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, position]);

  const focusFirstItem = () => {
    wantsFirstItemFocus.current = true;
  };

  const closeToRow = () => {
    setOpen(false);
    rowRef.current?.focus();
  };

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        className={["ui-popover-item ui-popover-subtrigger", className ?? ""].filter(Boolean).join(" ")}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        data-active={open || undefined}
        onPointerDown={(e) => {
          lastPointerType.current = e.pointerType;
        }}
        onClick={() => {
          clearHoverTimer();
          // Mouse: click always opens — hover intent may have opened the
          // flyout mid-press, and a toggle would immediately shut what the
          // user is aiming at. Touch/pen taps (and keyboard) still toggle.
          if (!open) setOpen(true);
          else if (lastPointerType.current !== "mouse") setOpen(false);
        }}
        onPointerEnter={(e) => {
          if (disabled || e.pointerType !== "mouse") return;
          clearHoverTimer();
          hoverTimer.current = window.setTimeout(() => setOpen(true), SUBMENU_HOVER_DELAY);
        }}
        onPointerLeave={() => clearHoverTimer()}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || (!open && e.key === "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            focusFirstItem();
          } else if (e.key === "ArrowLeft" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {icon ? <Icon name={icon} width={13} aria-hidden /> : null}
        <span className="ui-popover-subtrigger__label">{label}</span>
        {hint !== undefined && hint !== null ? (
          <span className="ui-popover-subtrigger__hint" aria-hidden>
            {hint}
          </span>
        ) : null}
        <Icon name="ph:caret-right" width={11} aria-hidden className="ui-popover-subtrigger__caret" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="ui-popover-portal">
              <div
                ref={panelRef}
                className="ui-popover ui-popover-submenu"
                style={style}
                role="menu"
                aria-label={typeof label === "string" ? label : undefined}
                onKeyDown={(e) => {
                  // ArrowLeft/Escape step back to the trigger row; Escape stops
                  // here so the root menu stays open (one level per press).
                  if (e.key === "ArrowLeft" || e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    closeToRow();
                  }
                }}
                onBlur={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (!next) return;
                  // Nested flyouts portal to body — consult the root registry
                  // (they register there) so descending a level doesn't close us.
                  if (layers ? layers.contains(next) : panelRef.current?.contains(next)) return;
                  if (rowRef.current?.contains(next)) return;
                  setOpen(false);
                }}
              >
                <div className="ui-popover-body" role="presentation">
                  <SubmenuGroup>{children}</SubmenuGroup>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
