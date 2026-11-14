"use client";

import "@/styles/dash-act.css";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { DEFAULT_SNOOZE_OPTIONS, type SnoozeOption } from "@/lib/snooze-options";

// The one snooze split-button + duration menu, shared by the inbox toast, the
// inspector inbox list, and the dashboard's ActionInbox (which used to carry
// its own copy). Real menu semantics: the trigger declares aria-haspopup /
// aria-expanded, the popup is role=menu with menuitem options, and the shared
// focus trap gives it the app's standard popover keyboard behaviour — first
// option focused on open, Tab/Shift+Tab cycle, Escape closes and returns
// focus to the trigger. Outside clicks close it.

// The durations live in a shared module so the bell can offer the same
// choices inline without pulling in this menu's stylesheet.
export { minutesUntilTomorrowMorning, type SnoozeOption } from "@/lib/snooze-options";

const DEFAULT_OPTIONS: SnoozeOption[] = [...DEFAULT_SNOOZE_OPTIONS];

type Props = {
  /** Both currencies of the snooze APIs: `untilIso` for /snooze bodies that
   *  take a timestamp, `minutes` for the ones that take a duration. */
  onSnooze: (untilIso: string, minutes: number) => void;
  options?: SnoozeOption[];
  disabled?: boolean;
  className?: string;
  size?: "sm" | "xs";
  /** Presentation overrides so surfaces with bespoke button systems (the
   *  dashboard's dash-act family) can reuse the semantics without restyling. */
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
};

export function SnoozeMenu({
  onSnooze,
  options = DEFAULT_OPTIONS,
  disabled = false,
  className,
  size = "sm",
  triggerClassName,
  menuClassName,
  optionClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, menuRef, { onEscape: () => setOpen(false) });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const btnCls =
    triggerClassName ??
    (size === "xs"
      ? "rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
      : "rounded border border-[var(--border-strong)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]");

  const pick = (o: SnoozeOption) => {
    setOpen(false);
    const minutes = o.minutes();
    onSnooze(new Date(Date.now() + minutes * 60_000).toISOString(), minutes);
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={btnCls}
      >
        Snooze ▾
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Snooze for"
          className={
            menuClassName ??
            "absolute bottom-full left-0 z-50 mb-1 w-32 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-xl"
          }
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              onClick={() => pick(o)}
              className={
                optionClassName ??
                "block w-full px-2 py-1 text-left text-[length:var(--text-xs)] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
