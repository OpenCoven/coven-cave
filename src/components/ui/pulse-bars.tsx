"use client";

import type { PulseDay } from "@/lib/session-pulse";
import "@/styles/pulse-bars.css";

/**
 * Dependency-free day-count bars. With a `label` the bars are exposed to AT as
 * role="img" (the label should carry the same meaning as the visual); without
 * one they are decorative (aria-hidden) — use that when adjacent text already
 * states the counts, e.g. inside a roster row button.
 *
 * With `onSelectDay` the bars become a day picker: each day renders as a
 * toggle button (aria-pressed mirrors `selectedKey`) so the pulse drills into
 * that day's sessions instead of being decoration. Interactive bars swap the
 * role="img" wrapper for role="group" — the buttons themselves carry the
 * per-day labels.
 */
export function PulseBars({
  pulse,
  label,
  size = "md",
  showTips = false,
  onSelectDay,
  selectedKey = null,
}: {
  pulse: PulseDay[];
  label?: string;
  size?: "sm" | "md" | "lg";
  showTips?: boolean;
  onSelectDay?: (day: PulseDay) => void;
  selectedKey?: string | null;
}) {
  const max = Math.max(1, ...pulse.map((day) => day.count));
  const interactive = Boolean(onSelectDay);
  const rootAria = interactive
    ? { role: "group" as const, "aria-label": label ?? "Daily session counts" }
    : label
      ? { role: "img" as const, "aria-label": label }
      : { "aria-hidden": true as const };
  return (
    <div
      className={`pulse-bars pulse-bars--${size}${showTips ? " pulse-bars--tips" : ""}${interactive ? " pulse-bars--interactive" : ""}`}
      {...rootAria}
    >
      {pulse.map((day) => {
        const tip = `${day.label}: ${day.count} session${day.count === 1 ? "" : "s"}`;
        const fill = (
          <i style={{ height: `${day.count === 0 ? 8 : Math.max(16, (day.count / max) * 100)}%` }} />
        );
        if (!interactive) {
          return (
            <span
              key={day.key}
              className={`pulse-bars__day${day.count === 0 ? " is-empty" : ""}`}
              title={showTips ? tip : undefined}
            >
              {fill}
            </span>
          );
        }
        const selected = day.key === selectedKey;
        return (
          <button
            key={day.key}
            type="button"
            className={`pulse-bars__day${day.count === 0 ? " is-empty" : ""}${selected ? " is-selected" : ""}`}
            title={tip}
            aria-label={`${tip}. ${selected ? "Clear day filter" : "Show this day's sessions"}`}
            aria-pressed={selected}
            onClick={() => onSelectDay?.(day)}
          >
            {fill}
          </button>
        );
      })}
    </div>
  );
}
