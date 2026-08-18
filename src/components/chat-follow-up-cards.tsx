"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { NextPath } from "@/lib/next-paths";

export type FollowUpCardsProps = {
  paths: NextPath[];
  onActivate: (path: NextPath) => void;
  /**
   * Presentation-only truthful availability for the "Save link" action,
   * computed by the owning chat surface from this card's EXACT source turn
   * (e.g. via `linksFromFollowUpSource(sourceText).length > 0`). FollowUpCards
   * never parses source text or infers availability itself — recommendation
   * never grants authority here either. `undefined` is treated as available
   * so callers that never render a save-link path need no wiring.
   */
  saveLinkAvailable?: boolean;
};

type FollowUpMeta = {
  icon: IconName;
  typeLabel: string;
  outcome: string;
};

function followUpMetaFor(path: NextPath): FollowUpMeta {
  if (path.kind === "reply") {
    return {
      icon: "ph:chat-circle-dots",
      typeLabel: "Reply",
      outcome: "Drafts a reply below",
    };
  }

  if (path.kind === "task") {
    return {
      icon: "ph:check-square",
      typeLabel: "Task",
      outcome: "Opens a linked task review",
    };
  }

  if (path.actionId === "save-link") {
    return {
      icon: "ph:link-simple",
      typeLabel: "Save",
      outcome: "Opens link destinations",
    };
  }

  if (path.actionId === "open-tasks") {
    return {
      icon: "ph:list-checks",
      typeLabel: "Tasks",
      outcome: "Opens Tasks",
    };
  }

  const unsupportedAction: never = path.actionId;
  throw new Error(`Unsupported follow-up action: ${unsupportedAction}`);
}

/**
 * Presentation-only next steps. The chat surface retains ownership of routing
 * and all side effects through `onActivate`, keeping a card click distinct
 * from sending assistant-produced prompt text.
 */
export function FollowUpCards({ paths, onActivate, saveLinkAvailable }: FollowUpCardsProps) {
  if (paths.length === 0) return null;

  return (
    <section className="cave-followup-cards" role="group" aria-label="Suggested next steps">
      <small>Suggested next steps</small>
      <div className="cave-followup-cards__grid">
        {paths.map((path, index) => {
          const meta = followUpMetaFor(path);
          // Truthful, presentation-only unavailability: only the save-link
          // action can ever be unavailable, and only when the caller (which
          // owns the exact source turn) says so. Recommendation never grants
          // authority — a recommended save-link path with no links is still
          // unavailable.
          const unavailable = path.kind === "action" && path.actionId === "save-link" && saveLinkAvailable === false;
          const accessibleNameParts = [
            `${meta.typeLabel}: ${path.label}.`,
            `${meta.outcome}.`,
          ];
          if (path.recommended) accessibleNameParts.push("Recommended.");
          if (unavailable) accessibleNameParts.push("No links available to save.");
          const accessibleName = accessibleNameParts.join(" ");
          const keyBase = `${path.kind}:${path.kind === "action" ? path.actionId : "default"}:${path.prompt}:${path.recommended}`;
          return (
            <button
              key={`${keyBase}:${index}`}
              type="button"
              className={`cave-followup-card focus-ring${path.recommended ? " cave-followup-card--recommended" : ""}`}
              // aria-disabled rather than disabled: the control stays
              // focusable/clickable so a keyboard or screen-reader user can
              // still reach it and hear the truthful reason it's
              // unavailable. onActivate stays unconditional below — ChatView
              // remains the sole authority for routing (it already announces
              // "No links available to save" and never opens an empty
              // picker); this component only ever reports state.
              aria-disabled={unavailable || undefined}
              onClick={() => onActivate(path)}
              aria-label={accessibleName}
            >
              <span className="cave-followup-card__type">
                <Icon name={meta.icon} width={14} aria-hidden />
                {meta.typeLabel}
              </span>
              <span className="cave-followup-card__separator" aria-hidden>
                ·
              </span>
              <strong className="cave-followup-card__title">{path.label}</strong>
              {path.recommended ? (
                <>
                  <span className="cave-followup-card__recommended-indicator" aria-hidden="true">
                    <Icon name="ph:seal-check" width={12} />
                  </span>
                  <span className="cave-followup-card__recommended">Recommended</span>
                </>
              ) : null}
              <span className="cave-followup-card__outcome">{meta.outcome}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
