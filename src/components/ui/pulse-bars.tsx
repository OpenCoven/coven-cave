"use client";

import type { PulseDay } from "@/lib/session-pulse";
import "@/styles/pulse-bars.css";

/**
 * Dependency-free day-count bars. With a `label` the bars are exposed to AT as
 * role="img" (the label should carry the same meaning as the visual); without
 * one they are decorative (aria-hidden) — use that when adjacent text already
 * states the counts, e.g. inside a roster row button.
 */
export function PulseBars({
  pulse,
  label,
  size = "md",
  showTips = false,
}: {
  pulse: PulseDay[];
  label?: string;
  size?: "sm" | "md" | "lg";
  showTips?: boolean;
}) {
  const max = Math.max(1, ...pulse.map((day) => day.count));
  return (
    <div
      className={`pulse-bars pulse-bars--${size}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {pulse.map((day) => (
        <span
          key={day.key}
          className={`pulse-bars__day${day.count === 0 ? " is-empty" : ""}`}
          title={showTips ? `${day.label}: ${day.count} session${day.count === 1 ? "" : "s"}` : undefined}
        >
          <i style={{ height: `${day.count === 0 ? 8 : Math.max(16, (day.count / max) * 100)}%` }} />
        </span>
      ))}
    </div>
  );
}
