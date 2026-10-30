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

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  const peak = Math.max(...X_FOLLOWER_ACTIVITY);
  const pickedHour = hourOf(picked);
  const pickedDay = dayDelta(now, picked);
  const inBand = isInPeakBand(pickedHour);
  const dailyTotal = X_FOLLOWER_ACTIVITY.reduce((sum, value) => sum + value, 0);

  const justification = inBand
    ? `inside the 5–7 PM band · ${Math.round((X_FOLLOWER_ACTIVITY[pickedHour] / dailyTotal) * 100)}% of daily follower activity in this hour`
    : `outside the band · ${Math.round((X_FOLLOWER_ACTIVITY[pickedHour] / peak) * 100)}% of peak activity · fine for replies, weaker for reach`;

  return (
    <Modal open onClose={onCancel} title="Change slot" size="wide"
      description="Follower activity, next 7 days · PT. Darker is busier; the 5–7 PM band is outlined."
      footerPills={<span>Changing the slot doesn’t re-approve · the post stays approved</span>}
      footerActions={<><Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><Button variant="primary" size="sm" onClick={onUse}>Use this slot</Button></>}
    >
      <div className="x-comms-heat-scroll focus-ring" role="region" aria-label="Follower activity by hour" tabIndex={0}>
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
      </div>

      <div className="x-comms-picked">
        <span className="x-comms-picked-value">
          <span>picked</span>
          <strong>{slotLabel(now, picked)}</strong>
        </span>
        <span className="x-comms-picked-why">{justification}</span>
      </div>

    </Modal>
  );
}

/** The grid needs the label and its row as siblings, so the pair cannot be wrapped. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
