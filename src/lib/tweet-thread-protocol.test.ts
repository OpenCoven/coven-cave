import assert from "node:assert/strict";

import { Value } from "typebox/value";

import * as protocolApi from "./tweet-thread-protocol.ts";
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
  computeThreadCandidateSha256,
  normalizeThreadBrief,
  serializeCanonicalThreadCandidate,
} from "./tweet-thread-protocol.ts";
import type { PublishReceipt } from "./tweet-thread-protocol.ts";

const TIMESTAMP = "2026-08-14T12:00:00.000Z";
const OTHER_TIMESTAMP = "2026-08-14T12:05:00.000Z";
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

function validCandidateContent(candidateId = "candidate-portable-launch") {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId,
    brief: validBrief(),
    voiceProfile: validVoiceProfile(),
    evidence: validEvidence(),
    posts: validPosts(),
    generatedAt: TIMESTAMP,
  };
}

const SHA_A = computeThreadCandidateSha256(validCandidateContent());
const SHA_B = computeThreadCandidateSha256(validCandidateContent("candidate-portable-launch-second"));

function validCandidate() {
  return {
    ...validCandidateContent(),
    candidateSha256: SHA_A,
  };
}

function validSecondCandidate() {
  return {
    ...validCandidateContent("candidate-portable-launch-second"),
    candidateSha256: SHA_B,
  };
}

function rehashCandidate(candidate: ReturnType<typeof validCandidate>) {
  return {
    ...candidate,
    candidateSha256: computeThreadCandidateSha256(candidate),
  };
}

