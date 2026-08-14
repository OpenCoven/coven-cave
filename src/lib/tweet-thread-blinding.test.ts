import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { Value } from "typebox/value";

import {
  TWEET_THREAD_PROTOCOL_VERSION,
  ThreadScorecardSchema,
  computeThreadCandidateSha256,
} from "./tweet-thread-protocol.ts";
import type {
  ThreadCandidate,
  ThreadCandidateCanonicalContent,
} from "./tweet-thread-protocol.ts";
import {
  TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
  BlindedThreadScorecardSchema,
  BlindedScorecardSetCommitmentSchema,
  TweetThreadBlindingError,
  createBlindedScorecardSetCommitment,
  createBlindedTweetThreadTrial,
  revealBlindedTweetThreadTrial,
  revealBlindedThreadScorecards,
} from "./tweet-thread-blinding.ts";
import type {
  BlindedThreadScorecard,
  BlindedScorecardSetCommitment,
  BlindingEnvelope,
  PublicBlindedTweetThreadTrial,
  TweetThreadBlindingErrorCode,
} from "./tweet-thread-blinding.ts";

const GENERATED_AT = "2026-08-14T12:00:00.000Z";
const CLOSES_AT = "2026-08-15T12:00:00.000Z";
const TRIAL_ID = "trial-thread-fixture";
const SECRET = "fixture-secret-that-must-never-cross-the-boundary";
const SEED = "fixture-seed-alpha";
const SCORECARD_SET_COMMITMENTS =
  new WeakMap<object, BlindedScorecardSetCommitment>();

function candidate(
  candidateId: string,
  label: string,
  postCount = 2,
): ThreadCandidate {
  const content: ThreadCandidateCanonicalContent = {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId,
    brief: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      briefId: "brief-blinding",
      topic: "Portable blinded thread comparison",
      audience: "Protocol reviewers",
      objectiveWeights: {
        factuality: 1,
        provenance: 1,
        accessibility: 1,
        voice: 1,
        coherence: 1,
        engagement: 1,
      },
      constraints: {
        minPosts: 1,
        maxPosts: 4,
        requiredClaimIds: ["claim-shared"],
        bannedPhrases: [],
        requireAltText: true,
      },
    },
    voiceProfile: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      voiceProfileId: "voice-blinded-trial",
      displayName: "Blinded trial voice",
      tone: "Grounded, concise, and evidence-led",
      do: ["Name the evidence"],
      dont: ["Leak identities"],
    },
    evidence: [{
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: `evidence-${label}`,
      claimId: "claim-shared",
      summary: `${label} provenance summary`,
      sourceLabel: `${label} source`,
      sourceUrl: `https://example.com/${label}`,
      retrievedAt: GENERATED_AT,
    }],
    posts: Array.from({ length: postCount }, (_, index) => ({
      postId: `post-${index + 1}`,
      text: `${label} reviewable post ${index + 1}`,
      claimIds: ["claim-shared"],
      ...(index === 0
        ? {
            media: [{
              description: `${label} chart`,
              altText: `${label} chart showing the reviewed result`,
            }],
          }
        : {}),
    })),
    generatedAt: GENERATED_AT,
  };
  return {
    ...content,
    candidateSha256: computeThreadCandidateSha256(content),
  };
}

const CANDIDATES = [
  candidate("candidate-alpha", "alpha", 3),
  candidate("candidate-bravo", "bravo"),
  candidate("candidate-charlie", "charlie"),
  candidate("candidate-delta", "delta"),
] as const;

function createTrial(
  overrides: Partial<Parameters<typeof createBlindedTweetThreadTrial>[0]> = {},
) {
  const trial = createBlindedTweetThreadTrial({
    trialId: TRIAL_ID,
    candidates: CANDIDATES,
    seed: SEED,
    secret: SECRET,
    stoppingRule: {
      minimumVotes: 12,
      closesAt: CLOSES_AT,
    },
    ...overrides,
  });
  SCORECARD_SET_COMMITMENTS.set(
    trial.publicTrial,
    commitmentFor(trial.publicTrial, trial.envelope),
  );
  return trial;
}

function bulkCandidates(count: number): ThreadCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`candidate-bulk-${index}`, `bulk-${index}`));
}

function candidateWithEvidenceCount(
  candidateId: string,
  label: string,
  evidenceCount: number,
): ThreadCandidate {
  const value = candidate(candidateId, label);
  const content: ThreadCandidateCanonicalContent = {
    ...value,
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      ...value.evidence[0]!,
      evidenceId: `evidence-${label}-${index}`,
      claimId: index === 0 ? "claim-shared" : `claim-${label}-${index}`,
    })),
  };
  delete (content as Partial<ThreadCandidate>).candidateSha256;
  return {
    ...content,
    candidateSha256: computeThreadCandidateSha256(content),
  };
}

function expectedToken(candidateSha256: string): string {
  return `arm-${createHmac("sha256", SECRET)
    .update(`tweet-thread-arm\u0000${TRIAL_ID}\u0000${candidateSha256}`, "utf8")
    .digest("hex")}`;
}

function expectedOrder(seed: string): string[] {
  return CANDIDATES.map((entry) => ({
    candidateSha256: entry.candidateSha256,
    token: expectedToken(entry.candidateSha256),
  }))
    .map((entry) => ({
      ...entry,
      shuffleKey: createHmac("sha256", seed)
        .update(
          `tweet-thread-shuffle\u0000${entry.candidateSha256}\u0000${entry.token}`,
          "utf8",
        )
        .digest("hex"),
    }))
    .sort((left, right) =>
      left.shuffleKey < right.shuffleKey
        ? -1
        : left.shuffleKey > right.shuffleKey
          ? 1
          : left.token < right.token
            ? -1
            : left.token > right.token
              ? 1
              : 0
    )
    .map((entry) => entry.token);
}

function expectCode(
  operation: () => unknown,
  code: TweetThreadBlindingErrorCode,
): TweetThreadBlindingError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TweetThreadBlindingError, `expected ${code}`);
  assert.equal(caught.code, code);
  return caught;
}

function reveal(
  publicTrial: PublicBlindedTweetThreadTrial,
  envelope: BlindingEnvelope,
  observedVoteCount: number,
  currentTime = GENERATED_AT,
  secret = SECRET,
) {
  return revealBlindedTweetThreadTrial({
    publicTrial,
    envelope,
    scorecardSetCommitment: commitmentForReveal(publicTrial, envelope, secret),
    observedVoteCount,
    currentTime,
    secret,
  });
}

function commitmentForReveal(
  publicTrial: PublicBlindedTweetThreadTrial,
  _envelope: BlindingEnvelope,
  secret = SECRET,
): BlindedScorecardSetCommitment {
  if (
    publicTrial !== null
    && typeof publicTrial === "object"
    && secret === SECRET
    && SCORECARD_SET_COMMITMENTS.has(publicTrial)
  ) {
    return SCORECARD_SET_COMMITMENTS.get(publicTrial)!;
  }
  return Object.freeze(Object.create(null)) as BlindedScorecardSetCommitment;
}

