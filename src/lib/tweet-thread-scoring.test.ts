import assert from "node:assert/strict";

import {
  TWEET_THREAD_PROTOCOL_VERSION,
  computeThreadCandidateSha256,
} from "./tweet-thread-protocol.ts";
import type {
  ObjectiveWeights,
  ThreadCandidate,
  ThreadCandidateCanonicalContent,
  ThreadScorecard,
  ThreadScorecardDimensions,
} from "./tweet-thread-protocol.ts";
import {
  rankThreadCandidates,
  shouldContinueOptimization,
} from "./tweet-thread-scoring.ts";
import { validateThreadCandidate } from "./tweet-thread-validation.ts";

const GENERATED_AT = "2026-08-14T12:00:00.000Z";
const SCORED_AT = "2026-08-14T12:05:00.000Z";
const DIMENSIONS = [
  "factuality",
  "provenance",
  "accessibility",
  "voice",
  "coherence",
  "engagement",
] as const;
type Dimension = typeof DIMENSIONS[number];

const equalWeights: ObjectiveWeights = {
  factuality: 1,
  provenance: 1,
  accessibility: 1,
  voice: 1,
  coherence: 1,
  engagement: 1,
};

function candidate(candidateId: string, text = "A valid post."): ThreadCandidate {
  const content: ThreadCandidateCanonicalContent = {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId,
    brief: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      briefId: "brief-scoring",
      topic: "Candidate ranking",
      audience: "Protocol implementers",
      objectiveWeights: equalWeights,
      constraints: {
        minPosts: 1,
        maxPosts: 2,
        requiredClaimIds: ["claim-ranking"],
        bannedPhrases: [],
        requireAltText: false,
      },
    },
    voiceProfile: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      voiceProfileId: "voice-scoring",
      displayName: "Scoring voice",
      tone: "Precise",
      do: ["Be exact"],
      dont: ["Invent"],
    },
    evidence: [{
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: `evidence-${candidateId}`,
      claimId: "claim-ranking",
      summary: "Ranking remains deterministic.",
      sourceLabel: "Approved protocol",
      retrievedAt: GENERATED_AT,
    }],
    posts: [{
      postId: "post-1",
      text,
      claimIds: ["claim-ranking"],
    }],
    generatedAt: GENERATED_AT,
  };
  return {
    ...content,
    candidateSha256: computeThreadCandidateSha256(content),
  };
}

function dimensions(scores: Partial<Record<Dimension, number>> = {}): ThreadScorecardDimensions {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension,
    {
      dimension,
      score: scores[dimension] ?? 0.5,
      rationale: `${dimension} score`,
      findings: [],
    },
  ])) as unknown as ThreadScorecardDimensions;
}

function scorecard(
  input: ThreadCandidate,
  scores: Partial<Record<Dimension, number>> = {},
): ThreadScorecard {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    scorecardId: `scorecard-${input.candidateId}`,
    candidateSha256: input.candidateSha256,
    scoredAt: SCORED_AT,
    dimensions: dimensions(scores),
  };
}

function rankingInput(
  input: ThreadCandidate,
  scores: Partial<Record<Dimension, number>> = {},
) {
  return {
    candidate: input,
    scorecard: scorecard(input, scores),
    validation: validateThreadCandidate(input),
  };
}

{
  const a = candidate("candidate-a");
  const b = candidate("candidate-b");
  const rejected = candidate("candidate-rejected", "界".repeat(141));
  const result = rankThreadCandidates([
    rankingInput(b, {
      factuality: 0.7,
      provenance: 0.7,
      accessibility: 0.7,
      voice: 0.7,
      coherence: 0.7,
      engagement: 0.7,
    }),
    rankingInput(rejected, {
      factuality: 1,
      provenance: 1,
      accessibility: 1,
      voice: 1,
      coherence: 1,
      engagement: 1,
    }),
    rankingInput(a, {
      factuality: 0.8,
      provenance: 0.8,
      accessibility: 0.8,
      voice: 0.8,
      coherence: 0.8,
      engagement: 0.8,
    }),
  ], equalWeights);

  assert.deepEqual(result.ranked.map((entry) => entry.candidateId), ["candidate-a"]);
  assert.deepEqual(result.dominated.map((entry) => entry.candidateId), ["candidate-b"]);
  assert.deepEqual(result.rejected.map((entry) => entry.candidateId), ["candidate-rejected"]);
  assert.equal(result.ranked[0]?.weightedTotal, 0.8);
  assert.deepEqual(result.ranked[0]?.dimensions, {
    factuality: 0.8,
    provenance: 0.8,
    accessibility: 0.8,
    voice: 0.8,
    coherence: 0.8,
    engagement: 0.8,
  });
}

{
  const tradeoff = candidate("candidate-tradeoff");
  const balanced = candidate("candidate-balanced");
  const result = rankThreadCandidates([
    rankingInput(tradeoff, {
      factuality: 0.9,
      provenance: 0.6,
      accessibility: 0.6,
      voice: 0.6,
      coherence: 0.6,
      engagement: 0.6,
    }),
    rankingInput(balanced, {
      factuality: 0.7,
      provenance: 0.7,
      accessibility: 0.7,
      voice: 0.7,
      coherence: 0.7,
      engagement: 0.7,
    }),
  ], equalWeights);
  assert.equal(result.ranked.length, 2);
  assert.equal(result.dominated.length, 0);
}

