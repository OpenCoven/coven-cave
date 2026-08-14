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
) {
  return revealBlindedTweetThreadTrial({
    publicTrial,
    envelope,
    observedVoteCount,
    currentTime,
  });
}

{
  const { publicTrial, envelope } = createTrial();
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

console.log("tweet thread blinding tests passed");
