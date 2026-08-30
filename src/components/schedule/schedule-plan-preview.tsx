"use client";

import { Icon } from "@/lib/icon";
import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";
import type { SchedulePlan } from "@/lib/schedule-plan-model";
// Component-imported so it code-splits with whatever dialog renders the
// preview. The globals facade has no room: the root CSS bundle every route
// downloads was at 0.6 KB of headroom, and this sheet is ~2 KB.
import "@/styles/schedule-plan.css";

type Props = {
  plan: SchedulePlan;
  /** Labels the live region for assistive tech (e.g. "Cron schedule plan"). */
  ariaLabel?: string;
};

/**
 * The plan echo — `Scheduling Spec.dc.html`'s answer to its own P0: *"No plan
 * preview, no confirmation of behavior; users can't tell what they built until
 * it runs."*
 *
 * Two properties are load-bearing and easy to lose in a refactor:
 *
 * **The slot is reserved.** The spec files a shifting dialog height as a P1 —
 * a card that appears and disappears as you type makes the controls below it
 * move under the cursor. `min-height` holds the space open in every state, so
 * the empty state costs exactly what the parsed state does.
 *
 * **It is a live region.** The plan is the confirmation, so a screen-reader
 * user has to receive it without moving focus out of the field they are
 * typing in — `aria-live="polite"` announces the settled reading rather than
 * every keystroke.
 */
export function SchedulePlanPreview({ plan, ariaLabel = "Schedule plan" }: Props) {
  const prefs = readDateTimePrefs();
  return (
    <div
      aria-live="polite"
      aria-label={ariaLabel}
      className={`schedule-plan schedule-plan--${plan.kind}`}
    >
      <span aria-hidden className="schedule-plan__edge" />
      {plan.kind === "empty" ? (
        <p className="schedule-plan__quiet">
          <Icon name="ph:clock" width={12} aria-hidden />
          the plan and its next runs appear here
        </p>
      ) : null}

      {plan.kind === "unparsed" ? (
        <div className="schedule-plan__row">
          <span className="schedule-plan__pill schedule-plan__pill--warn">
            <Icon name="ph:warning" width={11} aria-hidden />
            UNREAD
          </span>
          {/* The hint carries an example, never an instruction — the spec's
              placeholder grammar. A refusal with nowhere to go is the defect. */}
          <p className="schedule-plan__hint">{plan.hint}</p>
        </div>
      ) : null}

      {plan.kind === "parsed" ? (
        <>
          <div className="schedule-plan__row">
            <span aria-hidden className="schedule-plan__glyph">
              <Icon name="ph:clock" width={12} aria-hidden />
            </span>
            <p className="schedule-plan__sentence">{plan.sentence}</p>
          </div>
          {plan.nextRuns.length > 0 ? (
            <p className="schedule-plan__runs">
              <span className="schedule-plan__runs-label">next</span>
              {plan.nextRuns.map((iso) => (
                <span key={iso} className="schedule-plan__run">
                  {formatTimestamp(iso, prefs)}
                </span>
              ))}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