function commitmentFor(
  publicTrial: PublicBlindedTweetThreadTrial,
  envelope: BlindingEnvelope,
  secret = SECRET,
): BlindedScorecardSetCommitment {
  return createBlindedScorecardSetCommitment({
    publicTrial,
    envelope,
    scorecards: publicTrial.arms.map((arm, index) =>
      blindedScorecard(
        publicTrial,
        envelope,
        arm.armToken,
        `scorecard-precommit-${index}`,
      )),
    committedAt: GENERATED_AT,
    secret,
  });
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [
        key,
        canonicalizeJson((value as Record<string, unknown>)[key]),
      ]),
  );
}

function publicTrialSha256(publicTrial: PublicBlindedTweetThreadTrial): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(publicTrial)), "utf8")
    .digest("hex");
}

function blindedScorecard(
  publicTrial: PublicBlindedTweetThreadTrial,
  envelope: BlindingEnvelope,
  armToken: string,
  scorecardId: string,
): BlindedThreadScorecard {
  return {
    protocolVersion: TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
    trialId: publicTrial.trialId,
    publicTrialSha256: envelope.publicTrialSha256,
    armToken,
    scorecardId,
    scoredAt: GENERATED_AT,
    dimensions: {
      factuality: { dimension: "factuality", score: 0.9, rationale: "Supported.", findings: [] },
      provenance: { dimension: "provenance", score: 0.8, rationale: "Traceable.", findings: [] },
      accessibility: { dimension: "accessibility", score: 0.7, rationale: "Readable.", findings: [] },
      voice: { dimension: "voice", score: 0.6, rationale: "Aligned.", findings: [] },
      coherence: { dimension: "coherence", score: 0.5, rationale: "Ordered.", findings: [] },
      engagement: { dimension: "engagement", score: 0.4, rationale: "Specific.", findings: [] },
    },
  };
}

