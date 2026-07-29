"use client";

/**
 * Gate — the merge preconditions (checks, reviews, unresolved threads) as one
 * accordion section of the composer sheet.
 *
 * Presentation only. Every label arrives already derived and every verb is a
 * callback, so the header summary and the expanded rows can never disagree
 * about what the gate says, and `/api/github/rerun` +
 * `/api/github/resolve-thread` stay in `github-card-composer.tsx`.
 */

import { Icon } from "@/lib/icon";

export type GateSectionProps = {
  /** True when this section owns the sheet's single open slot. */
  expanded: boolean;
  onToggle: () => void;
  /** Whether the gate is clear — drives the header glyph. */
  gateOk: boolean;
  checksLabel: string;
  /** Empty when the item has no review data — the row is then omitted. */
  reviewLabel: string;
  threadLabel: string;
  /** The Threads row's note, already derived by the parent: names the file when
   *  exactly one thread is open, otherwise counts them and names the first. */
  threadNote: string;
  unresolvedCount: number;
  failedChecks: number;
  changesRequested: number;
  /** There is at least one check run to re-run. */
  canRerunChecks: boolean;
  checksBusy: boolean;
  threadBusy: boolean;
  onRerunFailedChecks: () => void;
  onResolveFirstThread: () => void;
};

export function GateSection({
  expanded,
  onToggle,
  gateOk,
  checksLabel,
  reviewLabel,
  threadLabel,
  threadNote,
  unresolvedCount,
  failedChecks,
  changesRequested,
  canRerunChecks,
  checksBusy,
  threadBusy,
  onRerunFailedChecks,
  onResolveFirstThread,
}: GateSectionProps) {
  return (
    <>
      <button
        type="button"
        className="ghc-sec focus-ring"
        aria-expanded={expanded}
        aria-label="Gate — checks, reviews and threads"
        onClick={onToggle}
      >
        <span aria-hidden className={`ghc-sec__caret${expanded ? " ghc-sec__caret--open" : ""}`}>
          <Icon name="ph:caret-right" width={11} />
        </span>
        <span aria-hidden className={`ghc-sec__icon ${gateOk ? "ghc-sec__ok" : "ghc-sec__warn"}`}>
          <Icon name={gateOk ? "ph:check-circle" : "ph:warning-circle"} width={13} />
        </span>
        <span className="ghc-sec__title">Gate</span>
        <span className="ghc-sec__summary">
          <span className="ghc-sec__mono">{checksLabel}</span>
          {reviewLabel ? <span>{reviewLabel}</span> : null}
          <span className={unresolvedCount ? "ghc-sec__warn" : "ghc-sec__ok"}>{threadLabel}</span>
        </span>
      </button>
      {expanded ? (
        <div className="ghc-body">
          <div className="ghc-gate-row">
            <span aria-hidden className={`ghc-gate-row__icon ${failedChecks ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
              <Icon name={failedChecks ? "ph:x-circle-fill" : "ph:check-circle"} width={12} />
            </span>
            Checks
            <span className="ghc-gate-row__tail">
              <span className="ghc-gate-row__note">{checksLabel}</span>
              {canRerunChecks ? (
                <button type="button" className="ghc-mini focus-ring" onClick={onRerunFailedChecks} disabled={checksBusy}>
                  {checksBusy ? "…" : "Re-run"}
                </button>
              ) : null}
            </span>
          </div>
          {reviewLabel ? (
            <div className="ghc-gate-row">
              <span aria-hidden className={`ghc-gate-row__icon ${changesRequested ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
                <Icon name={changesRequested ? "ph:warning-circle" : "ph:check-circle"} width={12} />
              </span>
              Reviews
              <span className="ghc-gate-row__tail">
                <span className="ghc-gate-row__note">{reviewLabel}</span>
              </span>
            </div>
          ) : null}
          <div className="ghc-gate-row">
            <span aria-hidden className={`ghc-gate-row__icon ${unresolvedCount ? "ghc-sec__warn" : "ghc-sec__ok"}`}>
              <Icon name={unresolvedCount ? "ph:warning-circle" : "ph:check-circle"} width={12} />
            </span>
            Threads
            <span className="ghc-gate-row__tail">
              <span className="ghc-gate-row__note">{threadNote}</span>
              {unresolvedCount ? (
                <button type="button" className="ghc-mini focus-ring" onClick={onResolveFirstThread} disabled={threadBusy}>
                  {threadBusy ? "…" : "Resolve"}
                </button>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
