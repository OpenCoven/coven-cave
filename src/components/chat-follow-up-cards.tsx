"use client";

import { useId, useRef, useState } from "react";
import { Popover, PopoverBody, usePopoverInitialFocus } from "@/components/ui/popover";
import { Icon, type IconName } from "@/lib/icon";
import type { NextPath } from "@/lib/next-paths";

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

function FollowUpRationale({
  label,
  metadata,
}: {
  label: string;
  metadata: NonNullable<NextPath["metadata"]>;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelId = `followup-rationale-${useId().replaceAll(":", "")}`;
  usePopoverInitialFocus(open, `#${panelId}`);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-followup-card__why-trigger focus-ring"
        aria-label={`Why this suggestion: ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        {/* Icon-only. The accessible name is unaffected: `aria-label` above
            already reads "Why this suggestion: <label>", which is strictly
            more informative than the word it replaces, and the visible "Why"
            was never the accessible name anyway. */}
        <Icon name="ph:info" width={14} height={14} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="top-end"
        className="cave-followup-card__why-popover"
        ariaLabel={`Why this suggestion: ${label}`}
      >
        <PopoverBody className="cave-followup-card__why-body">
          <div id={panelId} className="cave-followup-card__why-panel">
            <div className="cave-followup-card__why-header">
              <span>Why this</span>
              <button
                type="button"
                className="cave-followup-card__why-close focus-ring"
                aria-label="Close explanation"
                onClick={() => setOpen(false)}
              >
                <Icon name="ph:x" width={12} aria-hidden />
              </button>
            </div>
            <p>{metadata.rationale}</p>
            <div className="cave-followup-card__evidence" aria-label="Evidence">
              <span>Evidence</span>
              <div>
                {metadata.evidenceRefs.map((evidence) => (
                  <span className="ui-pill" key={`${evidence.kind}:${evidence.id}`}>
                    {evidence.kind}: {evidence.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </PopoverBody>
      </Popover>
    </>
  );
}

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
                <FollowUpRationale label={path.label} metadata={path.metadata} />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