function expectInvalidPublicMutation(
  mutate: (publicTrial: PublicBlindedTweetThreadTrial) => void,
): void {
  const { publicTrial, envelope } = createTrial();
  mutate(publicTrial);
  expectCode(
    () => reveal(publicTrial, envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );
}

{
  const { publicTrial, envelope } = createTrial();
  assert.match(publicTrial.revealCommitment, /^[a-f0-9]{64}$/);
  assert.equal(envelope.revealCommitment, publicTrial.revealCommitment);
  assert.equal(publicTrial.protocolVersion, TWEET_THREAD_BLINDING_PROTOCOL_VERSION);
  assert.equal(publicTrial.trialId, TRIAL_ID);
  assert.equal(
    publicTrial.seedHash,
    createHash("sha256").update(SEED, "utf8").digest("hex"),
  );
  assert.deepEqual(publicTrial.stoppingRule, {
    minimumVotes: 12,
    closesAt: CLOSES_AT,
  });
  assert.deepEqual(publicTrial.judgeContext, {
    topic: "Portable blinded thread comparison",
    audience: "Protocol reviewers",
    objectiveWeights: {
      factuality: 1,
      provenance: 1,
      accessibility: 1,
      voice: 1,
      coherence: 1,
      engagement: 1,
    },
    constraints: {
      minPosts: 1,
      maxPosts: 4,
      requiredClaimIds: ["claim-shared"],
      bannedPhrases: [],
      requireAltText: true,
    },
    voice: {
      tone: "Grounded, concise, and evidence-led",
      do: ["Name the evidence"],
      dont: ["Leak identities"],
    },
  });
  assert.deepEqual(publicTrial.arms.map((arm) => arm.armToken), expectedOrder(SEED));
  assert.deepEqual(Object.keys(envelope.mapping), publicTrial.arms.map((arm) => arm.armToken));
  assert.deepEqual(envelope.revealThresholds, publicTrial.stoppingRule);
}

{
  const first = createTrial();
  const second = createTrial();
  const reordered = createTrial({ candidates: [...CANDIDATES].reverse() });
  assert.equal(JSON.stringify(first.publicTrial), JSON.stringify(second.publicTrial));
  assert.equal(JSON.stringify(first.envelope), JSON.stringify(second.envelope));
  assert.equal(JSON.stringify(first.publicTrial), JSON.stringify(reordered.publicTrial));
  assert.equal(JSON.stringify(first.envelope), JSON.stringify(reordered.envelope));

  const alternateOrders = ["fixture-seed-bravo", "fixture-seed-charlie", "fixture-seed-delta"]
    .map((seed) => createTrial({ seed }).publicTrial.arms.map((arm) => arm.armToken));
  assert.ok(
    alternateOrders.some((order) =>
      JSON.stringify(order) !== JSON.stringify(first.publicTrial.arms.map((arm) => arm.armToken))
    ),
    "at least one alternate seed changes the displayed order",
  );
}

{
  const { publicTrial, envelope } = createTrial();
  const tokens = publicTrial.arms.map((arm) => arm.armToken);
  assert.equal(new Set(tokens).size, CANDIDATES.length);
  assert.ok(tokens.every((token) => /^arm-[a-f0-9]{64}$/.test(token)));
  assert.deepEqual(
    new Set(tokens),
    new Set(CANDIDATES.map((entry) => expectedToken(entry.candidateSha256))),
  );

  const publicJson = JSON.stringify(publicTrial);
  for (const forbidden of [
    SECRET,
    SEED,
    GENERATED_AT,
    ...CANDIDATES.flatMap((entry) => [
      entry.candidateId,
      entry.candidateSha256,
      entry.brief.briefId,
      entry.voiceProfile.voiceProfileId,
      entry.voiceProfile.displayName,
      entry.evidence[0]!.evidenceId,
      entry.evidence[0]!.retrievedAt,
      entry.posts[0]!.postId,
    ]),
    "scorecard-",
    "harness-",
  ]) {
    assert.equal(publicJson.includes(forbidden), false, `public trial leaked ${forbidden}`);
  }
  assert.equal(JSON.stringify(envelope).includes(SECRET), false);
  assert.equal(JSON.stringify(envelope).includes(SEED), false);
  assert.deepEqual(
    Object.keys(publicTrial.judgeContext),
    ["topic", "audience", "objectiveWeights", "constraints", "voice"],
  );
  assert.deepEqual(
    Object.keys(publicTrial.judgeContext.voice),
    ["tone", "do", "dont"],
  );

  for (const arm of publicTrial.arms) {
    assert.deepEqual(Object.keys(arm), ["armToken", "content"]);
    assert.deepEqual(Object.keys(arm.content), ["posts", "evidence"]);
    assert.deepEqual(Object.keys(arm.content.posts[0]!), ["text", "claimIds", "media"]);
    assert.deepEqual(Object.keys(arm.content.posts[0]!.media![0]!), ["description", "altText"]);
    assert.deepEqual(
      Object.keys(arm.content.evidence[0]!),
      ["claimId", "summary", "sourceLabel", "sourceUrl"],
    );
  }

  const alphaToken = expectedToken(CANDIDATES[0].candidateSha256);
  const alphaArm = publicTrial.arms.find((arm) => arm.armToken === alphaToken);
  assert.deepEqual(
    alphaArm?.content.posts.map((post) => post.text),
    ["alpha reviewable post 1", "alpha reviewable post 2", "alpha reviewable post 3"],
  );
}

{
  for (const mutate of [
    (value: ThreadCandidate) => {
      value.brief.briefId = "brief-mixed-context";
    },
    (value: ThreadCandidate) => {
      value.brief.topic = "A different trial topic";
    },
    (value: ThreadCandidate) => {
      value.voiceProfile.voiceProfileId = "voice-mixed-context";
    },
    (value: ThreadCandidate) => {
      value.voiceProfile.displayName = "A different identifying display name";
    },
  ]) {
    const mixed = structuredClone(CANDIDATES) as unknown as ThreadCandidate[];
    mutate(mixed[1]!);
    mixed[1]!.candidateSha256 = computeThreadCandidateSha256(mixed[1]!);
    expectCode(
      () => createTrial({ candidates: mixed }),
      "MIXED_JUDGE_CONTEXT",
    );
  }
}

{
  const { publicTrial, envelope } = createTrial();

  const remappedEnvelope = structuredClone(envelope);
  const [firstToken, secondToken] = publicTrial.arms.map((arm) => arm.armToken);
  const firstReference = remappedEnvelope.mapping[firstToken!]!;
  remappedEnvelope.mapping[firstToken!] = remappedEnvelope.mapping[secondToken!]!;
  remappedEnvelope.mapping[secondToken!] = firstReference;
  expectCode(
    () => reveal(publicTrial, remappedEnvelope, 12),
    "REVEAL_COMMITMENT_MISMATCH",
  );

  const alteredThresholdTrial = structuredClone(publicTrial);
  const alteredThresholdEnvelope = structuredClone(envelope);
  alteredThresholdTrial.stoppingRule.minimumVotes = 13;
  alteredThresholdEnvelope.revealThresholds.minimumVotes = 13;
  alteredThresholdEnvelope.publicTrialSha256 = publicTrialSha256(alteredThresholdTrial);
  expectCode(
    () => reveal(alteredThresholdTrial, alteredThresholdEnvelope, 13),
    "REVEAL_COMMITMENT_MISMATCH",
  );

  const alteredContentTrial = structuredClone(publicTrial);
  const alteredContentEnvelope = structuredClone(envelope);
  alteredContentTrial.arms[0]!.content.posts[0]!.text = "Altered after voting";
  alteredContentEnvelope.publicTrialSha256 = publicTrialSha256(alteredContentTrial);
  expectCode(
    () => reveal(alteredContentTrial, alteredContentEnvelope, 12),
    "REVEAL_COMMITMENT_MISMATCH",
  );

  const alteredJudgeContextTrial = structuredClone(publicTrial);
  const alteredJudgeContextEnvelope = structuredClone(envelope);
  alteredJudgeContextTrial.judgeContext.topic = "Tampered judge topic";
  alteredJudgeContextEnvelope.publicTrialSha256 = publicTrialSha256(alteredJudgeContextTrial);
  expectCode(
    () => reveal(alteredJudgeContextTrial, alteredJudgeContextEnvelope, 12),
    "REVEAL_COMMITMENT_MISMATCH",
  );

  const wrongSecretError = expectCode(
    () => reveal(publicTrial, envelope, 12, GENERATED_AT, "wrong-reveal-secret"),
    "REVEAL_COMMITMENT_MISMATCH",
  );
  assert.equal(wrongSecretError.message.includes(SECRET), false);
  assert.equal(wrongSecretError.message.includes("wrong-reveal-secret"), false);
  expectCode(
    () => revealBlindedTweetThreadTrial({
      publicTrial,
      envelope,
      scorecardSetCommitment: commitmentFor(publicTrial, envelope),
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
    } as unknown as Parameters<typeof revealBlindedTweetThreadTrial>[0]),
    "INVALID_SECRET",
  );
}

{
  const { publicTrial, envelope } = createTrial();
  const [firstToken, secondToken] = publicTrial.arms.map((arm) => arm.armToken);

  const duplicateCandidateId = structuredClone(envelope);
  duplicateCandidateId.mapping[secondToken!]!.candidateId =
    duplicateCandidateId.mapping[firstToken!]!.candidateId;
  expectCode(
    () => reveal(publicTrial, duplicateCandidateId, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const duplicateCandidateSha = structuredClone(envelope);
  duplicateCandidateSha.mapping[secondToken!]!.candidateSha256 =
    duplicateCandidateSha.mapping[firstToken!]!.candidateSha256;
  expectCode(
    () => reveal(publicTrial, duplicateCandidateSha, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const noncanonicalCandidateId = structuredClone(envelope);
  noncanonicalCandidateId.mapping[firstToken!]!.candidateId = "candidate-Alpha";
  expectCode(
    () => reveal(publicTrial, noncanonicalCandidateId, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const overlongCandidateId = structuredClone(envelope);
  overlongCandidateId.mapping[firstToken!]!.candidateId =
    `candidate-${"a".repeat(119)}`;
  expectCode(
    () => reveal(publicTrial, overlongCandidateId, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const noncanonicalCandidateSha = structuredClone(envelope);
  noncanonicalCandidateSha.mapping[firstToken!]!.candidateSha256 = "A".repeat(64);
  expectCode(
    () => reveal(publicTrial, noncanonicalCandidateSha, 12),
    "INVALID_BLINDING_ENVELOPE",
  );
}

{
    expectInvalidPublicMutation((trial) => {
      const post = structuredClone(trial.arms[0]!.content.posts[0]!);
      trial.arms[0]!.content.posts = Array.from(
        { length: 51 },
        () => structuredClone(post),
      );
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.text = "x".repeat(25_001);
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.claimIds = Array.from(
        { length: 33 },
        (_, index) => `claim-extra-${index}`,
      );
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.claimIds = [
        `claim-${"a".repeat(123)}`,
      ];
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.claimIds = ["claim-alpha", "claim-alpha"];
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.claimIds = ["claim-Alpha"];
    });
    expectInvalidPublicMutation((trial) => {
      const media = structuredClone(trial.arms[0]!.content.posts[0]!.media![0]!);
      trial.arms[0]!.content.posts[0]!.media = Array.from(
        { length: 5 },
        () => structuredClone(media),
      );
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.media![0]!.description = "x".repeat(501);
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.media![0]!.altText = "x".repeat(1_001);
    });
    expectInvalidPublicMutation((trial) => {
      const firstEvidence = structuredClone(trial.arms[0]!.content.evidence[0]!);
      trial.arms[0]!.content.evidence = Array.from(
        { length: 513 },
        (_, index) => ({
          ...structuredClone(firstEvidence),
          claimId: index === 0 ? firstEvidence.claimId : `claim-evidence-${index}`,
        }),
      );
    });
    expectInvalidPublicMutation((trial) => {
      const duplicate = structuredClone(trial.arms[0]!.content.evidence[0]!);
      trial.arms[0]!.content.evidence.push(duplicate);
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.summary = "x".repeat(2_001);
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.sourceLabel = "x".repeat(201);
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.sourceUrl = "not a URL";
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.sourceUrl = "https://example.com/%zz";
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.sourceUrl = "ftp://example.com/source";
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.evidence[0]!.sourceUrl =
        `https://example.com/${"x".repeat(1_981)}`;
    });
    expectInvalidPublicMutation((trial) => {
      trial.arms[0]!.content.posts[0]!.claimIds = ["claim-orphan"];
    });
    expectInvalidPublicMutation((trial) => {
      trial.judgeContext.topic = "";
    });
    expectInvalidPublicMutation((trial) => {
      for (const key of Object.keys(trial.judgeContext.objectiveWeights) as Array<
        keyof typeof trial.judgeContext.objectiveWeights
      >) {
        trial.judgeContext.objectiveWeights[key] = 0;
      }
    });
    expectInvalidPublicMutation((trial) => {
      trial.judgeContext.constraints.requiredClaimIds = Array.from(
        { length: 129 },
        (_, index) => `claim-context-${index}`,
      );
    });
    expectInvalidPublicMutation((trial) => {
      trial.judgeContext.voice.do = Array.from(
        { length: 33 },
        (_, index) => `Voice instruction ${index}`,
      );
    });

    const unknownKeyMutations: Array<
      (trial: PublicBlindedTweetThreadTrial) => void
    > = [
      (trial) => {
        (trial as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.stoppingRule as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.judgeContext as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.judgeContext.voice as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.arms[0] as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.arms[0]!.content as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (trial.arms[0]!.content.posts[0] as unknown as Record<string, unknown>).unknown = true;
      },
      (trial) => {
        (
          trial.arms[0]!.content.posts[0]!.media![0] as unknown as Record<
            string,
            unknown
          >
        ).unknown = true;
      },
      (trial) => {
        (
          trial.arms[0]!.content.evidence[0] as unknown as Record<string, unknown>
        ).unknown = true;
      },
    ];
    for (const mutate of unknownKeyMutations) {
      expectInvalidPublicMutation(mutate);
    }
}

{
  const { publicTrial, envelope } = createTrial();
  for (const candidateValue of CANDIDATES) {
    const token = expectedToken(candidateValue.candidateSha256);
    assert.deepEqual(envelope.mapping[token], {
      candidateId: candidateValue.candidateId,
      candidateSha256: candidateValue.candidateSha256,
    });
  }

  expectCode(
    () => reveal(publicTrial, envelope, 11),
    "REVEAL_LOCKED",
  );
  const voteReveal = reveal(publicTrial, envelope, 12);
  assert.deepEqual(
    voteReveal.arms,
    publicTrial.arms.map((arm) => ({
      armToken: arm.armToken,
      ...envelope.mapping[arm.armToken]!,
    })),
  );
  assert.equal(JSON.stringify(voteReveal).includes(SECRET), false);
  assert.equal(JSON.stringify(voteReveal).includes(SEED), false);

  expectCode(
    () => reveal(publicTrial, envelope, 0, "2026-08-15T11:59:59.999Z"),
    "REVEAL_LOCKED",
  );
  assert.deepEqual(
    reveal(publicTrial, envelope, 0, CLOSES_AT).arms,
    voteReveal.arms,
  );

  const votesOnly = createTrial({
    stoppingRule: { minimumVotes: 2 },
  });
  expectCode(
    () => reveal(
      votesOnly.publicTrial,
      votesOnly.envelope,
      1,
      "2099-01-01T00:00:00.000Z",
    ),
    "REVEAL_LOCKED",
  );
  assert.deepEqual(
    reveal(votesOnly.publicTrial, votesOnly.envelope, 2).arms,
    votesOnly.publicTrial.arms.map((arm) => ({
      armToken: arm.armToken,
      ...votesOnly.envelope.mapping[arm.armToken]!,
    })),
  );
}

{
  expectCode(
    () => createTrial({ candidates: [CANDIDATES[0]!] }),
    "INSUFFICIENT_ARMS",
  );
  const maximumTrial = createTrial({
    candidates: bulkCandidates(32),
    stoppingRule: { minimumVotes: 1 },
  });
  assert.equal(maximumTrial.publicTrial.arms.length, 32);
  assert.equal(Object.keys(maximumTrial.envelope.mapping).length, 32);
  assert.equal(
    reveal(maximumTrial.publicTrial, maximumTrial.envelope, 1).arms.length,
    32,
  );
  expectCode(
    () => createTrial({ candidates: bulkCandidates(33) }),
    "TOO_MANY_ARMS",
  );
  const duplicateId = candidate("candidate-alpha", "alternate-alpha");
  expectCode(
    () => createTrial({ candidates: [CANDIDATES[0]!, duplicateId] }),
    "DUPLICATE_CANDIDATE_ID",
  );
  expectCode(
    () => createTrial({ candidates: [CANDIDATES[0]!, structuredClone(CANDIDATES[0])] }),
    "DUPLICATE_CANDIDATE_SHA",
  );

  const invalidSha = structuredClone(CANDIDATES[0]);
  invalidSha.candidateSha256 = "0".repeat(64);
  expectCode(
    () => createTrial({ candidates: [invalidSha, CANDIDATES[1]!] }),
    "INVALID_CANDIDATE",
  );
  expectCode(
    () => createTrial({ trialId: "not-a-trial" }),
    "INVALID_TRIAL_ID",
  );
  expectCode(
    () => createTrial({ seed: "" }),
    "INVALID_SEED",
  );
  expectCode(
    () => createTrial({ secret: "" }),
    "INVALID_SECRET",
  );
  expectCode(
    () => createTrial({ stoppingRule: { minimumVotes: 0 } }),
    "INVALID_STOPPING_RULE",
  );
  let creationMinimumVoteReads = 0;
  const accessorStoppingRule = {
    get minimumVotes() {
      creationMinimumVoteReads += 1;
      return creationMinimumVoteReads === 1 ? 12 : 0;
    },
  };
  expectCode(
    () => createTrial({
      stoppingRule: accessorStoppingRule,
    }),
    "INVALID_STOPPING_RULE",
  );
  assert.equal(creationMinimumVoteReads, 0);
  let creationCandidateReads = 0;
  const accessorCandidate = structuredClone(CANDIDATES[0]);
  Object.defineProperty(accessorCandidate, "candidateId", {
    enumerable: true,
    configurable: true,
    get() {
      creationCandidateReads += 1;
      return creationCandidateReads === 1
        ? CANDIDATES[0].candidateId
        : CANDIDATES[1].candidateId;
    },
  });
  expectCode(
    () => createTrial({ candidates: [accessorCandidate, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(creationCandidateReads, 0);
  expectCode(
    () => createTrial({
      stoppingRule: {
        minimumVotes: 12,
        closesAt: "2026-02-30T12:00:00.000Z",
      },
    }),
    "INVALID_CLOSE_TIMESTAMP",
  );
  expectCode(
    () => createTrial({
      stoppingRule: {
        minimumVotes: 12,
        closesAt: "2026-08-15T12:00:00-05:00",
      },
    }),
    "INVALID_CLOSE_TIMESTAMP",
  );
}

{
  const { publicTrial, envelope } = createTrial();
  expectCode(
    () => reveal(
      null as unknown as PublicBlindedTweetThreadTrial,
      envelope,
      12,
    ),
    "INVALID_PUBLIC_TRIAL",
  );
  expectCode(
    () => reveal(
      publicTrial,
      null as unknown as BlindingEnvelope,
      12,
    ),
    "INVALID_BLINDING_ENVELOPE",
  );
  expectCode(
    () => reveal(publicTrial, envelope, -1),
    "INVALID_VOTE_COUNT",
  );
  expectCode(
    () => reveal(publicTrial, envelope, 1.5),
    "INVALID_VOTE_COUNT",
  );
  expectCode(
    () => reveal(publicTrial, envelope, 12, "2026-02-30T12:00:00.000Z"),
    "INVALID_CURRENT_TIME",
  );

  const wrongTrialEnvelope = structuredClone(envelope);
  wrongTrialEnvelope.trialId = "trial-other";
  expectCode(
    () => reveal(publicTrial, wrongTrialEnvelope, 12),
    "TRIAL_ID_MISMATCH",
  );

  const alteredTrial = structuredClone(publicTrial);
  alteredTrial.arms[0]!.content.posts[0]!.text = "Altered after commitment";
  expectCode(
    () => reveal(alteredTrial, envelope, 12),
    "TRIAL_COMMITMENT_MISMATCH",
  );

  const missingMapping = structuredClone(envelope);
  delete missingMapping.mapping[publicTrial.arms[0]!.armToken];
  expectCode(
    () => reveal(publicTrial, missingMapping, 12),
    "TOKEN_SET_MISMATCH",
  );

  const extraMapping = structuredClone(envelope);
  extraMapping.mapping["arm-".concat("f".repeat(64))] = {
    candidateId: "candidate-extra",
    candidateSha256: "e".repeat(64),
  };
  expectCode(
    () => reveal(publicTrial, extraMapping, 12),
    "TOKEN_SET_MISMATCH",
  );

  const alteredThresholds = structuredClone(envelope);
  alteredThresholds.revealThresholds.minimumVotes = 13;
  expectCode(
    () => reveal(publicTrial, alteredThresholds, 13),
    "INVALID_BLINDING_ENVELOPE",
  );
}

{
  const { publicTrial, envelope } = createTrial();

  const tooFewPublicArms = structuredClone(publicTrial);
  tooFewPublicArms.arms = tooFewPublicArms.arms.slice(0, 1);
  expectCode(
    () => reveal(tooFewPublicArms, envelope, 12),
    "INSUFFICIENT_ARMS",
  );

  const tooManyPublicArms = structuredClone(publicTrial);
  tooManyPublicArms.arms = [
    ...Array.from(
      { length: 32 },
      () => structuredClone(tooManyPublicArms.arms[0]!),
    ),
    structuredClone(tooManyPublicArms.arms[0]!),
  ];
  expectCode(
    () => reveal(tooManyPublicArms, envelope, 12),
    "TOO_MANY_ARMS",
  );

  const tooFewMappings = structuredClone(envelope);
  for (const token of Object.keys(tooFewMappings.mapping).slice(1)) {
    delete tooFewMappings.mapping[token];
  }
  expectCode(
    () => reveal(publicTrial, tooFewMappings, 12),
    "INSUFFICIENT_ARMS",
  );

  const tooManyMappings = structuredClone(envelope);
  for (let index = 0; index < 29; index += 1) {
    tooManyMappings.mapping[
      `arm-${index.toString(16).padStart(64, "0")}`
    ] = {
      candidateId: `candidate-extra-${index}`,
      candidateSha256: (index + 100).toString(16).padStart(64, "0"),
    };
  }
  expectCode(
    () => reveal(publicTrial, tooManyMappings, 12),
    "TOO_MANY_ARMS",
  );
}

{
  const base = createTrial();

  let publicMinimumVoteReads = 0;
  const publicMinimumVotes = structuredClone(base.publicTrial);
  Object.defineProperty(publicMinimumVotes.stoppingRule, "minimumVotes", {
    enumerable: true,
    configurable: true,
    get() {
      publicMinimumVoteReads += 1;
      return publicMinimumVoteReads === 1 ? 1 : 12;
    },
  });
  expectCode(
    () => reveal(publicMinimumVotes, base.envelope, 1),
    "INVALID_PUBLIC_TRIAL",
  );
  assert.equal(publicMinimumVoteReads, 0);

  let envelopeMinimumVoteReads = 0;
  const envelopeMinimumVotes = structuredClone(base.envelope);
  Object.defineProperty(envelopeMinimumVotes.revealThresholds, "minimumVotes", {
    enumerable: true,
    configurable: true,
    get() {
      envelopeMinimumVoteReads += 1;
      return envelopeMinimumVoteReads === 1 ? 1 : 12;
    },
  });
  expectCode(
    () => reveal(base.publicTrial, envelopeMinimumVotes, 1),
    "INVALID_BLINDING_ENVELOPE",
  );
  assert.equal(envelopeMinimumVoteReads, 0);

  let revealCommitmentReads = 0;
  const publicCommitmentAccessor = structuredClone(base.publicTrial);
  Object.defineProperty(publicCommitmentAccessor, "revealCommitment", {
    enumerable: true,
    configurable: true,
    get() {
      revealCommitmentReads += 1;
      return revealCommitmentReads === 1
        ? base.publicTrial.revealCommitment
        : "0".repeat(64);
    },
  });
  expectCode(
    () => reveal(publicCommitmentAccessor, base.envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );
  assert.equal(revealCommitmentReads, 0);

  let envelopeCommitmentReads = 0;
  const envelopeCommitmentAccessor = structuredClone(base.envelope);
  Object.defineProperty(envelopeCommitmentAccessor, "revealCommitment", {
    enumerable: true,
    configurable: true,
    get() {
      envelopeCommitmentReads += 1;
      return envelopeCommitmentReads === 1
        ? base.envelope.revealCommitment
        : "0".repeat(64);
    },
  });
  expectCode(
    () => reveal(base.publicTrial, envelopeCommitmentAccessor, 12),
    "INVALID_BLINDING_ENVELOPE",
  );
  assert.equal(envelopeCommitmentReads, 0);

  let armTokenReads = 0;
  const armTokenAccessor = structuredClone(base.publicTrial);
  Object.defineProperty(armTokenAccessor.arms[0]!, "armToken", {
    enumerable: true,
    configurable: true,
    get() {
      armTokenReads += 1;
      return armTokenReads === 1
        ? base.publicTrial.arms[0]!.armToken
        : base.publicTrial.arms[1]!.armToken;
    },
  });
  expectCode(
    () => reveal(armTokenAccessor, base.envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );
  assert.equal(armTokenReads, 0);

  const firstToken = base.publicTrial.arms[0]!.armToken;
  let mappingReferenceReads = 0;
  const mappingReferenceAccessor = structuredClone(base.envelope);
  const originalReference = mappingReferenceAccessor.mapping[firstToken]!;
  Object.defineProperty(mappingReferenceAccessor.mapping, firstToken, {
    enumerable: true,
    configurable: true,
    get() {
      mappingReferenceReads += 1;
      return mappingReferenceReads === 1
        ? originalReference
        : mappingReferenceAccessor.mapping[base.publicTrial.arms[1]!.armToken];
    },
  });
  expectCode(
    () => reveal(base.publicTrial, mappingReferenceAccessor, 12),
    "INVALID_BLINDING_ENVELOPE",
  );
  assert.equal(mappingReferenceReads, 0);

  let candidateReferenceReads = 0;
  const candidateReferenceAccessor = structuredClone(base.envelope);
  Object.defineProperty(
    candidateReferenceAccessor.mapping[firstToken]!,
    "candidateId",
    {
      enumerable: true,
      configurable: true,
      get() {
        candidateReferenceReads += 1;
        return candidateReferenceReads === 1
          ? originalReference.candidateId
          : "candidate-substituted";
      },
    },
  );
  expectCode(
    () => reveal(base.publicTrial, candidateReferenceAccessor, 12),
    "INVALID_BLINDING_ENVELOPE",
  );
  assert.equal(candidateReferenceReads, 0);
}

{
  const expected = createTrial();
  const input: Parameters<typeof createBlindedTweetThreadTrial>[0] = {
    trialId: TRIAL_ID,
    candidates: [...CANDIDATES],
    seed: SEED,
    secret: SECRET,
    stoppingRule: {
      minimumVotes: 12,
      closesAt: CLOSES_AT,
    },
  };
  const attackedInput = new Proxy(input, {
    getPrototypeOf(target) {
      target.seed = "mutated-seed";
      Reflect.set(target, "secret", "mutated-secret");
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.deepEqual(
    createBlindedTweetThreadTrial(attackedInput),
    expected,
    "known sibling descriptors are captured before later structural traps",
  );
}

{
  const expected = createTrial();
  const input: Parameters<typeof createBlindedTweetThreadTrial>[0] = {
    trialId: TRIAL_ID,
    candidates: [],
    seed: SEED,
    secret: SECRET,
    stoppingRule: {
      minimumVotes: 12,
      closesAt: CLOSES_AT,
    },
  };
  input.candidates = new Proxy([...CANDIDATES], {
    ownKeys(target) {
      input.seed = "mutated-seed";
      Reflect.set(input, "secret", "mutated-secret");
      input.stoppingRule.minimumVotes = 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(
    createBlindedTweetThreadTrial(input),
    expected,
    "creation snapshots seed, secret, and stopping rule before candidate traversal",
  );
}

{
  const base = createTrial();
  const original = structuredClone(base.publicTrial);
  let attackedPublicTrial: PublicBlindedTweetThreadTrial;
  const arms = new Proxy(original.arms, {
    ownKeys(target) {
      attackedPublicTrial.stoppingRule.minimumVotes = 1;
      return Reflect.ownKeys(target);
    },
  });
  attackedPublicTrial = {
    arms,
    protocolVersion: original.protocolVersion,
    trialId: original.trialId,
    seedHash: original.seedHash,
    judgeContext: original.judgeContext,
    revealCommitment: original.revealCommitment,
    stoppingRule: original.stoppingRule,
  };
  SCORECARD_SET_COMMITMENTS.set(
    attackedPublicTrial,
    SCORECARD_SET_COMMITMENTS.get(base.publicTrial)!,
  );
  assert.deepEqual(
    reveal(attackedPublicTrial, base.envelope, 12),
    reveal(base.publicTrial, base.envelope, 12),
    "public trial controls are snapshotted before arms regardless of key order",
  );
}

{
  const base = createTrial();
  const attackedEnvelopeSource = structuredClone(base.envelope);
  let attackedEnvelope: BlindingEnvelope;
  const mapping = new Proxy(attackedEnvelopeSource.mapping, {
    ownKeys(target) {
      attackedEnvelope.revealThresholds.minimumVotes = 1;
      return Reflect.ownKeys(target);
    },
  });
  attackedEnvelope = {
    mapping,
    protocolVersion: attackedEnvelopeSource.protocolVersion,
    trialId: attackedEnvelopeSource.trialId,
    publicTrialSha256: attackedEnvelopeSource.publicTrialSha256,
    revealCommitment: attackedEnvelopeSource.revealCommitment,
    revealThresholds: attackedEnvelopeSource.revealThresholds,
  };
  assert.deepEqual(
    reveal(base.publicTrial, attackedEnvelope, 12),
    reveal(base.publicTrial, base.envelope, 12),
    "envelope thresholds are snapshotted before mapping regardless of key order",
  );
}

{
  const base = createTrial();
  const attackedPublicTrial = structuredClone(base.publicTrial);
  const attackedEnvelope = structuredClone(base.envelope);
  attackedPublicTrial.arms = new Proxy(attackedPublicTrial.arms, {
    ownKeys(target) {
      attackedEnvelope.revealThresholds.minimumVotes = 1;
      attackedEnvelope.revealCommitment = "0".repeat(64);
      return Reflect.ownKeys(target);
    },
  });
  SCORECARD_SET_COMMITMENTS.set(
    attackedPublicTrial,
    SCORECARD_SET_COMMITMENTS.get(base.publicTrial)!,
  );
  assert.deepEqual(
    reveal(attackedPublicTrial, attackedEnvelope, 12),
    reveal(base.publicTrial, base.envelope, 12),
    "reveal snapshots both sibling commitments and thresholds before nested payloads",
  );
}

{
  const base = createTrial();
  const input: Parameters<typeof revealBlindedTweetThreadTrial>[0] = {
    publicTrial: base.publicTrial,
    envelope: base.envelope,
    scorecardSetCommitment: commitmentFor(base.publicTrial, base.envelope),
    observedVoteCount: 0,
    currentTime: GENERATED_AT,
    secret: SECRET,
  };
  input.publicTrial = new Proxy(base.publicTrial, {
    ownKeys(target) {
      input.observedVoteCount = 12;
      input.currentTime = CLOSES_AT;
      return Reflect.ownKeys(target);
    },
  });
  expectCode(
    () => revealBlindedTweetThreadTrial(input),
    "REVEAL_LOCKED",
  );
}

{
  const base = createTrial();
  const input: Parameters<typeof revealBlindedTweetThreadTrial>[0] = {
    publicTrial: base.publicTrial,
    envelope: base.envelope,
    scorecardSetCommitment: commitmentFor(base.publicTrial, base.envelope),
    observedVoteCount: 12,
    currentTime: GENERATED_AT,
    secret: SECRET,
  };
  input.publicTrial = new Proxy(base.publicTrial, {
    ownKeys(target) {
      Reflect.set(input, "secret", "mutated-secret");
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(
    revealBlindedTweetThreadTrial(input),
    reveal(base.publicTrial, base.envelope, 12),
    "reveal uses the secret captured before public trial traversal",
  );
}

{
  let deep: unknown = "leaf";
  for (let index = 0; index < 10_000; index += 1) {
    deep = { next: deep };
  }
  expectCode(
    () => createTrial({ candidates: [deep, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
}

{
  let nestedTrapCalls = 0;
  const trappedValue = new Proxy({ value: true }, {
    ownKeys(target) {
      nestedTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const hugeObject = Object.fromEntries(
    Array.from({ length: 1_025 }, (_, index) => [`key-${index}`, trappedValue]),
  );
  expectCode(
    () => createTrial({ candidates: [hugeObject, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    nestedTrapCalls,
    0,
    "object key budgets reject before traversing property values",
  );
}

{
  let nestedTrapCalls = 0;
  const trappedEvidence = new Proxy(structuredClone(CANDIDATES[0].evidence[0]!), {
    ownKeys(target) {
      nestedTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const oversizedEvidence = structuredClone(CANDIDATES[0]);
  oversizedEvidence.evidence = Array.from(
    { length: 1_025 },
    () => trappedEvidence,
  );
  expectCode(
    () => createTrial({ candidates: [oversizedEvidence, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    nestedTrapCalls,
    0,
    "array length budgets reject before traversing entries",
  );
}

{
  const { publicTrial, envelope } = createTrial();
  const scorecards = publicTrial.arms.map((arm, index) =>
    blindedScorecard(publicTrial, envelope, arm.armToken, `scorecard-blinded-${index}`));
  const scorecardSetCommitment = createBlindedScorecardSetCommitment({
    publicTrial,
    envelope,
    scorecards,
    committedAt: GENERATED_AT,
    secret: SECRET,
  });
  assert.equal(
    Value.Check(BlindedScorecardSetCommitmentSchema, scorecardSetCommitment),
    true,
  );
  assert.deepEqual(
    Object.keys(scorecardSetCommitment.scorecardSha256ByArmToken),
    [...publicTrial.arms.map((arm) => arm.armToken)].sort(),
  );
  assert.equal(
    JSON.stringify(scorecardSetCommitment).includes("candidate-"),
    false,
    "precommitment contains no candidate identity",
  );
  assert.equal(
    JSON.stringify(scorecardSetCommitment).includes(CANDIDATES[0].candidateSha256),
    false,
    "precommitment contains no candidate SHA-256",
  );
  assert.ok(scorecards.every((scorecard) => Value.Check(BlindedThreadScorecardSchema, scorecard)));
  assert.equal(
    Value.Check(BlindedThreadScorecardSchema, {
      ...scorecards[0],
      candidateSha256: CANDIDATES[0].candidateSha256,
    }),
    false,
    "blinded scorecards cannot carry candidate identity",
  );

  const revealed = revealBlindedThreadScorecards({
    publicTrial,
    envelope,
    observedVoteCount: 12,
    currentTime: GENERATED_AT,
    secret: SECRET,
    scorecards,
    scorecardSetCommitment,
  });
  assert.equal(revealed.length, scorecards.length);
  for (const [index, scorecard] of revealed.entries()) {
    const blinded = scorecards[index]!;
    assert.equal(Value.Check(ThreadScorecardSchema, scorecard), true);
    assert.equal(
      scorecard.candidateSha256,
      envelope.mapping[blinded.armToken]!.candidateSha256,
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(scorecard.dimensions)),
      blinded.dimensions,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(scorecard.blinding)), {
      trialId: publicTrial.trialId,
      publicTrialSha256: envelope.publicTrialSha256,
      armToken: blinded.armToken,
    });
    assert.equal(Object.getPrototypeOf(scorecard), null);
    assert.equal(Object.getPrototypeOf(scorecard.dimensions), null);
    assert.equal(Object.isFrozen(scorecard.dimensions.factuality), true);
    assert.equal(Object.isFrozen(scorecard.blinding), true);
  }

  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 11,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards,
      scorecardSetCommitment,
    }),
    "REVEAL_LOCKED",
  );

  const wrongTrial = structuredClone(scorecards);
  wrongTrial[0]!.trialId = "trial-other";
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards: wrongTrial,
      scorecardSetCommitment,
    }),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );

  const wrongCommitment = structuredClone(scorecards);
  wrongCommitment[0]!.publicTrialSha256 = "0".repeat(64);
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards: wrongCommitment,
      scorecardSetCommitment,
    }),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );

  const duplicateArm = structuredClone(scorecards);
  duplicateArm[1]!.armToken = duplicateArm[0]!.armToken;
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards: duplicateArm,
      scorecardSetCommitment,
    }),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );

  const foreignToken = structuredClone(scorecards);
  foreignToken[0]!.armToken = `arm-${"f".repeat(64)}`;
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards: foreignToken,
      scorecardSetCommitment,
    }),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );

  const alteredScorecard = structuredClone(scorecards);
  alteredScorecard[0]!.dimensions.factuality.score = 2;
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards: alteredScorecard,
      scorecardSetCommitment,
    }),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );

  const alteredTrial = structuredClone(publicTrial);
  alteredTrial.arms[0]!.content.posts[0]!.text = "Reassigned content";
  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial: alteredTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards,
      scorecardSetCommitment,
    }),
    "TRIAL_COMMITMENT_MISMATCH",
  );

  for (const altered of [
    {
      ...structuredClone(scorecardSetCommitment),
      trialId: "trial-other",
    },
    {
      ...structuredClone(scorecardSetCommitment),
      publicTrialSha256: "0".repeat(64),
    },
    {
      ...structuredClone(scorecardSetCommitment),
      revealCommitment: "0".repeat(64),
    },
    {
      ...structuredClone(scorecardSetCommitment),
      setSha256: "0".repeat(64),
    },
    {
      ...structuredClone(scorecardSetCommitment),
      commitmentHmac: "0".repeat(64),
    },
  ] satisfies BlindedScorecardSetCommitment[]) {
    expectCode(
      () => revealBlindedThreadScorecards({
        publicTrial,
        envelope,
        observedVoteCount: 12,
        currentTime: GENERATED_AT,
        secret: SECRET,
        scorecards,
        scorecardSetCommitment: altered,
      }),
      "SCORECARD_SET_COMMITMENT_MISMATCH",
    );
    expectCode(
      () => revealBlindedTweetThreadTrial({
        publicTrial,
        envelope,
        observedVoteCount: 12,
        currentTime: GENERATED_AT,
        secret: SECRET,
      } as unknown as Parameters<typeof revealBlindedTweetThreadTrial>[0]),
      "SCORECARD_SET_COMMITMENT_MISMATCH",
    );
  }

  for (const substituted of [
    scorecards.slice(0, -1),
    [...scorecards, structuredClone(scorecards[0]!)],
    scorecards.map((scorecard, index) => index === 0
      ? {
          ...scorecard,
          dimensions: {
            ...scorecard.dimensions,
            factuality: {
              ...scorecard.dimensions.factuality,
              findings: [{
                findingId: "finding-substituted",
                code: "substituted",
                severity: "fail" as const,
                message: "Substituted after commitment.",
              }],
            },
          },
        }
      : scorecard),
  ]) {
    expectCode(
      () => revealBlindedThreadScorecards({
        publicTrial,
        envelope,
        observedVoteCount: 12,
        currentTime: GENERATED_AT,
        secret: SECRET,
        scorecards: substituted,
        scorecardSetCommitment,
      }),
      "SCORECARD_SET_COMMITMENT_MISMATCH",
    );
  }

  expectCode(
    () => revealBlindedThreadScorecards({
      publicTrial,
      envelope,
      observedVoteCount: 12,
      currentTime: GENERATED_AT,
      secret: SECRET,
      scorecards,
    } as unknown as Parameters<typeof revealBlindedThreadScorecards>[0]),
    "SCORECARD_SET_COMMITMENT_MISMATCH",
  );
}

{
  let descriptorTrapCalls = 0;
  const oversizedArray = new Proxy(
    Array.from({ length: 1_025 }, () => null),
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createTrial({ candidates: oversizedArray }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    1,
    "oversized arrays inspect only the length descriptor before rejection",
  );
}

{
  let descriptorTrapCalls = 0;
  const sparseArray = new Array(1_024);
  sparseArray[0] = null;
  const trappedSparseArray = new Proxy(sparseArray, {
    getOwnPropertyDescriptor(target, property) {
      descriptorTrapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  expectCode(
    () => createTrial({ candidates: trappedSparseArray }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    1,
    "sparse arrays reject after bounded key inspection without index descriptors",
  );
}

{
  let descriptorTrapCalls = 0;
  const extraKeyArray = [null, null] as unknown[] & { extra?: null };
  extraKeyArray.extra = null;
  const trappedExtraKeyArray = new Proxy(extraKeyArray, {
    getOwnPropertyDescriptor(target, property) {
      descriptorTrapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  expectCode(
    () => createTrial({ candidates: trappedExtraKeyArray }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    1,
    "arrays with extra keys reject without traversing index descriptors",
  );
}

{
  let descriptorTrapCalls = 0;
  const oversizedObject = new Proxy(
    Object.fromEntries(
      Array.from({ length: 1_025 }, (_, index) => [`key-${index}`, null]),
    ),
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createTrial({ candidates: [oversizedObject, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    0,
    "oversized objects reject before any property descriptor retrieval",
  );
}

{
  let descriptorTrapCalls = 0;
  const maximumArray = new Proxy(
    Array.from({ length: 1_024 }, () => null),
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createTrial({ candidates: maximumArray }),
    "TOO_MANY_ARMS",
  );
  assert.equal(
    descriptorTrapCalls,
    1_025,
    "arrays at the snapshot maximum collect the length and every index descriptor",
  );
}

{
  let descriptorTrapCalls = 0;
  const maximumObject = new Proxy(
    Object.fromEntries(
      Array.from({ length: 1_024 }, (_, index) => [`key-${index}`, null]),
    ),
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createTrial({ candidates: [maximumObject, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    1_024,
    "objects at the snapshot maximum collect every bounded descriptor",
  );
}

{
  let descriptorTrapCalls = 0;
  const descriptorFailure = new Proxy(
    { first: null, second: null, third: null },
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        if (property === "second") throw new Error("descriptor unavailable");
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createTrial({ candidates: [descriptorFailure, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    descriptorTrapCalls,
    2,
    "descriptor collection stops at the first failing property trap",
  );
}

{
  let descriptorTrapCalls = 0;
  const input = new Proxy(
    {
      trialId: TRIAL_ID,
      seed: SEED,
      secret: SECRET,
      stoppingRule: {
        minimumVotes: 12,
        closesAt: CLOSES_AT,
      },
      candidates: CANDIDATES,
    },
    {
      getOwnPropertyDescriptor(target, property) {
        descriptorTrapCalls += 1;
        if (property === "secret") throw new Error("secret unavailable");
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    },
  );
  expectCode(
    () => createBlindedTweetThreadTrial(input),
    "INVALID_SECRET",
  );
  assert.equal(
    descriptorTrapCalls,
    3,
    "known-field descriptor failures retain their field-specific error code",
  );
}

{
  let lateTrapCalls = 0;
  const leaf = Array.from({ length: 512 }, () => "leaf");
  const lateLeaf = new Proxy(leaf, {
    ownKeys(target) {
      lateTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const budgetBomb = Array.from({ length: 1_024 }, () => leaf);
  budgetBomb[budgetBomb.length - 1] = lateLeaf;
  expectCode(
    () => createTrial({ candidates: [budgetBomb, CANDIDATES[1]] }),
    "INVALID_CANDIDATE",
  );
  assert.equal(
    lateTrapCalls,
    0,
    "the total node/property budget stops traversal before late payloads",
  );
}

{
  const maximumEvidenceTrial = createTrial({
    candidates: Array.from({ length: 32 }, (_, index) =>
      candidateWithEvidenceCount(
        `candidate-max-evidence-${index}`,
        `max-evidence-${index}`,
        512,
      )),
    stoppingRule: { minimumVotes: 1 },
  });
  assert.equal(maximumEvidenceTrial.publicTrial.arms.length, 32);
  assert.equal(
    reveal(
      maximumEvidenceTrial.publicTrial,
      maximumEvidenceTrial.envelope,
      1,
    ).arms.length,
    32,
  );
}

{
  const base = createTrial();

  const symbolTrial = structuredClone(base.publicTrial);
  Object.defineProperty(symbolTrial, Symbol("hidden"), {
    enumerable: true,
    value: true,
  });
  expectCode(
    () => reveal(symbolTrial, base.envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );

  const sparseTrial = structuredClone(base.publicTrial);
  sparseTrial.arms = new Array(2);
  sparseTrial.arms[0] = structuredClone(base.publicTrial.arms[0]!);
  expectCode(
    () => reveal(sparseTrial, base.envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );

  const cyclicTrial = structuredClone(base.publicTrial);
  (cyclicTrial.arms[0]!.content as unknown as Record<string, unknown>).cycle =
    cyclicTrial;
  expectCode(
    () => reveal(cyclicTrial, base.envelope, 12),
    "INVALID_PUBLIC_TRIAL",
  );

  const nonPlainEnvelope = structuredClone(base.envelope);
  Object.setPrototypeOf(nonPlainEnvelope.mapping, { inherited: true });
  expectCode(
    () => reveal(base.publicTrial, nonPlainEnvelope, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const inaccessibleEnvelope = new Proxy(base.envelope, {
    ownKeys() {
      throw new Error("inaccessible");
    },
  });
  expectCode(
    () => reveal(base.publicTrial, inaccessibleEnvelope, 12),
    "INVALID_BLINDING_ENVELOPE",
  );

  const functionEnvelope = structuredClone(base.envelope);
  const functionReference = functionEnvelope.mapping[
    base.publicTrial.arms[0]!.armToken
  ] as unknown as Record<string, unknown>;
  functionReference.candidateId = () => "candidate-substituted";
  expectCode(
    () => reveal(base.publicTrial, functionEnvelope, 12),
    "INVALID_BLINDING_ENVELOPE",
  );
}

console.log("tweet thread blinding tests passed");