const EXPECTED_CANONICAL_CANDIDATE = JSON.stringify({
  brief: {
    audience: "Builders shipping cross-harness tweet threads",
    briefId: "brief-launch-thread",
    constraints: {
      bannedPhrases: ["just vibing"],
      maxPosts: 4,
      minPosts: 2,
      requireAltText: true,
      requiredClaimIds: ["claim-source-of-truth"],
    },
    notes: "Keep the copy sharp.",
    objectiveWeights: {
      accessibility: 0.8,
      coherence: 0.6,
      engagement: 0.5,
      factuality: 1,
      provenance: 0.9,
      voice: 0.7,
    },
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    topic: "Portable protocol launch",
  },
  candidateId: "candidate-portable-launch",
  evidence: [
    {
      claimId: "claim-source-of-truth",
      evidenceId: "evidence-source-of-truth",
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      retrievedAt: TIMESTAMP,
      sourceLabel: "Approved plan",
      sourceUrl: "https://example.com/plan",
      summary: "The protocol file is the single source for JSON Schema output.",
    },
    {
      claimId: "claim-second-proof",
      evidenceId: "evidence-claim-two",
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      retrievedAt: TIMESTAMP,
      sourceLabel: "Review note",
      sourceUrl: "https://example.com/review",
      summary: "Score dimensions stay separate instead of collapsing into one total.",
    },
  ],
  generatedAt: TIMESTAMP,
  posts: [
    {
      claimIds: ["claim-source-of-truth"],
      media: [{
        altText: "A diagram showing one protocol feeding many validators.",
        description: "Schema diagram",
      }],
      postId: "post-1",
      text: "Portable thread contracts keep every harness speaking the same language.",
    },
    {
      claimIds: ["claim-second-proof"],
      postId: "post-2",
      text: "Separate dimension scores preserve the why behind each decision.",
    },
  ],
  protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
  voiceProfile: {
    displayName: "Portable launch",
    do: ["Lead with evidence", "Keep momentum"],
    dont: ["Hype without proof"],
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    tone: "Grounded, exact, and readable.",
    voiceProfileId: "voice-portable-launch",
  },
});
const KNOWN_CANDIDATE_SHA256 = "a584ea99176246a443fe7242d634e5846e07487ff71c4a61a3c49aa980c74af8";

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
    publishReceiptId: "publish-portable-launch",
    source: "x",
    retrievedAt: OTHER_TIMESTAMP,
    exposedAt: OTHER_TIMESTAMP,
    metrics: {
      impressions: 1200,
      likes: 80,
      reposts: 12,
      replies: 4,
      quotes: 2,
      bookmarks: 7,
    },
    missingMetricReasons: [],
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
assert.equal(
  serializeCanonicalThreadCandidate(validCandidate()),
  EXPECTED_CANONICAL_CANDIDATE,
  "canonical candidate content includes every candidate field except candidateSha256",
);
assert.equal(
  computeThreadCandidateSha256(validCandidate()),
  KNOWN_CANDIDATE_SHA256,
  "candidate SHA-256 is computed from the explicit canonical candidate content",
);
const reorderedCandidate = {
  generatedAt: TIMESTAMP,
  posts: validPosts().map((post) => ({
    ...(post.media
      ? {
          media: post.media.map((media) => ({
            altText: media.altText,
            description: media.description,
          })),
        }
      : {}),
    claimIds: post.claimIds,
    text: post.text,
    postId: post.postId,
  })),
  evidence: validEvidence().map((item) => ({
    retrievedAt: item.retrievedAt,
    sourceUrl: item.sourceUrl,
    sourceLabel: item.sourceLabel,
    summary: item.summary,
    claimId: item.claimId,
    evidenceId: item.evidenceId,
    protocolVersion: item.protocolVersion,
  })),
  voiceProfile: {
    dont: validVoiceProfile().dont,
    tone: validVoiceProfile().tone,
    displayName: validVoiceProfile().displayName,
    do: validVoiceProfile().do,
    voiceProfileId: validVoiceProfile().voiceProfileId,
    protocolVersion: validVoiceProfile().protocolVersion,
  },
  brief: {
    notes: validBrief().notes,
    constraints: {
      requireAltText: validBrief().constraints.requireAltText,
      bannedPhrases: validBrief().constraints.bannedPhrases,
      requiredClaimIds: validBrief().constraints.requiredClaimIds,
      maxPosts: validBrief().constraints.maxPosts,
      minPosts: validBrief().constraints.minPosts,
    },
    objectiveWeights: {
      engagement: validBrief().objectiveWeights.engagement,
      coherence: validBrief().objectiveWeights.coherence,
      voice: validBrief().objectiveWeights.voice,
      accessibility: validBrief().objectiveWeights.accessibility,
      provenance: validBrief().objectiveWeights.provenance,
      factuality: validBrief().objectiveWeights.factuality,
    },
    audience: validBrief().audience,
    topic: validBrief().topic,
    briefId: validBrief().briefId,
    protocolVersion: validBrief().protocolVersion,
  },
  candidateSha256: SHA_A,
  candidateId: "candidate-portable-launch",
  protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
};
assert.equal(
  computeThreadCandidateSha256(reorderedCandidate),
  KNOWN_CANDIDATE_SHA256,
  "candidate hashing is independent of object property insertion order while preserving array order",
);

const mutatedPostCandidateError = expectValidationError(
  () => assertValidThreadCandidate({
    ...validCandidate(),
    posts: validPosts().map((post, index) => index === 0
      ? { ...post, text: `${post.text} Mutated after hashing.` }
      : post),
  }),
);
assert.match(
  mutatedPostCandidateError.issues.join("\n"),
  /ThreadCandidate\.candidateSha256.*canonical candidate content/i,
);

for (const field of ["summary", "sourceLabel"] as const) {
  const evidence = validEvidence().map((item, index) => index === 0
    ? { ...item, [field]: " \t " }
    : item);
  assert.equal(
    Value.Check(EvidenceItemSchema, evidence[0]),
    false,
    `evidence ${field} must contain non-whitespace provenance text`,
  );
  const candidate = { ...validCandidate(), evidence };
  const whitespaceEvidenceError = expectValidationError(
    () => assertValidThreadCandidate({
      ...candidate,
      candidateSha256: computeThreadCandidateSha256(candidate),
    }),
  );
  assert.match(
    whitespaceEvidenceError.issues.join("\n"),
    new RegExp(`ThreadCandidate\\.evidence\\[0\\]\\.${field}.*non-whitespace`, "i"),
  );
}

