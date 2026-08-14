import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import {
  TWEET_THREAD_PROTOCOL_VERSION,
  computeThreadCandidateSha256,
} from "./tweet-thread-protocol.ts";
import type {
  ThreadCandidate,
  ThreadCandidateCanonicalContent,
} from "./tweet-thread-protocol.ts";
import {
  TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
  TweetThreadBlindingError,
  createBlindedTweetThreadTrial,
  revealBlindedTweetThreadTrial,
} from "./tweet-thread-blinding.ts";
import type {
  BlindingEnvelope,
  PublicBlindedTweetThreadTrial,
  TweetThreadBlindingErrorCode,
} from "./tweet-thread-blinding.ts";

const GENERATED_AT = "2026-08-14T12:00:00.000Z";
const CLOSES_AT = "2026-08-15T12:00:00.000Z";
const TRIAL_ID = "trial-thread-fixture";
const SECRET = "fixture-secret-that-must-never-cross-the-boundary";
const SEED = "fixture-seed-alpha";

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
        requiredClaimIds: [`claim-${label}`],
        bannedPhrases: [],
        requireAltText: true,
      },
    },
    voiceProfile: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      voiceProfileId: `voice-${label}`,
      displayName: `model-${label}`,
      tone: `strategy-${label}`,
      do: [`Use the ${label} harness`],
      dont: ["Leak identities"],
    },
    evidence: [{
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: `evidence-${label}`,
      claimId: `claim-${label}`,
      summary: `${label} provenance summary`,
      sourceLabel: `${label} source`,
      sourceUrl: `https://example.com/${label}`,
      retrievedAt: GENERATED_AT,
    }],
    posts: Array.from({ length: postCount }, (_, index) => ({
      postId: `post-${index + 1}`,
      text: `${label} reviewable post ${index + 1}`,
      claimIds: [`claim-${label}`],
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
  return createBlindedTweetThreadTrial({
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
}

function bulkCandidates(count: number): ThreadCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`candidate-bulk-${index}`, `bulk-${index}`));
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
    observedVoteCount,
    currentTime,
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
      entry.voiceProfile.tone,
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
