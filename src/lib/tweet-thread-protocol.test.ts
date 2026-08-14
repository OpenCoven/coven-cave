import assert from "node:assert/strict";

import { Value } from "typebox/value";

import {
  ApprovalRecordSchema,
  ObjectiveWeightsSchema,
  PublishReceiptSchema,
  TWEET_THREAD_PROTOCOL_VERSION,
  ThreadBriefSchema,
  ThreadCandidateSchema,
  ThreadObservationSchema,
  ThreadPostSchema,
  ThreadRunManifestSchema,
  ThreadScorecardSchema,
  TweetThreadProtocolValidationError,
  assertValidThreadCandidate,
  assertValidThreadRunManifest,
  normalizeThreadBrief,
} from "./tweet-thread-protocol.ts";

const TIMESTAMP = "2026-08-14T12:00:00.000Z";
const OTHER_TIMESTAMP = "2026-08-14T12:05:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validBrief() {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    briefId: "brief-launch-thread",
    topic: "Portable protocol launch",
    audience: "Builders shipping cross-harness tweet threads",
    objectiveWeights: {
      factuality: 1,
      provenance: 0.9,
      accessibility: 0.8,
      voice: 0.7,
      coherence: 0.6,
      engagement: 0.5,
    },
    constraints: {
      minPosts: 2,
      maxPosts: 4,
      requiredClaimIds: ["claim-source-of-truth"],
      bannedPhrases: ["just vibing"],
      requireAltText: true,
    },
    notes: "Keep the copy sharp.",
  };
}

function validVoiceProfile() {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    voiceProfileId: "voice-portable-launch",
    displayName: "Portable launch",
    tone: "Grounded, exact, and readable.",
    do: ["Lead with evidence", "Keep momentum"],
    dont: ["Hype without proof"],
  };
}

function validEvidence() {
  return [
    {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: "evidence-source-of-truth",
      claimId: "claim-source-of-truth",
      summary: "The protocol file is the single source for JSON Schema output.",
      sourceLabel: "Approved plan",
      sourceUrl: "https://example.com/plan",
      retrievedAt: TIMESTAMP,
    },
    {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: "evidence-claim-two",
      claimId: "claim-second-proof",
      summary: "Score dimensions stay separate instead of collapsing into one total.",
      sourceLabel: "Review note",
      sourceUrl: "https://example.com/review",
      retrievedAt: TIMESTAMP,
    },
  ];
}

function validPosts() {
  return [
    {
      postId: "post-1",
      text: "Portable thread contracts keep every harness speaking the same language.",
      claimIds: ["claim-source-of-truth"],
      media: [{ description: "Schema diagram", altText: "A diagram showing one protocol feeding many validators." }],
    },
    {
      postId: "post-2",
      text: "Separate dimension scores preserve the why behind each decision.",
      claimIds: ["claim-second-proof"],
    },
  ];
}

function validCandidate() {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId: "candidate-portable-launch",
    candidateSha256: SHA_A,
    brief: validBrief(),
    voiceProfile: validVoiceProfile(),
    evidence: validEvidence(),
    posts: validPosts(),
    generatedAt: TIMESTAMP,
  };
}

function validScorecard(candidateSha256 = SHA_A) {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    scorecardId: "scorecard-portable-launch",
    candidateSha256,
    scoredAt: OTHER_TIMESTAMP,
    dimensions: {
      factuality: { dimension: "factuality", score: 0.9, rationale: "Claims align with the evidence ledger.", findings: [] },
      provenance: { dimension: "provenance", score: 0.95, rationale: "Every post maps back to named claims.", findings: [] },
      accessibility: { dimension: "accessibility", score: 0.85, rationale: "Media includes alt text.", findings: [] },
      voice: { dimension: "voice", score: 0.8, rationale: "Tone matches the profile.", findings: [] },
      coherence: { dimension: "coherence", score: 0.88, rationale: "The thread builds step by step.", findings: [] },
      engagement: { dimension: "engagement", score: 0.76, rationale: "Hooks stay specific.", findings: [] },
    },
  };
}

function validApproval(candidateSha256 = SHA_A) {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    approvalId: "approval-portable-launch",
    candidateSha256,
    decision: "approved",
    actor: "reviewer@example.com",
    decidedAt: OTHER_TIMESTAMP,
    note: "Ready to publish.",
  };
}

function validPublishReceipt(candidateSha256 = SHA_A) {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    receiptId: "publish-portable-launch",
    candidateSha256,
    platform: "x",
    status: "published",
    attemptedAt: OTHER_TIMESTAMP,
    publishedAt: OTHER_TIMESTAMP,
    threadUrl: "https://x.com/opencoven/status/1",
    remotePostIds: ["1888888888888888888", "1888888888888888889"],
  };
}

function validObservation(candidateSha256 = SHA_A) {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    observationId: "observation-portable-launch",
    candidateSha256,
    source: "x",
    retrievedAt: OTHER_TIMESTAMP,
    exposedAt: OTHER_TIMESTAMP,
    metrics: {
      impressions: 1200,
      likes: 80,
      reposts: 12,
      replies: 4,
      bookmarks: 7,
    },
    note: "Healthy early distribution.",
  };
}