for (const [label, sourceUrl] of [
  ["whitespace-only", " \t "],
  ["malformed", "not-a-url"],
  ["non-HTTP", "ftp://example.com/plan"],
] as const) {
  assert.equal(
    Value.Check(EvidenceItemSchema, { ...validEvidence()[0], sourceUrl }),
    false,
    `evidence source URLs reject ${label} values`,
  );
}

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

const futureRetrievedAt = "2026-08-14T12:01:00.000Z";
const candidateWithFutureEvidence = rehashCandidate({
  ...validCandidate(),
  evidence: validEvidence().map((item, index) => index === 0
    ? { ...item, retrievedAt: futureRetrievedAt }
    : item),
});
const futureEvidenceError = expectValidationError(
  () => assertValidThreadCandidate(candidateWithFutureEvidence),
);
assert.ok(
  futureEvidenceError.issues.some((issue) =>
    issue.includes("ThreadCandidate.evidence[0].retrievedAt")
    && issue.includes("ThreadCandidate.generatedAt")
  ),
  "future-retrieved evidence identifies both bound candidate paths",
);

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
  () => assertValidThreadCandidate(rehashCandidate({
    ...validCandidate(),
    posts: [
      { ...validPosts()[0], text: "The unjust vibingly named draft still cites its source." },
      validPosts()[1],
    ],
  })),
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
const normalizedBannedPhraseError = expectValidationError(
  () => assertValidThreadCandidate(rehashCandidate({
    ...validCandidate(),
    posts: [
      { ...validPosts()[0], text: "The draft is ＪＵＳＴ　ＶＩＢＩＮＧ instead of citing its source." },
      validPosts()[1],
    ],
  })),
);
assert.match(
  normalizedBannedPhraseError.issues.join("\n"),
  /posts\[0\].*banned phrase.*just vibing/i,
  "protocol assertions apply NFKC normalization before banned-phrase matching",
);
const bannedPhraseMatcher = (protocolApi as Record<string, unknown>).containsBannedPhrase;
assert.equal(typeof bannedPhraseMatcher, "function", "the protocol exports one canonical banned-phrase matcher");
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("A partial result.", "art"),
  false,
  "word-like banned phrases do not match inside larger Unicode words",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("ＡＲＴ matters.", "art"),
  true,
  "Unicode compatibility-equivalent banned phrases match",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("भारत", "रत"),
  false,
  "combining marks continue a larger Devanagari word before a banned phrase",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("भारत", "भ"),
  false,
  "combining marks continue a larger Devanagari word after a banned phrase",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("यह रत है", "रत"),
  true,
  "Devanagari banned phrases still match as standalone words",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("art‿work", "art"),
  false,
  "connector punctuation continues a word after a banned phrase",
);
assert.equal(
  (bannedPhraseMatcher as (text: string, phrase: string) => boolean)("work‿art", "art"),
  false,
  "connector punctuation continues a word before a banned phrase",
);

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
assert.equal(
  Value.Check(ApprovalRecordSchema, { ...validApproval(), actor: " \t " }),
  false,
  "approval actors must contain non-whitespace identity text",
);
const whitespaceApprovalActorError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    approvals: [{ ...validApproval(), actor: " \t " }],
    publishReceipts: [],
    observations: [],
  }),
);
assert.match(
  whitespaceApprovalActorError.issues.join("\n"),
  /ThreadRunManifest\.approvals\[0\]\.actor.*non-whitespace/i,
);
assert.ok(Value.Check(PublishReceiptSchema, validPublishReceipt()));
assert.match(publishReceiptEvidence(validPublishReceipt()), /https:\/\/x\.com\/opencoven\/status\/1/);
assert.ok(
  Value.Check(PublishReceiptSchema, validPartialPublishReceipt()),
  "partial receipts preserve successful root publication evidence",
);
assert.doesNotThrow(() => assertValidThreadRunManifest({
  ...validManifest(),
  publishReceipts: [validPartialPublishReceipt()],
  observations: [{ ...validObservation(), publishReceiptId: "publish-portable-launch-partial" }],
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
  "uncertain receipts require all remote evidence fields when any are present",
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
for (const metric of ["impressions", "likes", "reposts", "replies", "quotes", "bookmarks"] as const) {
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
    candidates: [rehashCandidate({
      ...validCandidate(),
      brief: {
        ...validBrief(),
        topic: "A different valid topic",
      },
    })],
  }),
);
assert.match(
  manifestBriefBindingError.issues.join("\n"),
  /ThreadRunManifest\.candidates\[0\]\.brief.*ThreadRunManifest\.brief/i,
);

const manifestVoiceBindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    candidates: [rehashCandidate({
      ...validCandidate(),
      voiceProfile: {
        ...validVoiceProfile(),
        tone: "A different valid tone.",
      },
    })],
  }),
);
assert.match(
  manifestVoiceBindingError.issues.join("\n"),
  /ThreadRunManifest\.candidates\[0\]\.voiceProfile.*ThreadRunManifest\.voiceProfile/i,
);