for (const invalidKind of ["sha", "schema", "chronology", "validation-sha", "finding-reference"] as const) {
  const input = candidate(`candidate-invalid-${invalidKind}`);
  const entry = rankingInput(input);
  if (invalidKind === "sha") entry.scorecard.candidateSha256 = "a".repeat(64);
  if (invalidKind === "schema") entry.scorecard.dimensions.voice.score = 2;
  if (invalidKind === "chronology") entry.scorecard.scoredAt = "2026-08-14T11:59:59.000Z";
  if (invalidKind === "validation-sha") entry.validation.candidateSha256 = "b".repeat(64);
  if (invalidKind === "finding-reference") {
    entry.scorecard.dimensions.factuality.findings = [{
      findingId: "finding-unknown-reference",
      code: "unknown-reference",
      severity: "warn",
      message: "References must bind to the candidate.",
      postId: "post-99",
      claimId: "claim-missing",
    }];
  }

  const result = rankThreadCandidates([entry], equalWeights);
  assert.equal(result.ranked.length, 0, invalidKind);
  assert.equal(result.rejected[0]?.candidateId, input.candidateId, invalidKind);
  assert.ok(result.rejected[0]?.findings.some((finding) =>
    finding.severity === "fail"
  ), invalidKind);
}

{
  const higherFactuality = candidate("candidate-higher-factuality");
  const higherEngagement = candidate("candidate-higher-engagement");
  const first = rankThreadCandidates([
    rankingInput(higherEngagement, { factuality: 0.8, engagement: 0.2 }),
    rankingInput(higherFactuality, { factuality: 0.9, engagement: 0.1 }),
  ], equalWeights);
  assert.deepEqual(first.ranked.map((entry) => entry.candidateId), [
    "candidate-higher-factuality",
    "candidate-higher-engagement",
  ]);

  const higherCoherence = candidate("candidate-higher-coherence");
  const higherVoice = candidate("candidate-higher-voice");
  const second = rankThreadCandidates([
    rankingInput(higherVoice, { coherence: 0.8, voice: 0.2 }),
    rankingInput(higherCoherence, { coherence: 0.9, voice: 0.1 }),
  ], equalWeights);
  assert.deepEqual(second.ranked.map((entry) => entry.candidateId), [
    "candidate-higher-coherence",
    "candidate-higher-voice",
  ]);

  const alpha = candidate("candidate-alpha");
  const zeta = candidate("candidate-zeta");
  const third = rankThreadCandidates([
    rankingInput(zeta),
    rankingInput(alpha),
  ], equalWeights);
  assert.deepEqual(third.ranked.map((entry) => entry.candidateId), [
    "candidate-alpha",
    "candidate-zeta",
  ]);
}

{
  const a = rankingInput(candidate("candidate-order-a"), { factuality: 0.9, engagement: 0.1 });
  const b = rankingInput(candidate("candidate-order-b"), { factuality: 0.8, engagement: 0.2 });
  const forward = rankThreadCandidates([a, b], equalWeights);
  const reverse = rankThreadCandidates([b, a], equalWeights);
  assert.deepEqual(forward, reverse);
}

assert.throws(
  () => rankThreadCandidates(
    [rankingInput(candidate("candidate-zero-weight"))],
    {
      factuality: 0,
      provenance: 0,
      accessibility: 0,
      voice: 0,
      coherence: 0,
      engagement: 0,
    },
  ),
  /positive objective weight/,
);

const baseDecision = {
  currentBestScore: 0.6,
  previousBestScore: 0.5,
  accepted: true,
  hardRegression: false,
  threshold: 0.8,
  minimumMeaningfulGain: 0.05,
  budgetExhausted: false,
};

assert.deepEqual(shouldContinueOptimization({
  ...baseDecision,
  budgetExhausted: true,
  hardRegression: true,
  currentBestScore: 0.9,
}), { continue: false, reason: "budget-exhausted" });
assert.deepEqual(shouldContinueOptimization({
  ...baseDecision,
  hardRegression: true,
}), { continue: false, reason: "hard-regression" });
assert.deepEqual(shouldContinueOptimization({
  ...baseDecision,
  currentBestScore: 0.8,
  accepted: false,
}), { continue: false, reason: "threshold-met" });
assert.deepEqual(shouldContinueOptimization({
  ...baseDecision,
  accepted: false,
}), { continue: true, reason: "repairable-regression" });
assert.deepEqual(shouldContinueOptimization({
  ...baseDecision,
  currentBestScore: 0.53,
}), { continue: false, reason: "no-meaningful-gain" });
assert.deepEqual(shouldContinueOptimization(baseDecision), {
  continue: true,
  reason: "below-threshold",
});

console.log("tweet thread scoring tests passed");