function validManifest() {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    manifestId: "manifest-portable-launch",
    runId: "run-portable-launch",
    createdAt: OTHER_TIMESTAMP,
    brief: validBrief(),
    voiceProfile: validVoiceProfile(),
    candidates: [validCandidate()],
    scorecards: [validScorecard()],
    approvals: [validApproval()],
    publishReceipts: [validPublishReceipt()],
    observations: [validObservation()],
  };
}

function expectValidationError(fn: () => unknown): TweetThreadProtocolValidationError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof TweetThreadProtocolValidationError);
    return error;
  }
  assert.fail("Expected TweetThreadProtocolValidationError");
}

assert.ok(Value.Check(ObjectiveWeightsSchema, validBrief().objectiveWeights));
assert.equal(
  Value.Check(ObjectiveWeightsSchema, { ...validBrief().objectiveWeights, factuality: 1.1 }),
  false,
  "objective weights must stay within 0..1",
);

const briefWithUnknownKey = { ...validBrief(), unexpected: true };
assert.equal(
  Value.Check(ThreadBriefSchema, briefWithUnknownKey),
  false,
  "thread briefs reject unknown properties exactly",
);

const normalizedBrief = normalizeThreadBrief({
  ...validBrief(),
  topic: "  Portable protocol launch  ",
  audience: "  Builders shipping cross-harness tweet threads  ",
  notes: "  Keep the copy sharp.  ",
  constraints: {
    ...validBrief().constraints,
    requiredClaimIds: [" claim-source-of-truth ", "claim-second-proof", "claim-source-of-truth", " claim-second-proof "],
    bannedPhrases: ["  just vibing  ", "facts over vibes", "just vibing"],
  },
});
assert.deepStrictEqual(normalizedBrief.constraints.requiredClaimIds, ["claim-source-of-truth", "claim-second-proof"]);
assert.deepStrictEqual(normalizedBrief.constraints.bannedPhrases, ["just vibing", "facts over vibes"]);
assert.equal(normalizedBrief.topic, "Portable protocol launch");
assert.equal(normalizedBrief.audience, "Builders shipping cross-harness tweet threads");
assert.equal(normalizedBrief.notes, "Keep the copy sharp.");

const invalidBriefError = expectValidationError(
  () => normalizeThreadBrief({
    ...validBrief(),
    objectiveWeights: { ...validBrief().objectiveWeights, provenance: -0.01 },
    constraints: { ...validBrief().constraints, minPosts: 5, maxPosts: 4 },
  }),
);
assert.match(invalidBriefError.issues.join("\n"), /objectiveWeights|0\.\.1|minPosts/i);

assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], postId: "post-0" }),
  false,
  "post ids must match post-N with N >= 1",
);
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], claimIds: ["Claim-Bad"] }),
  false,
  "claim ids must stay lowercase claim slugs",
);
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], claimIds: Array.from({ length: 33 }, (_, index) => `claim-c${index}`) }),
  false,
  "posts cap referenced claims at 32",
);

assert.ok(Value.Check(ThreadCandidateSchema, validCandidate()));
assert.doesNotThrow(() => assertValidThreadCandidate(validCandidate()));

const missingLedgerReferenceError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    brief: {
      ...validBrief(),
      constraints: { ...validBrief().constraints, requiredClaimIds: ["claim-missing"] },
    },
    posts: [
      { ...validPosts()[0], claimIds: ["claim-source-of-truth", "claim-missing"] },
      validPosts()[1],
    ],
  }),
);
assert.match(missingLedgerReferenceError.issues.join("\n"), /claim-missing/);

const altTextPolicyError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    posts: [
      {
        ...validPosts()[0],
        media: [{ description: "Schema diagram" }],
      },
      validPosts()[1],
    ],
  }),
);
assert.match(altTextPolicyError.issues.join("\n"), /alt text/i);

assert.ok(Value.Check(ThreadScorecardSchema, validScorecard()));
assert.equal(
  Value.Check(ThreadScorecardSchema, { ...validScorecard(), totalScore: 0.9 }),
  false,
  "scorecards reject opaque totals and keep named dimensions separate",
);

assert.ok(Value.Check(ApprovalRecordSchema, validApproval()));
assert.ok(Value.Check(PublishReceiptSchema, validPublishReceipt()));
assert.ok(Value.Check(ThreadObservationSchema, validObservation()));
assert.equal(
  Value.Check(ThreadObservationSchema, { ...validObservation(), dimensions: validScorecard().dimensions }),
  false,
  "observations stay distinct from offline scorecards",
);
assert.equal(
  Value.Check(ThreadObservationSchema, { ...validObservation(), retrievedAt: "", exposedAt: OTHER_TIMESTAMP }),
  false,
  "observations require retrieval and exposure timestamps",
);

assert.ok(Value.Check(ThreadRunManifestSchema, validManifest()));
assert.doesNotThrow(() => assertValidThreadRunManifest(validManifest()));

const bindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    approvals: [validApproval(SHA_B)],
    publishReceipts: [validPublishReceipt(SHA_B)],
  }),
);
assert.match(bindingError.issues.join("\n"), /candidate sha|approval|publish/i);
