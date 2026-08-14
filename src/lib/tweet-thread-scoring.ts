import { createHash } from "node:crypto";

import { Value } from "typebox/value";

import {
  compareOrdinalStrings,
  computeThreadCandidateSha256,
  ObjectiveWeightsSchema,
  ThreadCandidateSchema,
  ThreadScorecardSchema,
} from "./tweet-thread-protocol.ts";
import type {
  DeterministicFinding,
  ObjectiveWeights,
  ThreadCandidate,
  ThreadScorecard,
} from "./tweet-thread-protocol.ts";
import {
  createDeterministicFinding,
  validateThreadCandidate,
  type ThreadValidationResult,
} from "./tweet-thread-validation.ts";

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

function auditFinding(
  code: string,
  message: string,
  references: { postId?: string; claimId?: string } = {},
): DeterministicFinding {
  return createDeterministicFinding(
    code,
    "fail",
    message,
    references,
    [code, message, references.postId ?? "", references.claimId ?? ""],
  );
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
  candidateValue: unknown,
  scorecardValue: unknown,
  validation: ThreadValidationResult,
  canonicalSha256: string | null,
  candidateSchemaValid: boolean,
  scorecardSchemaValid: boolean,
  candidateId: string,
  candidateSha256: string,
  scorecardId: string,
): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  const candidateRecord: UnknownRecord = isRecord(candidateValue) ? candidateValue : {};
  const scorecardRecord: UnknownRecord = isRecord(scorecardValue) ? scorecardValue : {};
  if (canonicalSha256 === null) {
    findings.push(auditFinding(
      "candidate-canonical-sha-unavailable",
      `Candidate "${candidateId}" cannot be serialized for canonical SHA-256 verification.`,
    ));
  } else if (candidateSha256 !== canonicalSha256) {
    findings.push(auditFinding(
      "candidate-canonical-sha-mismatch",
      `Candidate "${candidateId}" has candidateSha256 "${candidateSha256}", but canonical content hashes to "${canonicalSha256}".`,
    ));
  }
  if (!scorecardSchemaValid) {
    findings.push(auditFinding(
      "scorecard-protocol-invalid",
      `Scorecard "${String(scorecardId)}" does not match ThreadScorecardSchema.`,
    ));
  }
  if (scorecardRecord.candidateSha256 !== (canonicalSha256 ?? candidateSha256)) {
    findings.push(auditFinding(
      "scorecard-candidate-sha-mismatch",
      `Scorecard "${scorecardId}" is not bound to candidate "${candidateId}".`,
    ));
  }
  if (validation.candidateSha256 !== candidateSha256) {
    findings.push(auditFinding(
      "validation-candidate-sha-mismatch",
      `Validation result is not bound to candidate "${candidateId}".`,
    ));
  }
  const generatedAt = typeof candidateRecord.generatedAt === "string"
    ? Date.parse(candidateRecord.generatedAt)
    : Number.NaN;
  const scoredAt = typeof scorecardRecord.scoredAt === "string"
    ? Date.parse(scorecardRecord.scoredAt)
    : Number.NaN;
  if (Number.isFinite(generatedAt) && Number.isFinite(scoredAt) && scoredAt < generatedAt) {
    findings.push(auditFinding(
      "scorecard-chronology-invalid",
      `Scorecard "${scorecardId}" predates candidate "${candidateId}".`,
    ));
  }
  if (candidateSchemaValid && scorecardSchemaValid) {
    const candidate = candidateValue as ThreadCandidate;
    const scorecard = scorecardValue as ThreadScorecard;
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
  return findings.sort((left, right) =>
    compareOrdinalStrings(left.findingId, right.findingId)
  );
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
  return compareOrdinalStrings(left.candidateId, right.candidateId);
}

