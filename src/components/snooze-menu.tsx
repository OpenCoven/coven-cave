"use client";

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";

// The one snooze split-button + duration menu, shared by the inbox toast, the
// inspector inbox list, and the dashboard's ActionInbox (which used to carry
// its own copy). Real menu semantics: the trigger declares aria-haspopup /
// aria-expanded, the popup is role=menu with menuitem options, and the shared
// focus trap gives it the app's standard popover keyboard behaviour — first
// option focused on open, Tab/Shift+Tab cycle, Escape closes and returns
// focus to the trigger. Outside clicks close it.

export type SnoozeOption = {
  label: string;
  /** Whole minutes from "now", resolved at click time so relative options
   *  (tomorrow morning) stay correct however long the menu sits open. */
  minutes: () => number;
};

/** Whole minutes from now until 9am the next calendar day. */
export function minutesUntilTomorrowMorning(): number {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
}

const DEFAULT_OPTIONS: SnoozeOption[] = [
  { label: "5 min", minutes: () => 5 },
  { label: "30 min", minutes: () => 30 },
  { label: "1 hour", minutes: () => 60 },
  { label: "Tomorrow 9am", minutes: () => minutesUntilTomorrowMorning() },
];

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
      ? "rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
      : "rounded border border-[var(--border-strong)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]");

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
                "block w-full px-2 py-1 text-left text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
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
