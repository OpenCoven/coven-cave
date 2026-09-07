"use client";

/**
 * Topic proposal card (Unit 2, cave-6sles.11): title, question, whyNow, the
 * recomputed visible score breakdown (all nine dimensions + riskPenalty +
 * visibleTotal), evidence count, exact excerpts, counterevidence, uncertainty,
 * related prior missions, and the suggested mode/effort/source target.
 *
 * "Why this?" expands the evidence inspector. "Dismiss" / "Edit question" are
 * local UI state (the parent owns them — this card never calls the API). "Use
 * this topic" is the one action that leaves the card: it calls `onUse`, which
 * accepts the proposal and hands the draft off to the composer.
 */

import { useState } from "react";
import type { TopicProposalV1 } from "@/lib/research-protocol/topic-discovery";
import { ResearchTopicEvidence } from "./research-topic-evidence";

export type ResearchTopicCardProps = {
  proposal: TopicProposalV1;
  busy?: boolean;
  onUse(proposal: TopicProposalV1): void;
  onDismiss?(proposalId: string): void;
  onEditQuestion?(proposalId: string): void;
};

type ScoreKey =
  | "groundability"
  | "decisionValue"
  | "unresolvedness"
  | "recurrence"
  | "novelty"
  | "timeliness"
  | "familiarFit"
  | "feasibility"
  | "humanResonance";

const SCORE_LABELS: Array<{ key: ScoreKey; label: string }> = [
  { key: "groundability", label: "Groundability" },
  { key: "decisionValue", label: "Decision value" },
  { key: "unresolvedness", label: "Unresolvedness" },
  { key: "recurrence", label: "Recurrence" },
  { key: "novelty", label: "Novelty" },
  { key: "timeliness", label: "Timeliness" },
  { key: "familiarFit", label: "Familiar fit" },
  { key: "feasibility", label: "Feasibility" },
  { key: "humanResonance", label: "Human resonance" },
];

const MODE_LABELS: Record<TopicProposalV1["suggested"]["mode"], string> = {
  brief: "Brief",
  sweep: "Sweep",
  paper: "Paper",
  autoresearch: "Deep loop",
};

export function ResearchTopicCard({
  proposal,
  busy = false,
  onUse,
  onDismiss,
  onEditQuestion,
}: ResearchTopicCardProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const evidenceCount = proposal.evidence.length + proposal.counterevidence.length;

  return (
    <article className="research-topic-card" data-testid="research-topic-card">
      <header className="research-topic-card__head">
        <h3>{proposal.title}</h3>
        <span className="research-topic-card__total" aria-label="Visible score">
          {proposal.scores.visibleTotal.toFixed(2)}
        </span>
      </header>

      <p className="research-topic-card__question">{proposal.question}</p>
      <p className="research-topic-card__why">{proposal.whyNow}</p>

      <dl className="research-topic-card__scores" aria-label="Score breakdown">
        {SCORE_LABELS.map(({ key, label }) => (
          <div key={key} className="research-topic-card__score">
            <dt>{label}</dt>
            <dd>{proposal.scores[key]}</dd>
          </div>
        ))}
        <div className="research-topic-card__score">
          <dt>Risk penalty</dt>
          <dd>{proposal.scores.riskPenalty}</dd>
        </div>
      </dl>

      <p className="research-topic-card__meta">
        {evidenceCount} evidence {evidenceCount === 1 ? "ref" : "refs"} ·{" "}
        {proposal.uncertainty ? `uncertainty: ${proposal.uncertainty}` : ""}
      </p>

      <p className="research-topic-card__suggested">
        {MODE_LABELS[proposal.suggested.mode]} · {proposal.suggested.deliverable} ·{" "}
        {proposal.suggested.sourceTarget} sources · {proposal.suggested.wallClockMinutes} min
      </p>

      {proposal.relatedMissionIds.length > 0 ? (
        <p className="research-topic-card__related">
          Related missions: {proposal.relatedMissionIds.join(", ")}
        </p>
      ) : null}

      <button
        type="button"
        className="research-topic-card__inspector focus-ring"
        aria-expanded={inspectorOpen}
        onClick={() => setInspectorOpen((open) => !open)}
      >
        Why this?
      </button>

      {inspectorOpen ? (
        <div className="research-topic-card__inspector-body">
          <ResearchTopicEvidence refs={proposal.evidence} label="Evidence" />
          <ResearchTopicEvidence refs={proposal.counterevidence} label="Counterevidence" />
        </div>
      ) : null}

      <div className="research-topic-card__actions">
        <button
          type="button"
          className="research-topic-card__action focus-ring"
          onClick={() => onDismiss?.(proposal.id)}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="research-topic-card__action focus-ring"
          onClick={() => onEditQuestion?.(proposal.id)}
        >
          Edit question
        </button>
        <button
          type="button"
          className="research-topic-card__action research-topic-card__action--primary focus-ring"
          disabled={busy}
          onClick={() => onUse(proposal)}
        >
          {busy ? "Opening…" : "Use this topic"}
        </button>
      </div>
    </article>
  );
}
