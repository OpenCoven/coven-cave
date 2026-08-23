"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PropertyPill } from "@/components/ui/property-pill";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import {
  isAutoApplyAllowed,
  type AgenticEvidenceRef,
  type AgenticVerificationCheckState,
  type RankedAgenticRecommendation,
} from "@/lib/agentic-recommendations";

export type AgenticRecommendationCardState = "ready" | "loading" | "empty" | "blocked" | "error";

export type AgenticRecommendationCardProps = {
  recommendation?: RankedAgenticRecommendation;
  title?: string;
  state?: AgenticRecommendationCardState;
  errorMessage?: string;
  applying?: boolean;
  onApply?: (recommendation: RankedAgenticRecommendation) => void;
  onReview?: (recommendation: RankedAgenticRecommendation) => void;
  onEdit?: (recommendation: RankedAgenticRecommendation) => void;
  onDismiss?: (recommendation: RankedAgenticRecommendation) => void;
  onRevert?: (recommendation: RankedAgenticRecommendation) => void;
  onRetry?: () => void;
  onEvidenceSelect?: (evidence: AgenticEvidenceRef) => void;
};

const verificationLabels: Record<AgenticVerificationCheckState, string> = {
  passed: "Passed",
  pending: "Pending",
  failed: "Failed",
};

function verificationSummary(status: RankedAgenticRecommendation["verification"]["status"]): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "proposal":
      return "Proposal — review before applying";
    case "blocked":
      return "Blocked — resolve verification before applying";
  }
}

function EvidenceChip({
  evidence,
  onSelect,
}: {
  evidence: AgenticEvidenceRef;
  onSelect?: (evidence: AgenticEvidenceRef) => void;
}) {
  const label = `${evidence.kind}: ${evidence.label}`;
  const accessibleName = `Evidence: ${label}`;

  if (onSelect) {
    return (
      <span className="agentic-recommendation-card__evidence-pill">
        <PropertyPill label={label} onClick={() => onSelect(evidence)} title={accessibleName} />
      </span>
    );
  }

  return (
    <span className="ui-pill agentic-recommendation-card__evidence-pill" aria-label={accessibleName}>
      <span className="agentic-recommendation-card__evidence-label">{label}</span>
    </span>
  );
}

export function AgenticRecommendationCard({
  recommendation,
  title = "Recommendation",
  state,
  errorMessage,
  applying = false,
  onApply,
  onReview,
  onEdit,
  onDismiss,
  onRevert,
  onRetry,
  onEvidenceSelect,
}: AgenticRecommendationCardProps) {
  const resolvedState =
    state ?? (recommendation?.verification.status === "blocked" ? "blocked" : recommendation ? "ready" : "empty");

  if (resolvedState === "loading") {
    return (
      <section className="agentic-recommendation-card agentic-recommendation-card--loading" role="status" aria-label="Loading recommendations">
        <span className="sr-only">Loading recommendations…</span>
        <SkeletonGroup>
          <Skeleton variant="text-sm" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="row" />
        </SkeletonGroup>
      </section>
    );
  }

  if (resolvedState === "error") {
    return (
      <ErrorState
        compact
        headline="Couldn't load recommendations"
        subtitle={errorMessage ?? "Retry to check for recommendations again."}
        actions={
          onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!recommendation || resolvedState === "empty") {
    return (
      <EmptyState
        compact
        headline="No recommendations yet"
        subtitle="Refresh after more task context is available."
      />
    );
  }

  const isBlocked = resolvedState === "blocked" || recommendation.verification.status === "blocked";
  const canApply = isAutoApplyAllowed(recommendation) && Boolean(onApply);
  const approvalCopy = recommendation.application.requiresApproval
    ? "Requires approval before applying."
    : "No approval required.";
  const reversibilityCopy = recommendation.application.reversible
    ? "Can be reverted after applying."
    : "Can't be reverted after applying.";

  return (
    <article className="agentic-recommendation-card" aria-label={`${title}, rank ${recommendation.ordinal}`}>
      <header className="agentic-recommendation-card__header">
        <p className="agentic-recommendation-card__rank">Rank #{recommendation.ordinal}</p>
        <div>
          <h3 className="agentic-recommendation-card__title">{title}</h3>
          <p className="agentic-recommendation-card__goal">
            <span>Inferred goal</span>
            {recommendation.inferredGoal}
          </p>
        </div>
      </header>

      <details className="agentic-recommendation-card__why">
        <summary className="focus-ring">Why this recommendation?</summary>
        <p>{recommendation.rationale}</p>
        {recommendation.rankReasons.length > 0 ? (
          <ul>
            {recommendation.rankReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </details>

      <div className="agentic-recommendation-card__evidence" aria-label="Evidence">
        <span className="agentic-recommendation-card__label">Evidence</span>
        <div className="agentic-recommendation-card__pills">
          {recommendation.evidenceRefs.map((evidence) => (
            <EvidenceChip key={`${evidence.kind}:${evidence.id}`} evidence={evidence} onSelect={onEvidenceSelect} />
          ))}
        </div>
      </div>

      <section
        className="agentic-recommendation-card__verification"
        data-status={recommendation.verification.status}
        aria-label="Verification and approval"
      >
        <p>{verificationSummary(recommendation.verification.status)}</p>
        <p>{approvalCopy}</p>
        <p>{reversibilityCopy}</p>
        {isBlocked ? <p className="agentic-recommendation-card__blocked">Blocked — review the checks below.</p> : null}
        {recommendation.verification.checks.length > 0 ? (
          <details className="agentic-recommendation-card__checks">
            <summary className="focus-ring">Verification details</summary>
            <ul>
              {recommendation.verification.checks.map((check) => (
                <li key={check.id} data-state={check.state}>
                  {verificationLabels[check.state]} — {check.detail}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <footer className="agentic-recommendation-card__actions" aria-label="Recommendation actions">
        <Button
          variant="primary"
          size="sm"
          loading={applying}
          disabled={!canApply}
          aria-label="Apply recommendation"
          onClick={() => {
            if (!isAutoApplyAllowed(recommendation)) return;
            onApply?.(recommendation);
          }}
        >
          Apply
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!onReview}
          aria-label="Review recommendation"
          onClick={() => onReview?.(recommendation)}
        >
          Review
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!onEdit}
          aria-label="Edit recommendation"
          onClick={() => onEdit?.(recommendation)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!onDismiss}
          aria-label="Dismiss recommendation"
          onClick={() => onDismiss?.(recommendation)}
        >
          Dismiss
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!recommendation.application.reversible || !onRevert}
          aria-label="Revert recommendation"
          onClick={() => onRevert?.(recommendation)}
        >
          Revert
        </Button>
      </footer>
    </article>
  );
}
