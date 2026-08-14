import assert from "node:assert/strict";

import { Value } from "typebox/value";

import {
  ApprovalRecordSchema,
  EvidenceItemSchema,
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
  VoiceProfileSchema,
  assertValidThreadCandidate,
  assertValidThreadRunManifest,
  normalizeThreadBrief,
} from "./tweet-thread-protocol.ts";
import type { PublishReceipt } from "./tweet-thread-protocol.ts";

const TIMESTAMP = "2026-08-14T12:00:00.000Z";
const OTHER_TIMESTAMP = "2026-08-14T12:05:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
type PublishedReceipt = Extract<PublishReceipt, { status: "published" }>;

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

function validPublishReceipt(candidateSha256 = SHA_A): PublishedReceipt {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    receiptId: "publish-portable-launch",
    candidateSha256,
    platform: "x",
    status: "published",
    attemptedAt: OTHER_TIMESTAMP,
    publishedAt: OTHER_TIMESTAMP,
    threadUrl: "https://x.com/opencoven/status/1888888888888888888",
    remotePostIds: ["1888888888888888888", "1888888888888888889"],
  };
}

function validPartialPublishReceipt(candidateSha256 = SHA_A) {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    receiptId: "publish-portable-launch-partial",
    candidateSha256,
    platform: "x",
    status: "partial",
    attemptedAt: OTHER_TIMESTAMP,
    publishedAt: OTHER_TIMESTAMP,
    threadUrl: "https://x.com/opencoven/status/1888888888888888888",
    remotePostIds: ["1888888888888888888"],
    errorCode: "reply-chain-write-failed",
  } as const;
}

function publishReceiptEvidence(receipt: PublishReceipt): string {
  switch (receipt.status) {
    case "publishing":
      return receipt.attemptedAt;
    case "published":
    case "partial":
      return `${receipt.publishedAt}:${receipt.threadUrl}:${receipt.remotePostIds.join(",")}`;
    case "failed":
    case "uncertain":
      return receipt.errorCode;
  }
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

const whitespaceBannedPhraseBrief = {
  ...validBrief(),
  constraints: {
    ...validBrief().constraints,
    bannedPhrases: [" \t "],
  },
};
assert.equal(
  Value.Check(ThreadBriefSchema, whitespaceBannedPhraseBrief),
  false,
  "brief schemas reject whitespace-only banned phrases",
);
const whitespaceNormalizedBriefError = expectValidationError(
  () => normalizeThreadBrief(whitespaceBannedPhraseBrief),
);
assert.match(whitespaceNormalizedBriefError.issues.join("\n"), /constraints\.bannedPhrases\[0\].*non-whitespace/i);
const whitespaceCandidateBriefError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    brief: whitespaceBannedPhraseBrief,
  }),
);
assert.match(
  whitespaceCandidateBriefError.issues.join("\n"),
  /ThreadCandidate\.brief\.constraints\.bannedPhrases\[0\].*non-whitespace/i,
);
const whitespaceManifestBriefError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    brief: whitespaceBannedPhraseBrief,
    candidates: [{
      ...validCandidate(),
      brief: whitespaceBannedPhraseBrief,
    }],
  }),
);
assert.match(
  whitespaceManifestBriefError.issues.join("\n"),
  /ThreadRunManifest\.brief\.constraints\.bannedPhrases\[0\].*non-whitespace/i,
);
assert.match(
  whitespaceManifestBriefError.issues.join("\n"),
  /ThreadRunManifest\.candidates\[0\]\.brief\.constraints\.bannedPhrases\[0\].*non-whitespace/i,
);

const invalidBriefError = expectValidationError(
  () => normalizeThreadBrief({
    ...validBrief(),
    objectiveWeights: { ...validBrief().objectiveWeights, provenance: -0.01 },
    constraints: { ...validBrief().constraints, minPosts: 5, maxPosts: 4 },
  }),
);
assert.match(invalidBriefError.issues.join("\n"), /objectiveWeights|0\.\.1|minPosts/i);

