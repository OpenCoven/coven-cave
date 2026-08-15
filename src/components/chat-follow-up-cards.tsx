"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { NextPath } from "@/lib/next-paths";

export type FollowUpCardsProps = {
  paths: NextPath[];
  onActivate: (path: NextPath) => void;
};

type FollowUpMeta = {
  icon: IconName;
  label: string;
  outcome: string;
};

type ActionNextPath = Extract<NextPath, { kind: "action" }>;
type NonActionKind = Exclude<NextPath["kind"], "action">;

const FOLLOW_UP_META: Record<NonActionKind, FollowUpMeta> = {
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
};

const ACTION_FOLLOW_UP_META: Record<ActionNextPath["actionId"], FollowUpMeta> = {
  "save-link": {
    icon: "ph:link-simple",
    label: "Save",
    outcome: "Opens link destinations",
  },
  "open-tasks": {
    icon: "ph:list-checks",
    label: "Tasks",
    outcome: "Opens Tasks",
  },
};

function followUpMetaFor(path: NextPath): FollowUpMeta {
  return path.kind === "action" ? ACTION_FOLLOW_UP_META[path.actionId] : FOLLOW_UP_META[path.kind];
}

/**
 * Presentation-only next steps. The chat surface retains ownership of routing
 * and all side effects through `onActivate`, keeping a card click distinct
 * from sending assistant-produced prompt text.
 */
export function FollowUpCards({ paths, onActivate }: FollowUpCardsProps) {
  if (paths.length === 0) return null;

  return (
    <section className="cave-followup-cards" role="group" aria-label="Suggested next steps">
      <small>Suggested next steps</small>
      <div className="cave-followup-cards__grid">
        {paths.map((path) => {
          const meta = followUpMetaFor(path);
          const accessibleName = `${meta.label}: ${path.label}. ${meta.outcome}. ${
            path.recommended ? "Recommended." : "Not recommended."
          }`;
          const key = path.kind === "action"
            ? `${path.kind}:${path.actionId}:${path.label}:${path.prompt}`
            : `${path.kind}:${path.label}:${path.prompt}`;
          return (
            <button
              key={key}
              type="button"
              className={`cave-followup-card${path.recommended ? " cave-followup-card--recommended" : ""} focus-ring`}
              onClick={() => onActivate(path)}
              aria-label={accessibleName}
            >
              <span className="cave-followup-card__type">
                <Icon name={meta.icon} width={14} aria-hidden />
                {meta.label}
                {path.recommended ? (
                  <span className="cave-followup-card__recommended">Recommended</span>
                ) : null}
              </span>
              <span className="cave-followup-card__separator" aria-hidden>
                ·
              </span>
              <strong className="cave-followup-card__title">{path.label}</strong>
              <span className="cave-followup-card__outcome">{meta.outcome}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