const preGenerationScorecardError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    scorecards: [{
      ...validScorecard(),
      scoredAt: "2026-08-14T11:59:00.000Z",
    }],
  }),
);
assert.ok(
  preGenerationScorecardError.issues.some((issue) =>
    issue.includes("ThreadRunManifest.scorecards[0].scoredAt")
    && issue.includes("ThreadRunManifest.candidates[0].generatedAt")
  ),
  "pre-generation scorecards identify both bound manifest paths",
);

const bindingError = expectValidationError(
  () => assertValidThreadRunManifest({
    ...validManifest(),
    approvals: [validApproval(SHA_B)],
    publishReceipts: [validPublishReceipt(SHA_B)],
  }),
);
assert.match(bindingError.issues.join("\n"), /candidate sha|approval|publish/i);

const invariantFailures: string[] = [];
function checkInvariant(label: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    invariantFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const EARLIER_TIMESTAMP = "2026-08-14T12:04:00.000Z";
const LATER_TIMESTAMP = "2026-08-14T12:10:00.000Z";
const BEFORE_GENERATION_TIMESTAMP = "2026-08-14T11:59:00.000Z";

function approvalAt(
  approvalId: string,
  decision: "approved" | "rejected",
  decidedAt: string,
  candidateSha256 = SHA_A,
) {
  return {
    ...validApproval(candidateSha256),
    approvalId,
    decision,
    decidedAt,
  };
}

function validObservationForReceipt(candidateSha256 = SHA_A, publishReceiptId = "publish-portable-launch") {
  return {
    ...validObservation(candidateSha256),
    publishReceiptId,
  };
}

function validBoundManifest() {
  return {
    ...validManifest(),
    observations: [validObservationForReceipt()],
  };
}

function uncertainReceiptWithKnownPrefix(candidateSha256 = SHA_A) {
  return {
    ...receiptWithoutOutcome("uncertain", "reply-dispatch-ambiguous"),
    receiptId: "publish-portable-launch-uncertain",
    candidateSha256,
    publishedAt: OTHER_TIMESTAMP,
    threadUrl: "https://x.com/opencoven/status/1888888888888888888",
    remotePostIds: ["1888888888888888888"],
  } as const;
}

checkInvariant("uncertain receipts preserve a known successful prefix", () => {
  assert.equal(Value.Check(PublishReceiptSchema, uncertainReceiptWithKnownPrefix()), true);
  assert.doesNotThrow(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    publishReceipts: [uncertainReceiptWithKnownPrefix()],
    observations: [validObservationForReceipt(SHA_A, "publish-portable-launch-uncertain")],
  }));
});

checkInvariant("uncertain known prefixes bind the root URL to the first remote ID", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    publishReceipts: [{
      ...uncertainReceiptWithKnownPrefix(),
      threadUrl: "https://x.com/opencoven/status/1999999999999999999",
    }],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /publishReceipts\[0\]\.threadUrl.*remotePostIds\[0\]/i);
});

checkInvariant("uncertain known prefixes remain shorter than the candidate", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    publishReceipts: [{
      ...uncertainReceiptWithKnownPrefix(),
      remotePostIds: ["1888888888888888888", "1888888888888888889"],
    }],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /publishReceipts\[0\]\.remotePostIds.*less than.*candidate posts/i);
});

