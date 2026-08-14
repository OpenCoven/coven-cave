import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { Value } from "typebox/value";

import {
  DeterministicFindingSchema,
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

function legacyAuditFindingId(
  finding: { code: string; message: string; postId?: string; claimId?: string },
): string {
  const hash = createHash("sha256")
    .update([
      finding.code,
      finding.message,
      finding.postId ?? "",
      finding.claimId ?? "",
    ].join("\u0000"), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `finding-${hash}`;
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

for (const invalidKind of ["sha", "schema", "chronology", "finding-reference"] as const) {
  const input = candidate(`candidate-invalid-${invalidKind}`);
  const entry = rankingInput(input);
  if (invalidKind === "sha") entry.scorecard.candidateSha256 = "a".repeat(64);
  if (invalidKind === "schema") entry.scorecard.dimensions.voice.score = 2;
  if (invalidKind === "chronology") entry.scorecard.scoredAt = "2026-08-14T11:59:59.000Z";
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
  if (invalidKind === "sha") {
    const auditFinding = result.rejected[0]?.findings.find((finding) =>
      finding.code === "scorecard-candidate-sha-mismatch"
    );
    assert.ok(auditFinding);
    assert.equal(auditFinding.findingId, legacyAuditFindingId(auditFinding));
  }
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

{
  const entry = rankingInput(candidate("candidate-mutated-after-validation"));
  entry.candidate.posts[0]!.text = "界".repeat(141);
  assert.equal(entry.validation.accepted, true);
  const result = rankThreadCandidates([entry], equalWeights);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.rejected[0]?.candidateId, entry.candidate.candidateId);
  assert.equal(result.rejected[0]?.validation.accepted, false);
  assert.ok(result.rejected[0]?.findings.some((finding) => finding.code === "post-weighted-length"));
  assert.ok(result.rejected[0]?.findings.some((finding) =>
    finding.code === "protocol-invalid"
    && finding.message.includes("candidateSha256")
  ));
}

{
  const valid = rankingInput(candidate("candidate-valid-after-malformed"), {
    factuality: 0.8,
    provenance: 0.8,
    accessibility: 0.8,
    voice: 0.8,
    coherence: 0.8,
    engagement: 0.8,
  });
  const malformedCandidate = {
    candidateId: "candidate-malformed-shape",
    candidateSha256: "not-a-sha",
    posts: null,
    evidence: null,
  } as unknown as ThreadCandidate;
  const malformed = {
    candidate: malformedCandidate,
    scorecard: scorecard(valid.candidate),
    validation: validateThreadCandidate(malformedCandidate),
  };

  const result = rankThreadCandidates([malformed, valid], equalWeights);
  assert.deepEqual(result.ranked.map((entry) => entry.candidateId), [
    valid.candidate.candidateId,
  ]);
  const rejected = result.rejected.find((entry) =>
    entry.candidateId === "candidate-malformed-shape"
  );
  assert.ok(rejected, "malformed candidate remains visible in rejected audit output");
  assert.ok(rejected.findings.some((finding) => finding.severity === "fail"));
  assert.ok(rejected.findings.every((finding) =>
    Value.Check(DeterministicFindingSchema, finding)
  ));
}

{
  const oversizedId = "x".repeat(2_100);
  const input = rankingInput(candidate("candidate-oversized-audit-id"));
  input.candidate.candidateId = `candidate-${oversizedId}`;
  input.scorecard.scorecardId = `scorecard-${oversizedId}`;

  const result = rankThreadCandidates([input], equalWeights);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.results.flatMap((entry) => entry.findings).every((finding) =>
    Value.Check(DeterministicFindingSchema, finding)
  ), "every scoring-generated finding remains schema-valid for oversized identifiers");
}

{
  const originalLocaleCompare = String.prototype.localeCompare;
  assert.ok(
    originalLocaleCompare.call("candidate-aa", "candidate-ab", "da") > 0,
    "the regression IDs must demonstrate locale-sensitive ordering",
  );
  String.prototype.localeCompare = function localeCompareUsingDanish(
    compareString: string,
  ): number {
    return originalLocaleCompare.call(this, compareString, "da");
  };
  try {
    const aa = rankingInput(candidate("candidate-aa"));
    const ab = rankingInput(candidate("candidate-ab"));
    for (const inputs of [[ab, aa], [aa, ab]]) {
      const result = rankThreadCandidates(inputs, equalWeights);
      assert.deepEqual(result.ranked.map((entry) => entry.candidateId), [
        "candidate-aa",
        "candidate-ab",
      ]);
    }
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
}

{
  const entry = rankingInput(candidate("candidate-stale-rejection"));
  entry.validation = {
    candidateSha256: entry.candidate.candidateSha256,
    accepted: false,
    findings: [{
      findingId: "finding-stale-rejection",
      code: "stale-rejection",
      severity: "fail",
      message: "This stale result must not control ranking.",
    }],
    measurements: [],
  };
  const result = rankThreadCandidates([entry], equalWeights);
  assert.deepEqual(result.ranked.map((item) => item.candidateId), [entry.candidate.candidateId]);
  assert.equal(result.ranked[0]?.validation.accepted, true);
  assert.equal(result.ranked[0]?.findings.some((finding) => finding.code === "stale-rejection"), false);
}

for (const reverse of [false, true]) {
  const duplicates = [
    rankingInput(candidate("candidate-duplicate-id", "First canonical body.")),
    rankingInput(candidate("candidate-duplicate-id", "Second canonical body.")),
  ];
  assert.throws(
    () => rankThreadCandidates(reverse ? duplicates.reverse() : duplicates, equalWeights),
    /duplicate candidate id.*candidate-duplicate-id/i,
  );
}

for (const reverse of [false, true]) {
  const first = rankingInput(candidate("candidate-duplicate-sha-a"));
  const second = rankingInput(candidate("candidate-duplicate-sha-b"));
  second.candidate.candidateSha256 = first.candidate.candidateSha256;
  second.scorecard.candidateSha256 = first.candidate.candidateSha256;
  second.validation.candidateSha256 = first.candidate.candidateSha256;
  const duplicates = [first, second];
  assert.throws(
    () => rankThreadCandidates(reverse ? duplicates.reverse() : duplicates, equalWeights),
    /duplicate candidate sha.*[a-f0-9]{64}/i,
  );
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
}), { continue: true, reason: "repairable-regression" });
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