const incorrectProtocolVersion = "opencoven.tweet-thread.v2";
assert.equal(
  Value.Check(ThreadBriefSchema, { ...validBrief(), protocolVersion: incorrectProtocolVersion }),
  false,
  "thread briefs reject incorrect protocol versions",
);
assert.equal(
  Value.Check(VoiceProfileSchema, { ...validVoiceProfile(), protocolVersion: incorrectProtocolVersion }),
  false,
  "voice profiles reject incorrect protocol versions",
);
assert.equal(
  Value.Check(EvidenceItemSchema, { ...validEvidence()[0], protocolVersion: incorrectProtocolVersion }),
  false,
  "evidence items reject incorrect protocol versions",
);
assert.equal(
  Value.Check(ThreadCandidateSchema, { ...validCandidate(), protocolVersion: incorrectProtocolVersion }),
  false,
  "thread candidates reject incorrect protocol versions",
);
assert.equal(
  Value.Check(ThreadScorecardSchema, { ...validScorecard(), protocolVersion: incorrectProtocolVersion }),
  false,
  "scorecards reject incorrect protocol versions",
);
assert.equal(
  Value.Check(ApprovalRecordSchema, { ...validApproval(), protocolVersion: incorrectProtocolVersion }),
  false,
  "approval records reject incorrect protocol versions",
);
assert.equal(
  Value.Check(PublishReceiptSchema, { ...validPublishReceipt(), protocolVersion: incorrectProtocolVersion }),
  false,
  "publish receipts reject incorrect protocol versions",
);
assert.equal(
  Value.Check(ThreadObservationSchema, { ...validObservation(), protocolVersion: incorrectProtocolVersion }),
  false,
  "observations reject incorrect protocol versions",
);
assert.equal(
  Value.Check(ThreadRunManifestSchema, { ...validManifest(), protocolVersion: incorrectProtocolVersion }),
  false,
  "run manifests reject incorrect protocol versions",
);

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
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], text: "x" }),
  true,
  "post text accepts the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], text: "" }),
  false,
  "post text rejects values below the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], text: "x".repeat(25_000) }),
  true,
  "post text accepts the 25,000-character maximum",
);
assert.equal(
  Value.Check(ThreadPostSchema, { ...validPosts()[0], text: "x".repeat(25_001) }),
  false,
  "post text rejects values above the 25,000-character maximum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "x", altText: "Accessible image" }],
  }),
  true,
  "media descriptions accept the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "", altText: "Accessible image" }],
  }),
  false,
  "media descriptions reject values below the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "x".repeat(500), altText: "Accessible image" }],
  }),
  true,
  "media descriptions accept the 500-character maximum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "x".repeat(501), altText: "Accessible image" }],
  }),
  false,
  "media descriptions reject values above the 500-character maximum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "Image", altText: "x" }],
  }),
  true,
  "alt text accepts the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "Image", altText: "" }],
  }),
  false,
  "alt text rejects values below the 1-character minimum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "Image", altText: "x".repeat(1_000) }],
  }),
  true,
  "alt text accepts the 1,000-character maximum",
);
assert.equal(
  Value.Check(ThreadPostSchema, {
    ...validPosts()[0],
    media: [{ description: "Image", altText: "x".repeat(1_001) }],
  }),
  false,
  "alt text rejects values above the 1,000-character maximum",
);

assert.ok(Value.Check(ThreadCandidateSchema, validCandidate()));
assert.doesNotThrow(() => assertValidThreadCandidate(validCandidate()));

const invalidCandidateTimestampError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    generatedAt: "2026-02-30T12:00:00.000Z",
    evidence: validEvidence().map((item, index) => index === 0
      ? { ...item, retrievedAt: "2026-02-30T12:00:00.000Z" }
      : item),
  }),
);
assert.match(invalidCandidateTimestampError.issues.join("\n"), /ThreadCandidate\.generatedAt.*calendar-valid/i);
assert.match(invalidCandidateTimestampError.issues.join("\n"), /ThreadCandidate\.evidence\[0\]\.retrievedAt.*calendar-valid/i);

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

const omittedRequiredClaimError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    posts: validPosts().map((post) => ({ ...post, claimIds: ["claim-second-proof"] })),
  }),
);
assert.match(omittedRequiredClaimError.issues.join("\n"), /requiredClaimIds.*claim-source-of-truth/i);