function stableAuditComparator(
  left: RankedThreadCandidate,
  right: RankedThreadCandidate,
  discriminators: ReadonlyMap<RankedThreadCandidate, string>,
): number {
  return compareOrdinalStrings(left.candidateId, right.candidateId)
    || compareOrdinalStrings(
      discriminators.get(left) ?? "",
      discriminators.get(right) ?? "",
    );
}

type UnknownRecord = Record<string, unknown>;
interface NormalizedRankingEnvelope {
  candidateValue: unknown;
  scorecardValue: unknown;
  findings: DeterministicFinding[];
  auditHash: string;
}

const AUDIT_MAX_DEPTH = 4;
const AUDIT_MAX_ITEMS = 32;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function auditString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function runtimeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function boundedAuditValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) return { type: "null" };
  if (typeof value === "string") {
    return { type: "string", length: value.length, sha256: hashText(value) };
  }
  if (typeof value === "number") {
    return { type: "number", value: Number.isFinite(value) ? value : String(value) };
  }
  if (typeof value === "boolean" || typeof value === "undefined") {
    return { type: typeof value, value };
  }
  if (typeof value === "bigint") {
    return { type: "bigint", sha256: hashText(value.toString()) };
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return { type: typeof value };
  }
  if (depth >= AUDIT_MAX_DEPTH) return { type: "object", truncated: true };
  if (seen.has(value)) return { type: "object", cycle: true };
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, AUDIT_MAX_ITEMS).map((item) =>
        boundedAuditValue(item, depth + 1, seen)
      );
      return { type: "array", length: value.length, items };
    }
    const record = value as UnknownRecord;
    const keys = Object.keys(record).sort(compareOrdinalStrings);
    return {
      type: "object",
      keyCount: keys.length,
      entries: keys.slice(0, AUDIT_MAX_ITEMS).map((key) => {
        let child: unknown;
        try {
          child = record[key];
        } catch {
          child = { inaccessible: true };
        }
        return [
          hashText(key),
          boundedAuditValue(child, depth + 1, seen),
        ];
      }),
    };
  } catch {
    return { type: "object", inaccessible: true };
  }
}

function auditEnvelopeHash(value: unknown): string {
  return hashText(JSON.stringify(boundedAuditValue(value)));
}

function normalizeRankingEnvelope(value: unknown): NormalizedRankingEnvelope {
  const findings: DeterministicFinding[] = [];
  if (!isRecord(value)) {
    const kind = runtimeKind(value);
    findings.push(auditFinding(
      "ranking-input-envelope-invalid",
      `Ranking input batch entry has runtime type "${kind}"; expected an object envelope.`,
    ));
    return {
      candidateValue: undefined,
      scorecardValue: undefined,
      findings,
      auditHash: auditEnvelopeHash(value),
    };
  }

  let candidateValue: unknown;
  let scorecardValue: unknown;
  try {
    candidateValue = value.candidate;
    scorecardValue = value.scorecard;
  } catch {
    findings.push(auditFinding(
      "ranking-input-envelope-invalid",
      "Ranking input batch entry properties could not be read.",
    ));
  }
  if (
    !Object.prototype.hasOwnProperty.call(value, "candidate")
    || !Object.prototype.hasOwnProperty.call(value, "scorecard")
  ) {
    findings.push(auditFinding(
      "ranking-input-envelope-invalid",
      "Ranking input batch entry must provide candidate and scorecard properties.",
    ));
  }
  return {
    candidateValue,
    scorecardValue,
    findings,
    auditHash: auditEnvelopeHash(value),
  };
}

