import { createHash } from "node:crypto";

import { Value } from "typebox/value";

import {
  ObjectiveWeightsSchema,
  ThreadScorecardSchema,
} from "./tweet-thread-protocol.ts";
import type {
  DeterministicFinding,
  ObjectiveWeights,
  ThreadCandidate,
  ThreadScorecard,
} from "./tweet-thread-protocol.ts";
import type { ThreadValidationResult } from "./tweet-thread-validation.ts";

const DIMENSIONS = [
  "factuality",
  "provenance",
  "accessibility",
  "voice",
  "coherence",
  "engagement",
] as const;
const TIE_BREAK_DIMENSIONS = [
  "factuality",
  "provenance",
  "accessibility",
  "coherence",
  "voice",
] as const;

type Dimension = typeof DIMENSIONS[number];
export type ThreadDimensionScores = Record<Dimension, number>;

export interface ThreadCandidateRankingInput {
  candidate: ThreadCandidate;
  scorecard: ThreadScorecard;
  validation: ThreadValidationResult;
}

export interface RankedThreadCandidate {
  candidateId: string;
  candidateSha256: string;
  scorecardId: string;
  eligible: boolean;
  paretoDominated: boolean;
  weightedTotal: number | null;
  dimensions: ThreadDimensionScores | null;
  validation: ThreadValidationResult;
  findings: DeterministicFinding[];
}

export interface ThreadRankingResult {
  ranked: RankedThreadCandidate[];
  dominated: RankedThreadCandidate[];
  rejected: RankedThreadCandidate[];
  results: RankedThreadCandidate[];
}

export interface OptimizationContinuationInput {
  currentBestScore: number;
  previousBestScore: number;
  accepted: boolean;
  hardRegression: boolean;
  threshold: number;
  minimumMeaningfulGain: number;
  budgetExhausted: boolean;
}

export type OptimizationContinuationDecision =
  | { continue: true; reason: "below-threshold" | "repairable-regression" }
  | {
    continue: false;
    reason: "threshold-met" | "no-meaningful-gain" | "budget-exhausted" | "hard-regression";
  };

function findingId(parts: readonly string[]): string {
  const hash = createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 16);
  return `finding-${hash}`;
}

function auditFinding(
  code: string,
  message: string,
  references: { postId?: string; claimId?: string } = {},
): DeterministicFinding {
  return {
    findingId: findingId([code, message, references.postId ?? "", references.claimId ?? ""]),
    code,
    severity: "fail",
    message,
    ...(references.postId ? { postId: references.postId } : {}),
    ...(references.claimId ? { claimId: references.claimId } : {}),
  };
}

function dimensionsFromScorecard(scorecard: ThreadScorecard): ThreadDimensionScores {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension,
    scorecard.dimensions[dimension].score,
  ])) as ThreadDimensionScores;
}

function weightedMean(
  dimensions: ThreadDimensionScores,
  weights: ObjectiveWeights,
  positiveWeightSum: number,
): number {
  const weightedSum = DIMENSIONS.reduce(
    (sum, dimension) => sum + dimensions[dimension] * weights[dimension],
    0,
  );
  return Number((weightedSum / positiveWeightSum).toFixed(12));
}

function scorecardReferenceIssues(
  candidate: ThreadCandidate,
  scorecard: ThreadScorecard,
  validation: ThreadValidationResult,
): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  const scorecardId = scorecard.scorecardId;
  if (!Value.Check(ThreadScorecardSchema, scorecard)) {
    findings.push(auditFinding(
      "scorecard-protocol-invalid",
      `Scorecard "${String(scorecardId)}" does not match ThreadScorecardSchema.`,
    ));
  }
  if (scorecard.candidateSha256 !== candidate.candidateSha256) {
    findings.push(auditFinding(
      "scorecard-candidate-sha-mismatch",
      `Scorecard "${String(scorecard.scorecardId)}" is not bound to candidate "${candidate.candidateId}".`,
    ));
  }
  if (validation.candidateSha256 !== candidate.candidateSha256) {
    findings.push(auditFinding(
      "validation-candidate-sha-mismatch",
      `Validation result is not bound to candidate "${candidate.candidateId}".`,
    ));
  }
  const generatedAt = Date.parse(candidate.generatedAt);
  const scoredAt = Date.parse(scorecard.scoredAt);
  if (Number.isFinite(generatedAt) && Number.isFinite(scoredAt) && scoredAt < generatedAt) {
    findings.push(auditFinding(
      "scorecard-chronology-invalid",
      `Scorecard "${String(scorecard.scorecardId)}" predates candidate "${candidate.candidateId}".`,
    ));
  }
  if (Value.Check(ThreadScorecardSchema, scorecard)) {
    const postIds = new Set(candidate.posts.map((post) => post.postId));
    const claimIds = new Set(candidate.evidence.map((item) => item.claimId));
    for (const dimension of DIMENSIONS) {
      for (const finding of scorecard.dimensions[dimension].findings) {
        if (finding.postId && !postIds.has(finding.postId)) {
          findings.push(auditFinding(
            "scorecard-finding-post-missing",
            `Scorecard finding "${finding.findingId}" references missing post "${finding.postId}".`,
            { postId: finding.postId },
          ));
        }
        if (finding.claimId && !claimIds.has(finding.claimId)) {
          findings.push(auditFinding(
            "scorecard-finding-claim-missing",
            `Scorecard finding "${finding.findingId}" references missing claim "${finding.claimId}".`,
            { claimId: finding.claimId },
          ));
        }
      }
    }
  }
  return findings.sort((left, right) => left.findingId.localeCompare(right.findingId));
}