assert.doesNotThrow(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    posts: [
      { ...validPosts()[0], text: "The unjust vibingly named draft still cites its source." },
      validPosts()[1],
    ],
  }),
  "banned phrases do not match inside larger words",
);
const bannedPhraseError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    posts: [
      { ...validPosts()[0], text: "The draft is JUST VIBING instead of citing its source." },
      validPosts()[1],
    ],
  }),
);
assert.match(bannedPhraseError.issues.join("\n"), /posts\[0\].*banned phrase.*just vibing/i);

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
assert.match(publishReceiptEvidence(validPublishReceipt()), /https:\/\/x\.com\/opencoven\/status\/1/);
assert.ok(
  Value.Check(PublishReceiptSchema, validPartialPublishReceipt()),
  "partial receipts preserve successful root publication evidence",
);
assert.doesNotThrow(() => assertValidThreadRunManifest({
  ...validManifest(),
  publishReceipts: [validPartialPublishReceipt()],
}));
assert.equal(
  Value.Check(PublishReceiptSchema, { ...validPartialPublishReceipt(), errorCode: " \t " }),
  false,
  "partial receipts require a nonblank error code",
);
for (const field of ["publishedAt", "threadUrl", "remotePostIds"] as const) {
  const incompleteReceipt: Partial<ReturnType<typeof validPublishReceipt>> = { ...validPublishReceipt() };
  delete incompleteReceipt[field];
  assert.equal(
    Value.Check(PublishReceiptSchema, incompleteReceipt),
    false,
    `published receipts require ${field}`,
  );
}
assert.equal(
  Value.Check(PublishReceiptSchema, { ...validPublishReceipt(), errorCode: "upstream-unavailable" }),
  false,
  "published receipts forbid failure evidence",
);
assert.equal(
  Value.Check(PublishReceiptSchema, { ...validPublishReceipt(), threadUrl: " \t " }),
  false,
  "published receipts reject whitespace-only thread URLs",
);
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...validPublishReceipt(),
    remotePostIds: ["1888888888888888888", " \t "],
  }),
  false,
  "published receipts reject any whitespace-only remote post ID",
);
const receiptWithoutOutcome = (status: "publishing" | "failed" | "uncertain", errorCode?: string) => ({
  protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
  receiptId: "publish-portable-launch",
  candidateSha256: SHA_A,
  platform: "x",
  status,
  attemptedAt: OTHER_TIMESTAMP,
  ...(errorCode ? { errorCode } : {}),
});
assert.ok(Value.Check(PublishReceiptSchema, receiptWithoutOutcome("publishing")));
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...receiptWithoutOutcome("publishing"),
    publishedAt: OTHER_TIMESTAMP,
  }),
  false,
  "publishing receipts forbid outcome evidence",
);
assert.equal(
  Value.Check(PublishReceiptSchema, receiptWithoutOutcome("failed")),
  false,
  "failed receipts require an error code",
);
assert.ok(Value.Check(PublishReceiptSchema, receiptWithoutOutcome("failed", "invalid-request")));
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...receiptWithoutOutcome("failed", "invalid-request"),
    threadUrl: "https://x.com/opencoven/status/1",
  }),
  false,
  "failed receipts forbid publication evidence",
);
assert.equal(
  Value.Check(PublishReceiptSchema, receiptWithoutOutcome("uncertain")),
  false,
  "uncertain receipts require an error code",
);
assert.ok(Value.Check(PublishReceiptSchema, receiptWithoutOutcome("uncertain", "upstream-unavailable")));
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...receiptWithoutOutcome("uncertain", "upstream-unavailable"),
    remotePostIds: ["1888888888888888888"],
  }),
  false,
  "uncertain receipts forbid publication evidence",
);
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

const impossibleTimestamp = "2026-02-30T12:00:00.000Z";
const standaloneTimestampCases = [
  {
    label: "evidence retrievedAt",
    schema: EvidenceItemSchema,
    value: { ...validEvidence()[0], retrievedAt: impossibleTimestamp },
  },
  {
    label: "candidate generatedAt",
    schema: ThreadCandidateSchema,
    value: { ...validCandidate(), generatedAt: impossibleTimestamp },
  },
  {
    label: "scorecard scoredAt",
    schema: ThreadScorecardSchema,
    value: { ...validScorecard(), scoredAt: impossibleTimestamp },
  },
  {
    label: "approval decidedAt",
    schema: ApprovalRecordSchema,
    value: { ...validApproval(), decidedAt: impossibleTimestamp },
  },
  {
    label: "receipt attemptedAt",
    schema: PublishReceiptSchema,
    value: { ...validPublishReceipt(), attemptedAt: impossibleTimestamp },
  },
  {
    label: "receipt publishedAt",
    schema: PublishReceiptSchema,
    value: { ...validPublishReceipt(), publishedAt: impossibleTimestamp },
  },
  {
    label: "observation retrievedAt",
    schema: ThreadObservationSchema,
    value: { ...validObservation(), retrievedAt: impossibleTimestamp },
  },
  {
    label: "observation exposedAt",
    schema: ThreadObservationSchema,
    value: { ...validObservation(), exposedAt: impossibleTimestamp },
  },
  {
    label: "manifest createdAt",
    schema: ThreadRunManifestSchema,
    value: { ...validManifest(), createdAt: impossibleTimestamp },
  },
] as const;
for (const { label, schema, value } of standaloneTimestampCases) {
  assert.equal(Value.Check(schema, value), false, `${label} rejects impossible calendar dates standalone`);
}

