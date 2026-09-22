"use client";

/**
 * ProposalReviewCard — the in-thread receipt for a reviewer's verdict on a
 * proposed action (`<coven:proposal-review>` markers, proposal-review-blocks.ts).
 * Modeled on AutoStatusCard, minus any affordance: this card is evidence only.
 * It renders no approve/deny controls and grants no execution authority; a
 * model's self-reported confidence is not an application-verifiable admission
 * condition (AGENTS.md). Verdicts use a semantic tint AND text, so colour is
 * never the only signal, and confidence is shown as text rather than a meter
 * that would imply calibration.
 */

import { Icon } from "@/lib/icon";
import type { ProposalReview, ProposalReviewVerdict } from "@/lib/proposal-review-blocks";

export const PROPOSAL_REVIEW_EVIDENCE_COPY = "Review verdicts are evidence, not permission.";

function verdictVisual(verdict: ProposalReviewVerdict): {
  label: string;
  cls: string;
  icon: Parameters<typeof Icon>[0]["name"];
} {
  switch (verdict) {
    case "permit":
      return { label: "review: permit", cls: "text-[var(--color-success)]", icon: "ph:check-circle" };
    case "proposal_only":
      return { label: "review: proposal only", cls: "text-[var(--color-warning)]", icon: "ph:hand-palm" };
    case "reject":
      return { label: "review: reject", cls: "text-[var(--color-danger)]", icon: "ph:x-circle" };
    case "unavailable":
      return { label: "review unavailable", cls: "text-[var(--text-secondary)]", icon: "ph:question" };
  }
}

/** `addresses_task` → `addresses task`; ids are machine tokens, not copy. */
export function humanizeAnswerId(id: string): string {
  return id.replace(/[_-]+/g, " ").trim();
}

export function formatConfidence(confidence: number | null): string | null {
  if (confidence === null) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

export function ProposalReviewCard({ review }: { review: ProposalReview }) {
  const v = verdictVisual(review.verdict);
  const subject = review.target ? `${review.tool} → ${review.target}` : review.tool;
  return (
    <div
      className="cave-proposal-review-card flex flex-col gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-2 text-[length:var(--text-xs)]"
      data-verdict={review.verdict}
      role="group"
      aria-label={`Proposal review: ${v.label}${review.reason ? ` — ${review.reason}` : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className={`inline-flex shrink-0 ${v.cls}`}>
          <Icon name={v.icon} width={13} />
        </span>
        <span className={`${v.cls} shrink-0 font-medium`}>{v.label}</span>
        <span className="min-w-0 truncate font-mono text-[var(--text-primary)]" title={subject}>
          {subject}
        </span>
        {review.reason ? (
          <span className="min-w-0 truncate text-[var(--text-secondary)]" title={review.reason}>
            {review.reason}
          </span>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[var(--text-secondary)]">
        {review.answers.map((answer) => {
          const confidence = formatConfidence(answer.confidence);
          return (
            <li key={answer.id} className="flex items-baseline gap-1">
              <span>{humanizeAnswerId(answer.id)}</span>
              <span aria-hidden>—</span>
              <span className="text-[var(--text-primary)]">{answer.answer}</span>
              {confidence ? <span className="text-[var(--text-muted)]">· {confidence}</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
        {review.reviewer ? `${review.reviewer} · ` : ""}
        {PROPOSAL_REVIEW_EVIDENCE_COPY}
      </p>
    </div>
  );
}