checkInvariant("uncertain receipts require either all remote evidence or none", () => {
  assert.equal(Value.Check(PublishReceiptSchema, {
    ...receiptWithoutOutcome("uncertain", "reply-dispatch-ambiguous"),
    publishedAt: OTHER_TIMESTAMP,
  }), false);
});

checkInvariant("publication requires an approval at or before the attempt", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /publishReceipts\[0\].*latest approval.*approved/i);

  const laterApprovalError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [approvalAt("approval-after-attempt", "approved", LATER_TIMESTAMP)],
    observations: [],
  }));
  assert.match(laterApprovalError.issues.join("\n"), /publishReceipts\[0\].*latest approval.*approved/i);
});

checkInvariant("approval decisions cannot predate candidate generation", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [approvalAt("approval-before-generation", "approved", BEFORE_GENERATION_TIMESTAMP)],
    publishReceipts: [],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /approvals\[0\]\.decidedAt.*candidates\[0\]\.generatedAt/i);
});

checkInvariant("publication attempts cannot predate candidate generation", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [approvalAt("approval-at-generation", "approved", TIMESTAMP)],
    publishReceipts: [{
      ...validPublishReceipt(),
      attemptedAt: BEFORE_GENERATION_TIMESTAMP,
      publishedAt: OTHER_TIMESTAMP,
    }],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /publishReceipts\[0\]\.attemptedAt.*candidates\[0\]\.generatedAt/i);
});

checkInvariant("a later rejection before the attempt revokes publication approval", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [
      approvalAt("approval-first", "approved", EARLIER_TIMESTAMP),
      approvalAt("approval-later", "rejected", OTHER_TIMESTAMP),
    ],
    observations: [],
  }));
  assert.match(error.issues.join("\n"), /publishReceipts\[0\].*latest approval.*approved/i);
});

checkInvariant("the latest approval chronology can restore publication approval", () => {
  assert.doesNotThrow(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [
      approvalAt("approval-first", "rejected", EARLIER_TIMESTAMP),
      approvalAt("approval-later", "approved", OTHER_TIMESTAMP),
    ],
  }));
});

checkInvariant("same-timestamp approval ties use later array order", () => {
  const rejectedLastError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [
      approvalAt("approval-tie-first", "approved", OTHER_TIMESTAMP),
      approvalAt("approval-tie-last", "rejected", OTHER_TIMESTAMP),
    ],
    observations: [],
  }));
  assert.match(rejectedLastError.issues.join("\n"), /publishReceipts\[0\].*latest approval.*approved/i);

  assert.doesNotThrow(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    approvals: [
      approvalAt("approval-tie-first", "rejected", OTHER_TIMESTAMP),
      approvalAt("approval-tie-last", "approved", OTHER_TIMESTAMP),
    ],
  }));
});

checkInvariant("all active publication states require approval", () => {
  for (const receipt of [
    receiptWithoutOutcome("publishing"),
    validPublishReceipt(),
    validPartialPublishReceipt(),
    uncertainReceiptWithKnownPrefix(),
    receiptWithoutOutcome("uncertain", "dispatch-ambiguous"),
  ]) {
    const error = expectValidationError(() => assertValidThreadRunManifest({
      ...validBoundManifest(),
      approvals: [],
      publishReceipts: [receipt],
      observations: [],
    }));
    assert.match(error.issues.join("\n"), /publishReceipts\[0\].*latest approval.*approved/i);
  }
});

checkInvariant("observations declare receipt identity and complete metric availability", () => {
  assert.equal(Value.Check(ThreadObservationSchema, validObservationForReceipt()), true);
  assert.equal(Value.Check(ThreadObservationSchema, {
    ...validObservationForReceipt(),
    metrics: { ...validObservationForReceipt().metrics, quotes: -1 },
  }), false);
  assert.equal(Value.Check(ThreadObservationSchema, {
    ...validObservationForReceipt(),
    metrics: { ...validObservationForReceipt().metrics, quotes: 1.5 },
  }), false);
});