for (const [label, threadUrl] of [
  ["malformed", "not-a-url"],
  ["non-X", "https://example.com/opencoven/status/1"],
] as const) {
  assert.equal(
    Value.Check(PublishReceiptSchema, { ...validPublishReceipt(), threadUrl }),
    false,
    `published receipts reject ${label} thread URLs`,
  );
}
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...validPublishReceipt(),
    remotePostIds: ["1888888888888888888", "not-an-x-id"],
  }),
  false,
  "published receipts reject nonnumeric remote post IDs",
);
assert.equal(
  Value.Check(PublishReceiptSchema, {
    ...validPublishReceipt(),
    remotePostIds: ["1888888888888888888", "1888888888888888888"],
  }),
  false,
  "published receipts reject duplicate remote post IDs",
);
for (const status of ["failed", "uncertain"] as const) {
  assert.equal(
    Value.Check(PublishReceiptSchema, receiptWithoutOutcome(status, " \t ")),
    false,
    `${status} receipts reject blank error codes`,
  );
}
for (const metric of ["impressions", "likes", "reposts", "replies", "bookmarks"] as const) {
  assert.equal(
    Value.Check(ThreadObservationSchema, {
      ...validObservation(),
      metrics: { ...validObservation().metrics, [metric]: 1.5 },
    }),
    false,
    `${metric} rejects fractional counts`,
  );
}
const invalidPublishedRemotePostCountError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    publishReceipts: [{
      ...validPublishReceipt(),
      remotePostIds: ["1888888888888888888"],
    }],
  }),
);
assert.ok(
  invalidPublishedRemotePostCountError.issues.some((issue) =>
    issue.includes("ThreadRunManifest.publishReceipts[0].remotePostIds")
  ),
  "published receipt count errors point to remotePostIds",
);

const invalidPartialRemotePostCountError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    publishReceipts: [{
      ...validPartialPublishReceipt(),
      remotePostIds: ["1888888888888888888", "1888888888888888889"],
    }],
  }),
);
assert.ok(
  invalidPartialRemotePostCountError.issues.some((issue) =>
    issue.includes("ThreadRunManifest.publishReceipts[0].remotePostIds")
  ),
  "partial receipt count errors point to remotePostIds",
);

const mismatchedThreadRootError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    publishReceipts: [{
      ...validPublishReceipt(),
      threadUrl: "https://x.com/opencoven/status/1999999999999999999",
    }],
  }),
);
assert.ok(
  mismatchedThreadRootError.issues.some((issue) =>
    issue.includes("ThreadRunManifest.publishReceipts[0].threadUrl")
    && issue.includes("remotePostIds[0]")
  ),
  "thread root mismatches identify both bound receipt paths",
);

const invalidManifestTimestampError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    createdAt: impossibleTimestamp,
    candidates: [{
      ...validCandidate(),
      generatedAt: impossibleTimestamp,
      evidence: validEvidence().map((item, index) => index === 0
        ? { ...item, retrievedAt: impossibleTimestamp }
        : item),
    }],
    scorecards: [{ ...validScorecard(), scoredAt: impossibleTimestamp }],
    approvals: [{ ...validApproval(), decidedAt: impossibleTimestamp }],
    publishReceipts: [{
      ...validPublishReceipt(),
      attemptedAt: impossibleTimestamp,
      publishedAt: impossibleTimestamp,
    }],
    observations: [{
      ...validObservation(),
      retrievedAt: impossibleTimestamp,
      exposedAt: impossibleTimestamp,
    }],
  }),
);
for (const timestampPath of [
  "ThreadRunManifest.createdAt",
  "ThreadRunManifest.candidates[0].generatedAt",
  "ThreadRunManifest.candidates[0].evidence[0].retrievedAt",
  "ThreadRunManifest.scorecards[0].scoredAt",
  "ThreadRunManifest.approvals[0].decidedAt",
  "ThreadRunManifest.publishReceipts[0].attemptedAt",
  "ThreadRunManifest.publishReceipts[0].publishedAt",
  "ThreadRunManifest.observations[0].retrievedAt",
  "ThreadRunManifest.observations[0].exposedAt",
]) {
  assert.ok(
    invalidManifestTimestampError.issues.some((issue) => issue.includes(timestampPath)),
    `${timestampPath} rejects impossible calendar dates`,
  );
}

const manifestBriefBindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    candidates: [{
      ...validCandidate(),
      brief: {
        ...validBrief(),
        topic: "A different valid topic",
      },
    }],
  }),
);
assert.match(
  manifestBriefBindingError.issues.join("\n"),
  /ThreadRunManifest\.candidates\[0\]\.brief.*ThreadRunManifest\.brief/i,
);

const manifestVoiceBindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    candidates: [{
      ...validCandidate(),
      voiceProfile: {
        ...validVoiceProfile(),
        tone: "A different valid tone.",
      },
    }],
  }),
);
assert.match(
  manifestVoiceBindingError.issues.join("\n"),
  /ThreadRunManifest\.candidates\[0\]\.voiceProfile.*ThreadRunManifest\.voiceProfile/i,
);

const bindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    approvals: [validApproval(SHA_B)],
    publishReceipts: [validPublishReceipt(SHA_B)],
  }),
);
assert.match(bindingError.issues.join("\n"), /candidate sha|approval|publish/i);
