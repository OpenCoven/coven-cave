"use client";

import "@/styles/research-topic-decision.css";

import { Button } from "@/components/ui/button";
import type {
  AgenticEvidenceKind,
  AgenticVerificationCheckState,
} from "@/lib/agentic-recommendations";
import { researchRecommendationDisplayText } from "@/lib/research-recommendation-display";
import {
  type ResearchTopicRecommendation,
} from "@/lib/research-topic-recommendations";

const evidenceKindLabels: Record<AgenticEvidenceKind, string> = {
  task: "Task",
  dependency: "Dependency",
  github: "GitHub",
  mission: "Mission",
  "saved-link": "Saved link",
  vault: "Vault",
  session: "Session",
  message: "Message",
  artifact: "Artifact",
};

const verificationLabels: Record<AgenticVerificationCheckState, string> = {
  passed: "Passed",
  pending: "Pending",
  failed: "Failed",
};

const statusLabels: Record<ResearchTopicRecommendation["verification"]["status"], string> = {
  verified: "Verified",
  proposal: "Proposal",
  blocked: "Blocked",
};

export type ResearchTopicDecisionCardProps = {
  recommendation: ResearchTopicRecommendation;
  actionLabel: string;
  busy?: boolean;
  onAction: () => void;
};

export function ResearchTopicDecisionCard({
  recommendation,
  actionLabel,
  busy = false,
  onAction,
}: ResearchTopicDecisionCardProps) {
  const title = researchRecommendationDisplayText(recommendation.payload.topic);
  const goal = researchRecommendationDisplayText(recommendation.inferredGoal);
  const rationale = researchRecommendationDisplayText(recommendation.rationale);
  const rankReasons = recommendation.rankReasons.map(researchRecommendationDisplayText);
  const evidenceCount = recommendation.evidenceRefs.length;
  const approvalLabel = recommendation.application.requiresApproval
    ? "Review required"
    : "No approval required";
  const reversibilityLabel = recommendation.application.reversible
    ? "Reversible"
    : "Not reversible";

  return (
    <article
      className="research-topic-decision"
      aria-label={`Suggested topic, rank ${recommendation.ordinal}: ${title}`}
    >
      <div className="research-topic-decision__rank-rail" aria-label={`Rank ${recommendation.ordinal}`}>
        <span>Rank</span>
        <strong>{String(recommendation.ordinal).padStart(2, "0")}</strong>
      </div>

      <div className="research-topic-decision__body">
        <header className="research-topic-decision__header">
          <div className="research-topic-decision__meta">
            <span
              className="research-topic-decision__status"
              data-status={recommendation.verification.status}
            >
              {statusLabels[recommendation.verification.status]}
            </span>
            <span>{evidenceCount} {evidenceCount === 1 ? "source" : "sources"}</span>
          </div>
          <h4>{title}</h4>
          <p className="research-topic-decision__goal">
            <span>Next step</span>
            {goal}
          </p>
        </header>

        <section className="research-topic-decision__reason" aria-label="Why this surfaced">
          <h5>Why this surfaced</h5>
          <p>{rationale}</p>
          {rankReasons.length > 0 ? (
            <ul className="research-topic-decision__signals">
              {rankReasons.map((reason, index) => (
                <li key={`${index}:${reason}`}>
                  <span>{rankReasons.length === 1 ? "Ranking signal" : `Signal ${index + 1}`}</span>
                  <strong>{reason}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="research-topic-decision__evidence" aria-label="Evidence trail">
          <header>
            <h5>Evidence trail</h5>
            <span>{evidenceCount} linked</span>
          </header>
          <ol className="research-topic-decision__evidence-list">
            {recommendation.evidenceRefs.map((evidence) => (
              <li key={`${evidence.kind}:${evidence.id}`}>
                <span>{evidenceKindLabels[evidence.kind]}</span>
                <strong>{researchRecommendationDisplayText(evidence.label)}</strong>
              </li>
            ))}
          </ol>
        </section>

        <footer className="research-topic-decision__footer">
          <section
            className="research-topic-decision__safety"
            data-status={recommendation.verification.status}
            aria-label="Verification and approval"
          >
            <p>{approvalLabel} · {reversibilityLabel}</p>
            {recommendation.verification.checks.length > 0 ? (
              <details>
                <summary className="focus-ring">View verification checks</summary>
                <ul>
                  {recommendation.verification.checks.map((check) => (
                    <li key={check.id} data-state={check.state}>
                      <strong>{verificationLabels[check.state]}</strong>
                      <span>{researchRecommendationDisplayText(check.detail)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
          <Button
            className="research-topic-decision__action"
            size="sm"
            variant="primary"
            loading={busy}
            disabled={recommendation.verification.status === "blocked"}
            onClick={onAction}
          >
            {busy ? `${actionLabel}…` : actionLabel}
          </Button>
        </footer>
      </div>
    </article>
  );
}
