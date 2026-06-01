"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onSnooze: (untilIso: string) => void;
  className?: string;
  size?: "sm" | "xs";
};

type Option = { label: string; resolve: () => string };

function tomorrowAt9(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

const OPTIONS: Option[] = [
  { label: "5 min", resolve: () => new Date(Date.now() + 5 * 60_000).toISOString() },
  { label: "30 min", resolve: () => new Date(Date.now() + 30 * 60_000).toISOString() },
  { label: "1 hour", resolve: () => new Date(Date.now() + 60 * 60_000).toISOString() },
  { label: "Tomorrow 9am", resolve: tomorrowAt9 },
];

export function SnoozeMenu({ onSnooze, className, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const btnCls =
    size === "xs"
      ? "rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
      : "rounded border border-[var(--border-strong)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]";

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button onClick={() => setOpen((v) => !v)} className={btnCls}>
        Snooze ▾
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-32 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-xl">
          {OPTIONS.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                setOpen(false);
                onSnooze(o.resolve());
              }}
              className="block w-full px-2 py-1 text-left text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
