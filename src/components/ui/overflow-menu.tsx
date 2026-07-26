"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { IconName } from "@/lib/icon";
import { IconButton, type IconButtonProps } from "./icon-button";
import { Popover, PopoverBody, type PopoverProps } from "./popover";

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

  // Close after any enabled menuitem is activated, without asking every
  // consumer to thread a close() through their onSelect handlers.
  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const item = (e.target as Element).closest?.(
      '[role="menuitem"], [role="menuitemradio"]',
    );
    if (item && !(item as HTMLButtonElement).disabled) setOpen(false);
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
        <div onClick={onBodyClick}>
          <PopoverBody role="menu" ariaLabel={ariaLabel}>
            {children}
          </PopoverBody>
        </div>
      </Popover>
    </>
  );
}
