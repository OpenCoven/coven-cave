"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { IconName } from "@/lib/icon";
import { IconButton, type IconButtonProps } from "./icon-button";
import { Popover, PopoverBody, type PopoverProps } from "./popover";

const ENABLED_MENU_ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]), [role="menuitemradio"]:not(:disabled):not([aria-disabled="true"])';

export type OverflowMenuProps = {
  /** Accessible name for both the trigger and the menu (e.g. "More actions"). */
  ariaLabel: string;
  /** Trigger glyph; defaults to the horizontal-dots chrome action. */
  icon?: IconName;
  size?: IconButtonProps["size"];
  placement?: PopoverProps["placement"];
  minWidth?: number;
  /** Extra class on the trigger button (e.g. "reveal-on-hover"). */
  className?: string;
  disabled?: boolean;
  /** PopoverItem / PopoverSeparator / PopoverLabel children. */
  children: ReactNode;
};

/**
 * The standard "⋯" overflow menu — the disclosure-ladder rung for secondary
 * actions that don't earn always-visible chrome (design language §8). Wraps
 * IconButton + Popover so every overflow gets identical semantics for free:
 * aria-haspopup/aria-expanded on the trigger, role="menu" body, Escape /
 * outside-click / focus-return from the Popover scaffold, and auto-close when
 * a menuitem is selected.
 */
export function OverflowMenu({
  ariaLabel,
  icon = "ph:dots-three-bold",
  size = "sm",
  placement = "bottom-end",
  minWidth = 180,
  className,
  disabled,
  children,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const keyboardOpenRequested = useRef(false);

  const getEnabledItems = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR) ?? [],
      ),
    [],
  );

  const focusFirstEnabledItem = useCallback(() => {
    keyboardOpenRequested.current = false;
    getEnabledItems()[0]?.focus();
  }, [getEnabledItems]);

  // The menu is portaled, so keyboard focus must wait until its DOM has mounted.
  // Pointer-opened menus keep focus on the trigger for the light-dismiss pattern.
  useEffect(() => {
    if (!open || !keyboardOpenRequested.current) return;
    const focusFrame = requestAnimationFrame(focusFirstEnabledItem);
    return () => cancelAnimationFrame(focusFrame);
  }, [focusFirstEnabledItem, open]);

  const onTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        keyboardOpenRequested.current = true;
        e.stopPropagation();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (open) {
          requestAnimationFrame(focusFirstEnabledItem);
        } else {
          setOpen(true);
        }
      }
    },
    [focusFirstEnabledItem, open],
  );

  const onBodyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = getEnabledItems();
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number;
      if (e.key === "Home") nextIndex = 0;
      else if (e.key === "End") nextIndex = items.length - 1;
      else if (e.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
      else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[nextIndex]?.focus();
    },
    [getEnabledItems],
  );

  // Close after any enabled menuitem is activated, without asking every
  // consumer to thread a close() through their onSelect handlers.
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const item = (e.target as Element).closest?.(
      '[role="menuitem"], [role="menuitemradio"]',
    );
    if (
      item &&
      !(item as HTMLButtonElement).disabled &&
      item.getAttribute("aria-disabled") !== "true"
    ) {
      setOpen(false);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) triggerRef.current?.focus();
      });
    }
  }, []);

  return (
    <>
      <IconButton
        ref={triggerRef}
        icon={icon}
        size={size}
        className={["focus-ring", className ?? ""].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        // `active` drives the pressed visual; aria-expanded is the correct
        // state channel for a menu trigger, so suppress IconButton's
        // aria-pressed (a button can't be both a toggle and a menu button).
        aria-pressed={undefined}
        active={open}
        disabled={disabled}
        onPointerDown={() => {
          keyboardOpenRequested.current = false;
        }}
        onKeyDown={onTriggerKeyDown}
        onClick={() => setOpen((v) => !v)}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement={placement}
        minWidth={minWidth}
        ariaLabel={ariaLabel}
      >
        <div ref={menuRef} onClick={onBodyClick} onKeyDown={onBodyKeyDown}>
          <PopoverBody role="menu" ariaLabel={ariaLabel}>
            {children}
          </PopoverBody>
        </div>
      </Popover>
    </>
  );
}