function schemaCheck(
  schema: typeof ThreadCandidateSchema | typeof ThreadScorecardSchema,
  value: unknown,
): boolean {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
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

  const normalizedInputs = inputs.map((input) => normalizeRankingEnvelope(input));
  const candidateIds = new Set<string>();
  const candidateShas = new Set<string>();
  for (const { candidateValue } of normalizedInputs) {
    if (!schemaCheck(ThreadCandidateSchema, candidateValue)) continue;
    const candidate = candidateValue as ThreadCandidate;
    if (candidateIds.has(candidate.candidateId)) {
      throw new TypeError(`Ranking input contains duplicate candidate ID "${candidate.candidateId}".`);
    }
    candidateIds.add(candidate.candidateId);
    if (candidateShas.has(candidate.candidateSha256)) {
      throw new TypeError(`Ranking input contains duplicate candidate SHA "${candidate.candidateSha256}".`);
    }
    candidateShas.add(candidate.candidateSha256);
  }

  const passing: RankedThreadCandidate[] = [];
  const rejected: RankedThreadCandidate[] = [];
  const auditDiscriminators = new Map<RankedThreadCandidate, string>();
  for (const normalized of normalizedInputs) {
    const { candidateValue, scorecardValue } = normalized;
    const candidateRecord: UnknownRecord = isRecord(candidateValue) ? candidateValue : {};
    const scorecardRecord: UnknownRecord = isRecord(scorecardValue) ? scorecardValue : {};
    const candidateId = auditString(candidateRecord.candidateId, "candidate-invalid");
    const candidateSha256 = auditString(
      candidateRecord.candidateSha256,
      "candidate-sha-unavailable",
    );
    const scorecardId = auditString(scorecardRecord.scorecardId, "scorecard-invalid");
    const candidateSchemaValid = schemaCheck(ThreadCandidateSchema, candidateValue);
    const scorecardSchemaValid = schemaCheck(ThreadScorecardSchema, scorecardValue);
    let canonicalSha256: string | null = null;
    if (candidateSchemaValid) {
      try {
        canonicalSha256 = computeThreadCandidateSha256(candidateValue as ThreadCandidate);
      } catch {
        canonicalSha256 = null;
      }
    }
    const validation = validateThreadCandidate(candidateValue);
    const bindingFindings = scorecardReferenceIssues(
      candidateValue,
      scorecardValue,
      validation,
      canonicalSha256,
      candidateSchemaValid,
      scorecardSchemaValid,
      candidateId,
      candidateSha256,
      scorecardId,
    );
    const validationHasHardGate = !validation.accepted
      || validation.findings.some((finding) => finding.severity === "fail");
    const isRejected = normalized.findings.length > 0
      || bindingFindings.length > 0
      || validationHasHardGate;
    const dimensions = scorecardSchemaValid
      ? dimensionsFromScorecard(scorecardValue as ThreadScorecard)
      : null;
    const result: RankedThreadCandidate = {
      candidateId,
      candidateSha256,
      scorecardId,
      eligible: !isRejected,
      paretoDominated: false,
      weightedTotal: dimensions
        ? weightedMean(dimensions, weights, positiveWeightSum)
        : null,
      dimensions,
      validation,
      findings: [
        ...validation.findings,
        ...normalized.findings,
        ...bindingFindings,
      ].sort((left, right) =>
        compareOrdinalStrings(left.findingId, right.findingId)
      ),
    };
    const findingIds = result.findings.map((finding) => finding.findingId);
    auditDiscriminators.set(result, [
      candidateSchemaValid ? candidateSha256 : "",
      scorecardSchemaValid ? scorecardId : "",
      ...findingIds,
      normalized.auditHash,
    ].join("\u0000"));
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
  rejected.sort((left, right) => stableAuditComparator(left, right, auditDiscriminators));
  return {
    ranked,
    dominated,
    rejected,
    results: [...ranked, ...dominated, ...rejected].sort((left, right) =>
      stableAuditComparator(left, right, auditDiscriminators)
    ),
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
  if (!input.accepted) {
    return { continue: true, reason: "repairable-regression" };
  }
  if (input.currentBestScore >= input.threshold) {
    return { continue: false, reason: "threshold-met" };
  }
  if (input.currentBestScore - input.previousBestScore < input.minimumMeaningfulGain) {
    return { continue: false, reason: "no-meaningful-gain" };
  }
  return { continue: true, reason: "below-threshold" };
}
