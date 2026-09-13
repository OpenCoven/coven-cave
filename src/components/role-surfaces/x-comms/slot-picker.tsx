"use client";

/**
 * Picking a slot from seven days of follower activity.
 *
 * A heatmap rather than a time field, because the question is not "what time"
 * but "when are the people who follow this account awake" — and the answer is
 * a shape, not a number. Past hours are disabled rather than hidden so the
 * grid keeps a stable geometry through the day.
 *
 * Changing a slot does not re-approve. The footer says so, because moving a
 * post is otherwise easy to read as touching the decision that released it.
 */

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  dayActivityScale,
  dayDelta,
  dayLabel,
  hourOf,
  isInPeakBand,
  slotAt,
  slotLabel,
  X_FOLLOWER_ACTIVITY,
} from "@/lib/x-comms-model";

const HOUR_LABELS: Record<number, string> = {
  0: "12a",
  6: "6a",
  12: "12p",
  17: "5p",
  19: "7p",
  23: "11p",
};

export function SlotPicker({
  now,
  picked,
  onPick,
  onCancel,
  onUse,
}: {
  now: number;
  picked: number;
  onPick: (at: number) => void;
  onCancel: () => void;
  onUse: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const peak = Math.max(...X_FOLLOWER_ACTIVITY);
  const pickedHour = hourOf(picked);
  const pickedDay = dayDelta(now, picked);
  const inBand = isInPeakBand(pickedHour);
  const dailyTotal = X_FOLLOWER_ACTIVITY.reduce((sum, value) => sum + value, 0);

  // Focus lands inside the dialog rather than on the page behind it; Escape is
  // handled by the room so one key closes whatever overlay is topmost.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        '[aria-checked="true"]:not(:disabled), button:not(:disabled)',
      );
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const justification = inBand
    ? `inside the 5–7 PM band · ${Math.round((X_FOLLOWER_ACTIVITY[pickedHour] / dailyTotal) * 100)}% of daily follower activity in this hour`
    : `outside the band · ${Math.round((X_FOLLOWER_ACTIVITY[pickedHour] / peak) * 100)}% of peak activity · fine for replies, weaker for reach`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Change slot"
      className="x-comms-slot-dialog"
    >
      <header className="x-comms-slot-head">
        <span className="x-comms-picked-value">
          <strong>Change slot</strong>
          <span className="x-comms-card-sub">
            Follower activity, next 7 days · PT. Darker is busier; the 5–7 PM band is
            outlined.
          </span>
        </span>
        <button
          type="button"
          className="x-comms-mini focus-ring"
          data-icon="true"
          aria-label="Close"
          onClick={onCancel}
        >
          <Icon name="ph:x" width={13} height={13} aria-hidden />
        </button>
      </header>

      <div className="x-comms-heat">
        <span />
        <div className="x-comms-heat-hours">
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour}>{HOUR_LABELS[hour] ?? ""}</span>
          ))}
        </div>

        {Array.from({ length: 7 }, (_, dayOffset) => {
          const label = dayLabel(now, slotAt(now, dayOffset, 12));
          const scale = dayActivityScale(now, dayOffset);
          return (
            <Fragmentish key={dayOffset}>
              <span
                className="x-comms-heat-day"
                data-picked={pickedDay === dayOffset ? "true" : undefined}
              >
                {label}
              </span>
              <div className="x-comms-heat-row" role="radiogroup" aria-label={label}>
                {X_FOLLOWER_ACTIVITY.map((value, hour) => {
                  const at = slotAt(now, dayOffset, hour);
                  const past = at <= now;
                  const intensity = (value / peak) * scale;
                  const selected = pickedDay === dayOffset && pickedHour === hour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      role="radio"
                      className="x-comms-cell focus-ring"
                      aria-checked={selected}
                      data-band={isInPeakBand(hour) ? "true" : undefined}
                      disabled={past}
                      title={`${label} ${((hour + 11) % 12) + 1}${hour < 12 ? " AM" : " PM"} PT · ${Math.round(intensity * 100)}% of peak${past ? " · passed" : ""}`}
                      style={
                        {
                          "--x-cell-intensity": `${Math.round(intensity * 55)}%`,
                        } as React.CSSProperties
                      }
                      onClick={() => onPick(at)}
                    />
                  );
                })}
              </div>
            </Fragmentish>
          );
        })}
      </div>

      <div className="x-comms-picked">
        <span className="x-comms-picked-value">
          <span>picked</span>
          <strong>{slotLabel(now, picked)}</strong>
        </span>
        <span className="x-comms-picked-why">{justification}</span>
      </div>

      <footer className="x-comms-dialog-foot">
        <span>changing the slot doesn&apos;t re-approve · the post stays approved</span>
        <span className="x-comms-dialog-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <span className="x-comms-primary" data-emphasis="true">
            <Button variant="secondary" size="sm" onClick={onUse}>
              Use this slot
            </Button>
          </span>
        </span>
      </footer>
    </div>
  );
}

/** The grid needs the label and its row as siblings, so the pair cannot be wrapped. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
