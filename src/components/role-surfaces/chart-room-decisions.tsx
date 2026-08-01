"use client";

/**
 * chart-room-decisions — what is owed by the operator.
 *
 * A decision here is a real card flagged `needsHuman`. The board records that
 * a card is waiting on a person; it does not record a framed question with
 * options, tradeoffs and a recommendation — so the ledger shows the real thing:
 * the card, what it says, how long it has waited, and the work stacked behind
 * it. Where a card carries no framing, the ledger says so rather than inventing
 * one.
 *
 * "Answered" clears `needsHuman` on the real card, for every surface.
 */

import type { CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { ChartDot } from "./chart-room-parts";
import { SurfaceEmpty } from "./surface-room";
import { stageName, type ChartDecision } from "./chart-room-model";

export function ChartRoomDecisions({
  decisions,
  openId,
  resolvedCount,
  pendingId,
  projectColor,
  projectName,
  onToggle,
  onAnswer,
  onReveal,
  onOpenStep,
  scopeLabel,
}: {
  decisions: readonly ChartDecision[];
  openId: string | null;
  resolvedCount: number;
  pendingId: string | null;
  projectColor: (id: string | null) => string | null;
  projectName: (id: string | null) => string;
  onToggle: (id: string) => void;
  onAnswer: (id: string) => void;
  onReveal: (id: string) => void;
  onOpenStep: (id: string) => void;
  scopeLabel: string;
}) {
  if (decisions.length === 0) {
    return (
      <SurfaceEmpty
        iconName="ph:check-circle"
        title={
          scopeLabel === "All projects"
            ? "Nothing owed. The flow is yours to run."
            : `No decisions owed in ${scopeLabel}.`
        }
        hint="A card flagged as needing a human lands here."
      />
    );
  }

  return (
    <div className="cr-ledger">
      <p className="cr-ledger__summary">
        <Icon name="ph:scales" width={13} height={13} aria-hidden />
        <span>
          {decisions.length} owed — {decisions[0]?.question}
          {resolvedCount > 0 ? ` · ${resolvedCount} answered this week, in the log` : ""}
        </span>
      </p>
      <ul className="cr-ledger__rail">
        {decisions.map((decision) => {
          const isOpen = openId === decision.stepId;
          return (
            <li key={decision.stepId} className="cr-decision" data-open={isOpen}>
              <button
                type="button"
                className="cr-decision__toggle focus-ring-inset"
                aria-expanded={isOpen}
                onClick={() => onToggle(decision.stepId)}
              >
                <span className="cr-node__top">
                  <Icon name="ph:scales" width={12} height={12} aria-hidden />
                  <ChartDot color={projectColor(decision.project)} />
                  <span className="cr-mono">{projectName(decision.project)}</span>
                  <span className="cr-lens__spacer" />
                  <span className="cr-decision__age">
                    <Icon name="ph:clock" width={9} height={9} aria-hidden />
                    waiting {relativeTime(decision.updatedAt)}
                  </span>
                  <Icon name={isOpen ? "ph:caret-up" : "ph:caret-down"} width={11} height={11} aria-hidden />
                </span>
                <span className="cr-decision__question">{decision.question}</span>
              </button>

              {isOpen ? (
                <div className="cr-decision__body">
                  {decision.framing ? (
                    <p className="cr-decision__framing">
                      <Icon name="ph:note" width={11} height={11} aria-hidden />
                      <span>{decision.framing}</span>
                    </p>
                  ) : (
                    <p className="cr-decision__framing">
                      <Icon name="ph:note" width={11} height={11} aria-hidden />
                      <span>
                        The card carries no notes, so there is nothing framing this beyond its title. Open it to
                        write down what the call actually is.
                      </span>
                    </p>
                  )}

                  <div className="cr-decision__blocking">
                    <span className="cr-eyebrow">
                      {decision.blocking.length === 0
                        ? "Nothing waits on this"
                        : `${decision.blocking.length} step${decision.blocking.length > 1 ? "s" : ""} wait on this`}
                    </span>
                    {decision.blocking.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        className="cr-decision__blocking-row focus-ring"
                        style={
                          projectColor(step.project)
                            ? ({ "--cr-dot": projectColor(step.project) as string } as CSSProperties)
                            : undefined
                        }
                        onClick={() => onOpenStep(step.id)}
                      >
                        <ChartDot color={projectColor(step.project)} />
                        <span className="cr-chain__title">{step.title}</span>
                        <span className="cr-eyebrow">{stageName(step.stage)}</span>
                      </button>
                    ))}
                  </div>

                  <div className="cr-decision__foot">
                    <button
                      type="button"
                      className="cr-btn cr-btn--primary focus-ring"
                      disabled={pendingId === decision.stepId}
                      onClick={() => onAnswer(decision.stepId)}
                    >
                      <Icon name="ph:check" width={10} height={10} aria-hidden />
                      {pendingId === decision.stepId ? "Answering…" : "Mark answered"}
                    </button>
                    <button type="button" className="cr-btn focus-ring" onClick={() => onOpenStep(decision.stepId)}>
                      Open the card
                    </button>
                    <span className="cr-lens__spacer" />
                    <button
                      type="button"
                      className="cr-btn cr-btn--quiet focus-ring"
                      onClick={() => onReveal(decision.stepId)}
                    >
                      In the flow <Icon name="ph:arrow-up-right" width={9} height={9} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