checkInvariant("missing metric reasons are strict and use declared metric names", () => {
  const observation = {
    ...validObservationForReceipt(),
    metrics: { impressions: 100 },
    missingMetricReasons: [
      { metric: "likes", reason: "not-returned" },
      { metric: "reposts", reason: "not-returned" },
      { metric: "replies", reason: "not-returned" },
      { metric: "quotes", reason: "not-returned" },
      { metric: "bookmarks", reason: "not-returned" },
    ],
  };
  assert.equal(Value.Check(ThreadObservationSchema, observation), true);
  assert.equal(Value.Check(ThreadObservationSchema, {
    ...observation,
    missingMetricReasons: [
      ...observation.missingMetricReasons,
      { metric: "views", reason: "not-returned" },
    ],
  }), false);
  assert.equal(Value.Check(ThreadObservationSchema, {
    ...observation,
    missingMetricReasons: observation.missingMetricReasons.map((reason, index) =>
      index === 0 ? { ...reason, detail: "unknown key" } : reason),
  }), false);
});

checkInvariant("every unavailable metric has exactly one reason", () => {
  const missingReasonError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    observations: [{
      ...validObservationForReceipt(),
      metrics: { impressions: 100 },
      missingMetricReasons: [
        { metric: "likes", reason: "not-returned" },
        { metric: "reposts", reason: "not-returned" },
        { metric: "replies", reason: "not-returned" },
        { metric: "quotes", reason: "not-returned" },
      ],
    }],
  }));
  assert.match(missingReasonError.issues.join("\n"), /observations\[0\]\.missingMetricReasons.*bookmarks/i);

  const duplicateReasonError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    observations: [{
      ...validObservationForReceipt(),
      metrics: { impressions: 100 },
      missingMetricReasons: [
        { metric: "likes", reason: "not-returned" },
        { metric: "likes", reason: "scope-denied" },
        { metric: "reposts", reason: "not-returned" },
        { metric: "replies", reason: "not-returned" },
        { metric: "quotes", reason: "not-returned" },
        { metric: "bookmarks", reason: "not-returned" },
      ],
    }],
  }));
  assert.match(duplicateReasonError.issues.join("\n"), /observations\[0\]\.missingMetricReasons\[1\]\.metric.*unique/i);
});

checkInvariant("observations cannot be empty metric shells", () => {
  const error = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    observations: [{
      ...validObservationForReceipt(),
      metrics: {},
      missingMetricReasons: [],
    }],
  }));
  assert.match(error.issues.join("\n"), /observations\[0\].*metrics.*missingMetricReasons/i);
});

checkInvariant("observations bind to a receipt with matching candidate and remote evidence", () => {
  const missingReceiptError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    observations: [validObservationForReceipt(SHA_A, "publish-missing")],
  }));
  assert.match(missingReceiptError.issues.join("\n"), /observations\[0\]\.publishReceiptId.*missing/i);

  const secondCandidate = validSecondCandidate();
  const mismatchedCandidateError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    candidates: [validCandidate(), secondCandidate],
    observations: [validObservationForReceipt(SHA_B)],
  }));
  assert.match(mismatchedCandidateError.issues.join("\n"), /observations\[0\]\.publishReceiptId.*candidateSha256/i);

  for (const receipt of [
    receiptWithoutOutcome("publishing"),
    receiptWithoutOutcome("uncertain", "dispatch-ambiguous"),
  ]) {
    const noEvidenceError = expectValidationError(() => assertValidThreadRunManifest({
      ...validBoundManifest(),
      publishReceipts: [receipt],
      observations: [validObservationForReceipt(SHA_A, receipt.receiptId)],
    }));
    assert.match(noEvidenceError.issues.join("\n"), /observations\[0\]\.publishReceiptId.*remote evidence/i);
  }
});