function dominates(
  left: ThreadDimensionScores,
  right: ThreadDimensionScores,
): boolean {
  return DIMENSIONS.every((dimension) => left[dimension] >= right[dimension])
    && DIMENSIONS.some((dimension) => left[dimension] > right[dimension]);
}

function rankingComparator(
  left: RankedThreadCandidate,
  right: RankedThreadCandidate,
): number {
  const leftTotal = left.weightedTotal ?? Number.NEGATIVE_INFINITY;
  const rightTotal = right.weightedTotal ?? Number.NEGATIVE_INFINITY;
  if (leftTotal !== rightTotal) return rightTotal - leftTotal;
  for (const dimension of TIE_BREAK_DIMENSIONS) {
    const leftScore = left.dimensions?.[dimension] ?? Number.NEGATIVE_INFINITY;
    const rightScore = right.dimensions?.[dimension] ?? Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) return rightScore - leftScore;
  }
  return left.candidateId.localeCompare(right.candidateId);
}

function stableAuditComparator(
  left: RankedThreadCandidate,
  right: RankedThreadCandidate,
): number {
  return left.candidateId.localeCompare(right.candidateId)
    || left.candidateSha256.localeCompare(right.candidateSha256)
    || left.scorecardId.localeCompare(right.scorecardId);
}

export function rankThreadCandidates(
  inputs: readonly ThreadCandidateRankingInput[],
  weights: ObjectiveWeights,
): ThreadRankingResult {
  if (!Value.Check(ObjectiveWeightsSchema, weights)) {
    throw new TypeError("Objective weights must match ObjectiveWeightsSchema.");
  }
  const positiveWeightSum = DIMENSIONS.reduce(
    (sum, dimension) => sum + weights[dimension],
    0,
  );
  if (!(positiveWeightSum > 0)) {
    throw new RangeError("Ranking requires at least one positive objective weight.");
  }

  const passing: RankedThreadCandidate[] = [];
  const rejected: RankedThreadCandidate[] = [];
  for (const { candidate, scorecard, validation } of inputs) {
    const bindingFindings = scorecardReferenceIssues(candidate, scorecard, validation);
    const validationHasHardGate = !validation.accepted
      || validation.findings.some((finding) => finding.severity === "fail");
    const isRejected = bindingFindings.length > 0 || validationHasHardGate;
    const scorecardValid = Value.Check(ThreadScorecardSchema, scorecard);
    const dimensions = scorecardValid ? dimensionsFromScorecard(scorecard) : null;
    const result: RankedThreadCandidate = {
      candidateId: candidate.candidateId,
      candidateSha256: candidate.candidateSha256,
      scorecardId: scorecard.scorecardId,
      eligible: !isRejected,
      paretoDominated: false,
      weightedTotal: dimensions
        ? weightedMean(dimensions, weights, positiveWeightSum)
        : null,
      dimensions,
      validation,
      findings: [...validation.findings, ...bindingFindings].sort((left, right) =>
        left.findingId.localeCompare(right.findingId)
      ),
    };
    if (isRejected) rejected.push(result);
    else passing.push(result);
  }

  const dominated: RankedThreadCandidate[] = [];
  const nonDominated: RankedThreadCandidate[] = [];
  for (const candidate of passing) {
    const isDominated = passing.some((other) =>
      other !== candidate
      && other.dimensions !== null
      && candidate.dimensions !== null
      && dominates(other.dimensions, candidate.dimensions)
    );
    if (isDominated) {
      candidate.eligible = false;
      candidate.paretoDominated = true;
      dominated.push(candidate);
    } else {
      nonDominated.push(candidate);
    }
  }

  const ranked = nonDominated.sort(rankingComparator);
  dominated.sort(rankingComparator);
  rejected.sort(stableAuditComparator);
  return {
    ranked,
    dominated,
    rejected,
    results: [...ranked, ...dominated, ...rejected].sort(stableAuditComparator),
  };
}

export function shouldContinueOptimization(
  input: OptimizationContinuationInput,
): OptimizationContinuationDecision {
  if (input.budgetExhausted) {
    return { continue: false, reason: "budget-exhausted" };
  }
  if (input.hardRegression) {
    return { continue: false, reason: "hard-regression" };
  }
  if (input.currentBestScore >= input.threshold) {
    return { continue: false, reason: "threshold-met" };
  }
  if (!input.accepted) {
    return { continue: true, reason: "repairable-regression" };
  }
  if (input.currentBestScore - input.previousBestScore < input.minimumMeaningfulGain) {
    return { continue: false, reason: "no-meaningful-gain" };
  }
  return { continue: true, reason: "below-threshold" };
}
