"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import { formatElapsed, type LiveRunView } from "@/lib/automations/live-run";
import "@/styles/live-run-card.css";

type Props = {
  view: LiveRunView;
  onDismiss: () => void;
  /** Opens the cron's detail pane, where the run history and logs live. */
  onOpenCron?: () => void;
};

/**
 * The visible half of a run you started.
 *
 * "Run now" already announces itself through `useAnnouncer`, which writes into
 * an `sr-only` live region — so assistive tech hears the run start and a
 * sighted user sees a button stop being busy and nothing else. `cave-06qka`
 * records the same asymmetry on the Review Deck. This is the seen half.
 *
 * `aria-hidden` for exactly that reason: the announcement already exists, and
 * a screen reader should not hear every run twice.
 *
 * What it deliberately does NOT draw — because `AutomationRunRecord` carries
 * none of it — is a progress bar, a stage breakdown, or output chips. A bar
 * advancing on a duration nothing predicts would be the card lying about a run
 * in flight, which is worse than a card that says "Running… 40s".
 */
export function LiveRunCard({ view, onDismiss, onOpenCron }: Props) {
  // Tick only while unsettled, so a finished card is not re-rendering forever
  // in the corner of the surface.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (view.settled) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [view.settled]);

  return (
    <div aria-hidden className={`live-run-card live-run-card--${view.phase}`}>
      <span className="live-run-card__mark">
        {view.phase === "running" ? (
          <span className="live-run-card__pulse" />
        ) : (
          <Icon name={view.phase === "failed" ? "ph:x-circle-fill" : "ph:check-circle-fill"} width={14} />
        )}
      </span>

      <span className="live-run-card__body">
        <span className="live-run-card__head">
          <span className="live-run-card__name">{view.name}</span>
          <span className="live-run-card__elapsed">{formatElapsed(view.elapsedMs)}</span>
        </span>
        <span className="live-run-card__headline">{view.headline}</span>
        {view.summary ? <span className="live-run-card__summary">{view.summary}</span> : null}
      </span>

      {onOpenCron ? (
        <button type="button" className="live-run-card__link focus-ring" onClick={onOpenCron}>
          details
        </button>
      ) : null}
      <IconButton
        icon="ph:x"
        size="xs"
        aria-label={`Dismiss run card for ${view.name}`}
        onClick={onDismiss}
        className="live-run-card__dismiss"
      />
    </div>
  );
}