checkInvariant("receipt and observation chronology is monotonic", () => {
  for (const receipt of [
    {
      ...validPublishReceipt(),
      attemptedAt: OTHER_TIMESTAMP,
      publishedAt: EARLIER_TIMESTAMP,
    },
    {
      ...validPartialPublishReceipt(),
      attemptedAt: OTHER_TIMESTAMP,
      publishedAt: EARLIER_TIMESTAMP,
    },
    {
      ...uncertainReceiptWithKnownPrefix(),
      attemptedAt: OTHER_TIMESTAMP,
      publishedAt: EARLIER_TIMESTAMP,
    },
  ]) {
    const receiptChronologyError = expectValidationError(() => assertValidThreadRunManifest({
      ...validBoundManifest(),
      publishReceipts: [receipt],
      observations: [],
    }));
    assert.match(receiptChronologyError.issues.join("\n"), /publishReceipts\[0\]\.publishedAt.*attemptedAt/i);
  }

  const retrievalChronologyError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    observations: [{
      ...validObservationForReceipt(),
      exposedAt: OTHER_TIMESTAMP,
      retrievedAt: EARLIER_TIMESTAMP,
    }],
  }));
  assert.match(retrievalChronologyError.issues.join("\n"), /observations\[0\]\.retrievedAt.*exposedAt/i);

  const exposureChronologyError = expectValidationError(() => assertValidThreadRunManifest({
    ...validBoundManifest(),
    publishReceipts: [{
      ...validPublishReceipt(),
      attemptedAt: EARLIER_TIMESTAMP,
      publishedAt: OTHER_TIMESTAMP,
    }],
    observations: [{
      ...validObservationForReceipt(),
      exposedAt: EARLIER_TIMESTAMP,
      retrievedAt: OTHER_TIMESTAMP,
    }],
  }));
  assert.match(exposureChronologyError.issues.join("\n"), /observations\[0\]\.exposedAt.*publishReceipts\[0\]\.publishedAt/i);
});

checkInvariant("stable manifest IDs report the duplicate occurrence path", () => {
  const duplicateFinding = {
    findingId: "finding-duplicate",
    code: "duplicate",
    severity: "warn",
    message: "Duplicate finding identity.",
  } as const;
  const duplicateCases = [
    {
      path: "candidates[1].candidateId",
      manifest: {
        ...validBoundManifest(),
        candidates: [
          validCandidate(),
          rehashCandidate({ ...validCandidate(), generatedAt: OTHER_TIMESTAMP }),
        ],
        observations: [],
      },
    },
    {
      path: "scorecards[1].scorecardId",
      manifest: {
        ...validBoundManifest(),
        scorecards: [validScorecard(), validScorecard()],
        observations: [],
      },
    },
    {
      path: "scorecards[0].dimensions.provenance.findings[0].findingId",
      manifest: {
        ...validBoundManifest(),
        scorecards: [{
          ...validScorecard(),
          dimensions: {
            ...validScorecard().dimensions,
            factuality: { ...validScorecard().dimensions.factuality, findings: [duplicateFinding] },
            provenance: { ...validScorecard().dimensions.provenance, findings: [duplicateFinding] },
          },
        }],
        observations: [],
      },
    },
    {
      path: "approvals[1].approvalId",
      manifest: {
        ...validBoundManifest(),
        approvals: [validApproval(), validApproval()],
        observations: [],
      },
    },
    {
      path: "publishReceipts[1].receiptId",
      manifest: {
        ...validBoundManifest(),
        publishReceipts: [validPublishReceipt(), validPublishReceipt()],
        observations: [],
      },
    },
    {
      path: "observations[1].observationId",
      manifest: {
        ...validBoundManifest(),
        observations: [validObservationForReceipt(), validObservationForReceipt()],
      },
    },
  ] as const;

  for (const { path, manifest } of duplicateCases) {
    const error = expectValidationError(() => assertValidThreadRunManifest(manifest));
    assert.ok(
      error.issues.some((issue) => issue.includes(`ThreadRunManifest.${path}`) && issue.includes("must be unique")),
      `duplicate ${path} reports its precise path`,
    );
  }
});

assert.deepStrictEqual(
  invariantFailures,
  [],
  `Foundational protocol invariants failed:\n${invariantFailures.join("\n")}`,
);
