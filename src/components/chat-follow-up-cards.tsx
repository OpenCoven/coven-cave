"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { NextPath } from "@/lib/next-paths";

export type FollowUpCardsProps = {
  paths: NextPath[];
  onActivate: (path: NextPath) => void;
  saveAvailable?: boolean;
};

type FollowUpMeta = {
  icon: IconName;
  label: string;
  outcome: string;
};

function metaFor(path: NextPath): FollowUpMeta {
  if (path.kind === "reply") {
    return {
      icon: "ph:chat-circle-dots",
      label: "Reply",
      outcome: "Drafts a reply below",
    };
  }
  if (path.kind === "task") {
    return {
      icon: "ph:check-square",
      label: "Task",
      outcome: "Opens a linked task review",
    };
  }
  if (path.actionId === "save-link") {
    return {
      icon: "ph:link-simple",
      label: "Save",
      outcome: "Opens link destinations",
    };
  }
  return {
    icon: "ph:list-checks",
    label: "Tasks",
    outcome: "Opens Tasks",
  };
}

function keyFor(path: NextPath): string {
  if (path.kind === "action") {
    return `${path.kind}:${path.actionId}:${path.label}:${path.recommended}`;
  }
  return `${path.kind}:${path.label}:${path.recommended}`;
}

/**
 * Presentation-only next steps. The chat surface retains ownership of routing
 * and all side effects through `onActivate`, keeping a card click distinct
 * from sending assistant-produced prompt text.
 */
export function FollowUpCards({ paths, onActivate, saveAvailable = true }: FollowUpCardsProps) {
  if (paths.length === 0) return null;

  return (
    <section className="cave-followup-cards" role="group" aria-label="Suggested next steps">
      <small>Suggested next steps</small>
      <div className="cave-followup-cards__grid">
        {paths.map((path) => {
          const meta = metaFor(path);
          const isRecommended = path.recommended;
          const unavailable = path.kind === "action" && path.actionId === "save-link" && !saveAvailable;
          const accessibleName = `${meta.label} · ${path.label}. ${meta.outcome}${
            isRecommended ? ". Recommended." : ""
          }${unavailable ? ". No links available to save." : ""}`;
          return (
            <button
              key={keyFor(path)}
              type="button"
              className={`cave-followup-card focus-ring${
                isRecommended ? " cave-followup-card--recommended" : ""
              }`}
              onClick={() => onActivate(path)}
              aria-label={accessibleName}
              disabled={unavailable}
            >
              <span className="cave-followup-card__summary">
                <span className="cave-followup-card__type">
                  <Icon name={meta.icon} width={14} aria-hidden />
                  <span>{meta.label}</span>
                </span>
                <span className="cave-followup-card__separator" aria-hidden>
                  ·
                </span>
                <strong className="cave-followup-card__title">{path.label}</strong>
                {isRecommended ? (
                  <span className="cave-followup-card__recommended">Recommended</span>
                ) : null}
              </span>
              <span className="cave-followup-card__outcome">{meta.outcome}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
