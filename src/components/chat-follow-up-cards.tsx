"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { NextPath } from "@/lib/projects/next-paths";

export type FollowUpCardsProps = {
  paths: NextPath[];
  onActivate: (path: NextPath) => void;
  /** The assistant's first suggestion is its recommendation unless suppressed by its owner. */
  recommended?: boolean;
};

type FollowUpMeta = {
  icon: IconName;
  label: string;
  outcome: string;
};

const FOLLOW_UP_META: Record<NextPath["kind"], FollowUpMeta> = {
  reply: {
    icon: "ph:chat-circle-dots",
    label: "Reply",
    outcome: "Drafts a reply below",
  },
  task: {
    icon: "ph:check-square",
    label: "Task",
    outcome: "Opens a linked task review",
  },
  action: {
    icon: "ph:list-checks",
    label: "Action",
    outcome: "Opens Tasks",
  },
};

/**
 * Presentation-only next steps. The chat surface retains ownership of routing
 * and all side effects through `onActivate`, keeping a card click distinct
 * from sending assistant-produced prompt text.
 */
export function FollowUpCards({ paths, onActivate, recommended = true }: FollowUpCardsProps) {
  if (paths.length === 0) return null;

  return (
    <section className="cave-followup-cards" role="group" aria-label="Suggested next steps">
      <small>Suggested next steps</small>
      <div className="cave-followup-cards__grid">
        {paths.map((path, index) => {
          const meta = FOLLOW_UP_META[path.kind];
          const isRecommended = recommended && index === 0;
          const accessibleName = `${meta.label}: ${path.label}. ${meta.outcome}${
            isRecommended ? ". Recommended." : ""
          }${path.metadata ? ` Why this: ${path.metadata.rationale}` : ""}`;
          return (
            <article className="cave-followup-card__entry" key={`${path.kind}:${path.label}:${index}`}>
              <button
                type="button"
                className="cave-followup-card focus-ring"
                onClick={() => onActivate(path)}
                aria-label={accessibleName}
              >
                <span className="cave-followup-card__type">
                  <Icon name={meta.icon} width={14} aria-hidden />
                  {meta.label}
                  {isRecommended ? (
                    <span className="cave-followup-card__recommended">Recommended</span>
                  ) : null}
                </span>
                <span className="cave-followup-card__separator" aria-hidden>
                  ·
                </span>
                <strong className="cave-followup-card__title">{path.label}</strong>
                <span className="cave-followup-card__outcome">{meta.outcome}</span>
              </button>
              {path.metadata ? (
                <details className="cave-followup-card__details">
                  <summary className="focus-ring">Why this?</summary>
                  <p>{path.metadata.rationale}</p>
                  <div className="cave-followup-card__evidence" aria-label="Evidence">
                    <span>Evidence</span>
                    <div>
                      {path.metadata.evidenceRefs.map((evidence) => (
                        <span className="ui-pill" key={`${evidence.kind}:${evidence.id}`}>
                          {evidence.kind}: {evidence.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
