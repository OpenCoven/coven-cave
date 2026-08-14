import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  assertValidThreadCandidate,
  compareOrdinalStrings,
} from "./tweet-thread-protocol.ts";
import type {
  EvidenceItem,
  ThreadCandidate,
  ThreadPost,
  ThreadPostMedia,
} from "./tweet-thread-protocol.ts";

export const TWEET_THREAD_BLINDING_PROTOCOL_VERSION =
  "opencoven.tweet-thread.blinding.v1" as const;

const TRIAL_ID_RE = /^trial-[a-z0-9-]+$/;
const CANDIDATE_ID_RE = /^candidate-[a-z0-9-]+$/;
const CLAIM_ID_RE = /^claim-[a-z0-9-]+$/;
const ARM_TOKEN_RE = /^arm-[a-f0-9]{64}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const RFC3339_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MINIMUM_ARM_COUNT = 2;
const MAXIMUM_ARM_COUNT = 32;

export type TweetThreadBlindingErrorCode =
  | "INVALID_TRIAL_ID"
  | "INVALID_SECRET"
  | "INVALID_SEED"
  | "INVALID_STOPPING_RULE"
  | "INVALID_CLOSE_TIMESTAMP"
  | "INVALID_CANDIDATE"
  | "INSUFFICIENT_ARMS"
  | "TOO_MANY_ARMS"
  | "DUPLICATE_CANDIDATE_ID"
  | "DUPLICATE_CANDIDATE_SHA"
  | "TOKEN_COLLISION"
  | "INVALID_PUBLIC_TRIAL"
  | "INVALID_BLINDING_ENVELOPE"
  | "INVALID_VOTE_COUNT"
  | "INVALID_CURRENT_TIME"
  | "TRIAL_ID_MISMATCH"
  | "TRIAL_COMMITMENT_MISMATCH"
  | "REVEAL_COMMITMENT_MISMATCH"
  | "TOKEN_SET_MISMATCH"
  | "REVEAL_LOCKED";

export class TweetThreadBlindingError extends Error {
  readonly code: TweetThreadBlindingErrorCode;

  constructor(code: TweetThreadBlindingErrorCode, message: string) {
    super(message);
    this.name = "TweetThreadBlindingError";
    this.code = code;
  }
}

export interface TweetThreadTrialStoppingRule {
  minimumVotes: number;
  closesAt?: string;
}

export interface PublicThreadPostMedia {
  description: string;
  altText?: string;
}

export interface PublicThreadPost {
  text: string;
  claimIds: string[];
  media?: PublicThreadPostMedia[];
}

export interface PublicThreadEvidence {
  claimId: string;
  summary: string;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface PublicThreadArmContent {
  posts: PublicThreadPost[];
  evidence: PublicThreadEvidence[];
}

export interface PublicBlindedTweetThreadArm {
  armToken: string;
  content: PublicThreadArmContent;
}

export interface PublicBlindedTweetThreadTrial {
  protocolVersion: typeof TWEET_THREAD_BLINDING_PROTOCOL_VERSION;
  trialId: string;
  seedHash: string;
  revealCommitment: string;
  stoppingRule: TweetThreadTrialStoppingRule;
  arms: PublicBlindedTweetThreadArm[];
}

export interface BlindedCandidateReference {
  candidateId: string;
  candidateSha256: string;
}

export interface BlindingEnvelope {
  protocolVersion: typeof TWEET_THREAD_BLINDING_PROTOCOL_VERSION;
  trialId: string;
  publicTrialSha256: string;
  revealCommitment: string;
  mapping: Record<string, BlindedCandidateReference>;
  revealThresholds: TweetThreadTrialStoppingRule;
}

export interface CreateBlindedTweetThreadTrialInput {
  trialId: string;
  candidates: readonly unknown[];
  seed: string;
  secret: string;
  stoppingRule: TweetThreadTrialStoppingRule;
}

export interface CreateBlindedTweetThreadTrialResult {
  publicTrial: PublicBlindedTweetThreadTrial;
  envelope: BlindingEnvelope;
}

export interface RevealBlindedTweetThreadTrialInput {
  publicTrial: PublicBlindedTweetThreadTrial;
  envelope: BlindingEnvelope;
  observedVoteCount: number;
  currentTime: string;
  secret: string;
}

export interface RevealedBlindedTweetThreadArm extends BlindedCandidateReference {
  armToken: string;
}

export interface BlindedTweetThreadReveal {
  protocolVersion: typeof TWEET_THREAD_BLINDING_PROTOCOL_VERSION;
  trialId: string;
  arms: RevealedBlindedTweetThreadArm[];
}

type UnknownRecord = Record<string, unknown>;

function fail(code: TweetThreadBlindingErrorCode, message: string): never {
  throw new TweetThreadBlindingError(code, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareOrdinalStrings);
  const wanted = [...expected].sort(compareOrdinalStrings);
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function strictJsonSnapshot<T>(
  value: T,
  code: TweetThreadBlindingErrorCode,
  message: string,
): T {
  const ancestors = new WeakSet<object>();
  const invalid = (): never => fail(code, message);

  const visit = (current: unknown): unknown => {
    if (
      current === null
      || typeof current === "string"
      || typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : invalid();
    }
    if (typeof current !== "object") return invalid();
    if (ancestors.has(current)) return invalid();

    let array: boolean;
    let prototype: object | null;
    let descriptors: PropertyDescriptorMap;
    try {
      array = Array.isArray(current);
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      return invalid();
    }

    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) return invalid();
    ancestors.add(current);
    try {
      if (array) {
        if (prototype !== Array.prototype) return invalid();
        const lengthDescriptor = descriptors.length;
        if (
          lengthDescriptor === undefined
          || !("value" in lengthDescriptor)
          || lengthDescriptor.enumerable === true
          || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
          || lengthDescriptor.value > 0xffff_ffff
        ) {
          return invalid();
        }
        const length = lengthDescriptor.value as number;
        if (keys.length !== length + 1) return invalid();
        const snapshot: unknown[] = new Array(length);
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined
            || !("value" in descriptor)
            || descriptor.enumerable !== true
          ) {
            return invalid();
          }
          snapshot[index] = visit(descriptor.value);
        }
        return Object.freeze(snapshot);
      }

      if (prototype !== Object.prototype && prototype !== null) return invalid();
      const snapshot: UnknownRecord = Object.create(null) as UnknownRecord;
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || descriptor.enumerable !== true) {
          return invalid();
        }
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: visit(descriptor.value),
          writable: false,
        });
      }
      return Object.freeze(snapshot);
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value) as T;
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value);
}

function isBoundedNonWhitespaceString(
  value: unknown,
  maxLength: number,
): value is string {
  return isNonWhitespaceString(value) && value.length <= maxLength;
}

function isCanonicalClaimId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 128
    && CLAIM_ID_RE.test(value);
}

function isBoundedHttpUrl(value: unknown): value is string {
  if (!isBoundedNonWhitespaceString(value, 2_000) || /\s/u.test(value)) {
    return false;
  }
  try {
    decodeURI(value);
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isStrictRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !RFC3339_UTC_MILLIS.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateStoppingRule(
  value: unknown,
  closeTimestampCode: TweetThreadBlindingErrorCode,
): asserts value is TweetThreadTrialStoppingRule {
  if (!isRecord(value)) {
    fail("INVALID_STOPPING_RULE", "The stopping rule must be an object.");
  }
  const expectedKeys = Object.hasOwn(value, "closesAt")
    ? ["minimumVotes", "closesAt"]
    : ["minimumVotes"];
  if (!hasExactKeys(value, expectedKeys)) {
    fail("INVALID_STOPPING_RULE", "The stopping rule contains unsupported fields.");
  }
  if (
    !Number.isSafeInteger(value.minimumVotes)
    || (value.minimumVotes as number) < 1
  ) {
    fail("INVALID_STOPPING_RULE", "minimumVotes must be a positive safe integer.");
  }
  if (Object.hasOwn(value, "closesAt") && !isStrictRfc3339Timestamp(value.closesAt)) {
    fail(closeTimestampCode, "closesAt must be a real RFC3339 UTC timestamp with milliseconds.");
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareOrdinalStrings)
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}

function publicTrialCommitment(publicTrial: PublicBlindedTweetThreadTrial): string {
  const snapshot = strictJsonSnapshot(
    publicTrial,
    "INVALID_PUBLIC_TRIAL",
    "The public trial commitment input must be plain JSON data.",
  );
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(snapshot)), "utf8")
    .digest("hex");
}

function revealCommitment(
  secret: string,
  publicTrial: Omit<PublicBlindedTweetThreadTrial, "revealCommitment">,
  mapping: Record<string, BlindedCandidateReference>,
  revealThresholds: TweetThreadTrialStoppingRule,
): string {
  const snapshot = strictJsonSnapshot(
    {
      publicTrial,
      mapping,
      revealThresholds,
    },
    "INVALID_BLINDING_ENVELOPE",
    "The reveal commitment input must be plain JSON data.",
  );
  return createHmac("sha256", secret)
    .update(
      `tweet-thread-reveal\u0000${JSON.stringify(canonicalizeJson(snapshot))}`,
      "utf8",
    )
    .digest("hex");
}

function deriveArmToken(
  secret: string,
  trialId: string,
  candidateSha256: string,
): string {
  return `arm-${createHmac("sha256", secret)
    .update(`tweet-thread-arm\u0000${trialId}\u0000${candidateSha256}`, "utf8")
    .digest("hex")}`;
}

function deriveShuffleKey(
  seed: string,
  candidateSha256: string,
  armToken: string,
): string {
  return createHmac("sha256", seed)
    .update(
      `tweet-thread-shuffle\u0000${candidateSha256}\u0000${armToken}`,
      "utf8",
    )
    .digest("hex");
}

function publicMedia(media: ThreadPostMedia): PublicThreadPostMedia {
  return {
    description: media.description,
    ...(media.altText === undefined ? {} : { altText: media.altText }),
  };
}

function publicPost(post: ThreadPost): PublicThreadPost {
  return {
    text: post.text,
    claimIds: [...post.claimIds],
    ...(post.media === undefined ? {} : { media: post.media.map(publicMedia) }),
  };
}

function publicEvidenceItem(evidence: EvidenceItem): PublicThreadEvidence {
  return {
    claimId: evidence.claimId,
    summary: evidence.summary,
    sourceLabel: evidence.sourceLabel,
    ...(evidence.sourceUrl === undefined ? {} : { sourceUrl: evidence.sourceUrl }),
  };
}

function publicContent(candidate: ThreadCandidate): PublicThreadArmContent {
  return {
    posts: candidate.posts.map(publicPost),
    evidence: candidate.evidence.map(publicEvidenceItem),
  };
}

function copyStoppingRule(
  stoppingRule: TweetThreadTrialStoppingRule,
): TweetThreadTrialStoppingRule {
  return {
    minimumVotes: stoppingRule.minimumVotes,
    ...(stoppingRule.closesAt === undefined ? {} : { closesAt: stoppingRule.closesAt }),
  };
}

function assertBoundedArmCount(count: number): void {
  if (count < MINIMUM_ARM_COUNT) {
    fail("INSUFFICIENT_ARMS", "A blinded trial requires at least two candidate arms.");
  }
  if (count > MAXIMUM_ARM_COUNT) {
    fail("TOO_MANY_ARMS", "A blinded trial supports at most 32 candidate arms.");
  }
}

function assertValidPublicMedia(value: unknown): asserts value is PublicThreadPostMedia {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      Object.hasOwn(value, "altText") ? ["description", "altText"] : ["description"],
    )
    || !isBoundedNonWhitespaceString(value.description, 500)
    || (
      Object.hasOwn(value, "altText")
      && !isBoundedNonWhitespaceString(value.altText, 1_000)
    )
  ) {
    fail("INVALID_PUBLIC_TRIAL", "A public media item is malformed.");
  }
}

function assertValidPublicPost(value: unknown): asserts value is PublicThreadPost {
  if (!isRecord(value)) {
    fail("INVALID_PUBLIC_TRIAL", "A public post must be an object.");
  }
  const expectedKeys = Object.hasOwn(value, "media")
    ? ["text", "claimIds", "media"]
    : ["text", "claimIds"];
  if (
    !hasExactKeys(value, expectedKeys)
    || !isBoundedNonWhitespaceString(value.text, 25_000)
    || !Array.isArray(value.claimIds)
    || value.claimIds.length > 32
    || !value.claimIds.every(isCanonicalClaimId)
    || new Set(value.claimIds).size !== value.claimIds.length
  ) {
    fail("INVALID_PUBLIC_TRIAL", "A public post is malformed.");
  }
  if (Object.hasOwn(value, "media")) {
    if (!Array.isArray(value.media) || value.media.length > 4) {
      fail("INVALID_PUBLIC_TRIAL", "Public post media must be an array.");
    }
    for (const media of value.media) assertValidPublicMedia(media);
  }
}

function assertValidPublicEvidence(value: unknown): asserts value is PublicThreadEvidence {
  if (!isRecord(value)) {
    fail("INVALID_PUBLIC_TRIAL", "A public evidence item must be an object.");
  }
  const expectedKeys = Object.hasOwn(value, "sourceUrl")
    ? ["claimId", "summary", "sourceLabel", "sourceUrl"]
    : ["claimId", "summary", "sourceLabel"];
  if (
    !hasExactKeys(value, expectedKeys)
    || !isCanonicalClaimId(value.claimId)
    || !isBoundedNonWhitespaceString(value.summary, 2_000)
    || !isBoundedNonWhitespaceString(value.sourceLabel, 200)
    || (Object.hasOwn(value, "sourceUrl") && !isBoundedHttpUrl(value.sourceUrl))
  ) {
    fail("INVALID_PUBLIC_TRIAL", "A public evidence item is malformed.");
  }
}

function assertValidPublicTrial(
  value: unknown,
): asserts value is PublicBlindedTweetThreadTrial {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      ["protocolVersion", "trialId", "seedHash", "revealCommitment", "stoppingRule", "arms"],
    )
    || value.protocolVersion !== TWEET_THREAD_BLINDING_PROTOCOL_VERSION
    || typeof value.trialId !== "string"
    || value.trialId.length > 128
    || !TRIAL_ID_RE.test(value.trialId)
    || typeof value.seedHash !== "string"
    || !SHA256_RE.test(value.seedHash)
    || typeof value.revealCommitment !== "string"
    || !SHA256_RE.test(value.revealCommitment)
    || !Array.isArray(value.arms)
  ) {
    fail("INVALID_PUBLIC_TRIAL", "The public trial is malformed.");
  }
  assertBoundedArmCount(value.arms.length);
  try {
    validateStoppingRule(value.stoppingRule, "INVALID_PUBLIC_TRIAL");
  } catch (error) {
    if (
      error instanceof TweetThreadBlindingError
      && error.code !== "INVALID_PUBLIC_TRIAL"
    ) {
      fail("INVALID_PUBLIC_TRIAL", "The public trial stopping rule is malformed.");
    }
    throw error;
  }

  const tokens = new Set<string>();
  for (const arm of value.arms) {
    if (
      !isRecord(arm)
      || !hasExactKeys(arm, ["armToken", "content"])
      || typeof arm.armToken !== "string"
      || !ARM_TOKEN_RE.test(arm.armToken)
      || tokens.has(arm.armToken)
      || !isRecord(arm.content)
      || !hasExactKeys(arm.content, ["posts", "evidence"])
      || !Array.isArray(arm.content.posts)
      || arm.content.posts.length < 1
      || arm.content.posts.length > 50
      || !Array.isArray(arm.content.evidence)
      || arm.content.evidence.length < 1
      || arm.content.evidence.length > 512
    ) {
      fail("INVALID_PUBLIC_TRIAL", "A public arm is malformed.");
    }
    tokens.add(arm.armToken);
    const evidenceClaimIds = new Set<string>();
    for (const evidence of arm.content.evidence) {
      assertValidPublicEvidence(evidence);
      if (evidenceClaimIds.has(evidence.claimId)) {
        fail("INVALID_PUBLIC_TRIAL", "Public evidence claim identifiers must be unique.");
      }
      evidenceClaimIds.add(evidence.claimId);
    }
    for (const post of arm.content.posts) assertValidPublicPost(post);
    for (const post of arm.content.posts) {
      if (post.claimIds.some((claimId: string) => !evidenceClaimIds.has(claimId))) {
        fail("INVALID_PUBLIC_TRIAL", "A public post references missing evidence.");
      }
    }
  }
}

function assertValidEnvelope(value: unknown): asserts value is BlindingEnvelope {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      [
        "protocolVersion",
        "trialId",
        "publicTrialSha256",
        "revealCommitment",
        "mapping",
        "revealThresholds",
      ],
    )
    || value.protocolVersion !== TWEET_THREAD_BLINDING_PROTOCOL_VERSION
    || typeof value.trialId !== "string"
    || value.trialId.length > 128
    || !TRIAL_ID_RE.test(value.trialId)
    || typeof value.publicTrialSha256 !== "string"
    || !SHA256_RE.test(value.publicTrialSha256)
    || typeof value.revealCommitment !== "string"
    || !SHA256_RE.test(value.revealCommitment)
    || !isRecord(value.mapping)
  ) {
    fail("INVALID_BLINDING_ENVELOPE", "The blinding envelope is malformed.");
  }
  try {
    validateStoppingRule(value.revealThresholds, "INVALID_BLINDING_ENVELOPE");
  } catch {
    fail("INVALID_BLINDING_ENVELOPE", "The envelope reveal thresholds are malformed.");
  }

  const mappingEntries = Object.entries(value.mapping);
  assertBoundedArmCount(mappingEntries.length);
  const candidateIds = new Set<string>();
  const candidateShas = new Set<string>();
  for (const [token, reference] of mappingEntries) {
    if (
      !ARM_TOKEN_RE.test(token)
      || !isRecord(reference)
      || !hasExactKeys(reference, ["candidateId", "candidateSha256"])
      || typeof reference.candidateId !== "string"
      || reference.candidateId.length > 128
      || !CANDIDATE_ID_RE.test(reference.candidateId)
      || typeof reference.candidateSha256 !== "string"
      || !SHA256_RE.test(reference.candidateSha256)
      || candidateIds.has(reference.candidateId)
      || candidateShas.has(reference.candidateSha256)
    ) {
      fail("INVALID_BLINDING_ENVELOPE", "The envelope mapping is malformed.");
    }
    candidateIds.add(reference.candidateId);
    candidateShas.add(reference.candidateSha256);
  }
}

function hashesEqual(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function sameStoppingRule(
  left: TweetThreadTrialStoppingRule,
  right: TweetThreadTrialStoppingRule,
): boolean {
  return left.minimumVotes === right.minimumVotes
    && left.closesAt === right.closesAt;
}

export function createBlindedTweetThreadTrial(
  input: CreateBlindedTweetThreadTrialInput,
): CreateBlindedTweetThreadTrialResult {
  const trialId = input.trialId;
  const candidateInput = strictJsonSnapshot(
    input.candidates,
    "INVALID_CANDIDATE",
    "Candidate inputs must be plain JSON data.",
  );
  const seed = input.seed;
  const secret = input.secret;
  const stoppingRule = strictJsonSnapshot(
    input.stoppingRule,
    "INVALID_STOPPING_RULE",
    "The stopping rule must be plain JSON data.",
  );
  if (
    typeof trialId !== "string"
    || trialId.length > 128
    || !TRIAL_ID_RE.test(trialId)
  ) {
    fail("INVALID_TRIAL_ID", "trialId must be a strict stable trial identifier.");
  }
  if (!isNonWhitespaceString(secret)) {
    fail("INVALID_SECRET", "The blinding secret must be a non-empty string.");
  }
  if (!isNonWhitespaceString(seed)) {
    fail("INVALID_SEED", "The shuffle seed must be a non-empty string.");
  }
  validateStoppingRule(stoppingRule, "INVALID_CLOSE_TIMESTAMP");
  if (!Array.isArray(candidateInput)) {
    fail("INSUFFICIENT_ARMS", "A blinded trial requires at least two candidate arms.");
  }
  assertBoundedArmCount(candidateInput.length);

  const candidates: ThreadCandidate[] = [];
  const candidateIds = new Set<string>();
  const candidateShas = new Set<string>();
  for (const [index, candidate] of candidateInput.entries()) {
    let validated: ThreadCandidate;
    try {
      validated = assertValidThreadCandidate(candidate);
    } catch {
      fail("INVALID_CANDIDATE", `Candidate at index ${index} is not canonical.`);
    }
    if (candidateShas.has(validated.candidateSha256)) {
      fail("DUPLICATE_CANDIDATE_SHA", "Candidate SHA-256 values must be unique.");
    }
    if (candidateIds.has(validated.candidateId)) {
      fail("DUPLICATE_CANDIDATE_ID", "Candidate identifiers must be unique.");
    }
    candidateShas.add(validated.candidateSha256);
    candidateIds.add(validated.candidateId);
    candidates.push(validated);
  }

  const prepared = candidates
    .sort((left, right) =>
      compareOrdinalStrings(left.candidateSha256, right.candidateSha256)
    )
    .map((candidate) => {
      const armToken = deriveArmToken(
        secret,
        trialId,
        candidate.candidateSha256,
      );
      return {
        candidate,
        armToken,
        shuffleKey: deriveShuffleKey(
          seed,
          candidate.candidateSha256,
          armToken,
        ),
      };
    });

  const tokenSet = new Set(prepared.map((entry) => entry.armToken));
  if (tokenSet.size !== prepared.length) {
    fail("TOKEN_COLLISION", "Opaque arm token derivation produced a collision.");
  }

  prepared.sort((left, right) => {
    const byShuffleKey = compareOrdinalStrings(left.shuffleKey, right.shuffleKey);
    return byShuffleKey === 0
      ? compareOrdinalStrings(left.armToken, right.armToken)
      : byShuffleKey;
  });

  const committedStoppingRule = copyStoppingRule(stoppingRule);
  const publicTrialWithoutCommitment: Omit<
    PublicBlindedTweetThreadTrial,
    "revealCommitment"
  > = {
    protocolVersion: TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
    trialId,
    seedHash: createHash("sha256").update(seed, "utf8").digest("hex"),
    stoppingRule: committedStoppingRule,
    arms: prepared.map(({ candidate, armToken }) => ({
      armToken,
      content: publicContent(candidate),
    })),
  };
  const mapping = Object.fromEntries(
    prepared.map(({ candidate, armToken }) => [
      armToken,
      {
        candidateId: candidate.candidateId,
        candidateSha256: candidate.candidateSha256,
      },
    ]),
  );
  const committedReveal = revealCommitment(
    secret,
    publicTrialWithoutCommitment,
    mapping,
    committedStoppingRule,
  );
  const publicTrial: PublicBlindedTweetThreadTrial = {
    ...publicTrialWithoutCommitment,
    revealCommitment: committedReveal,
  };
  const envelope: BlindingEnvelope = {
    protocolVersion: TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
    trialId,
    publicTrialSha256: publicTrialCommitment(publicTrial),
    revealCommitment: committedReveal,
    mapping,
    revealThresholds: copyStoppingRule(committedStoppingRule),
  };
  return { publicTrial, envelope };
}

export function revealBlindedTweetThreadTrial(
  input: RevealBlindedTweetThreadTrialInput,
): BlindedTweetThreadReveal {
  const publicTrial = strictJsonSnapshot(
    input.publicTrial,
    "INVALID_PUBLIC_TRIAL",
    "The public trial must be plain JSON data.",
  );
  const envelope = strictJsonSnapshot(
    input.envelope,
    "INVALID_BLINDING_ENVELOPE",
    "The blinding envelope must be plain JSON data.",
  );
  const observedVoteCount = input.observedVoteCount;
  const currentTime = input.currentTime;
  const secret = input.secret;

  assertValidPublicTrial(publicTrial);
  assertValidEnvelope(envelope);
  if (!Number.isSafeInteger(observedVoteCount) || observedVoteCount < 0) {
    fail("INVALID_VOTE_COUNT", "observedVoteCount must be a non-negative safe integer.");
  }
  if (!isStrictRfc3339Timestamp(currentTime)) {
    fail("INVALID_CURRENT_TIME", "currentTime must be a real RFC3339 UTC timestamp with milliseconds.");
  }
  if (!isNonWhitespaceString(secret)) {
    fail("INVALID_SECRET", "The reveal secret must be a non-empty string.");
  }
  if (publicTrial.trialId !== envelope.trialId) {
    fail("TRIAL_ID_MISMATCH", "The public trial and envelope trial identifiers differ.");
  }

  const computedCommitment = publicTrialCommitment(publicTrial);
  if (!hashesEqual(computedCommitment, envelope.publicTrialSha256)) {
    fail("TRIAL_COMMITMENT_MISMATCH", "The public trial no longer matches its commitment.");
  }

  const publicTokens = publicTrial.arms.map((arm) => arm.armToken);
  const mappingTokens = Object.keys(envelope.mapping);
  const sortedPublicTokens = [...publicTokens].sort(compareOrdinalStrings);
  const sortedMappingTokens = [...mappingTokens].sort(compareOrdinalStrings);
  if (
    sortedPublicTokens.length !== sortedMappingTokens.length
    || sortedPublicTokens.some((token, index) => token !== sortedMappingTokens[index])
  ) {
    fail("TOKEN_SET_MISMATCH", "Envelope mapping keys must exactly match public arm tokens.");
  }
  if (
    !sameStoppingRule(
      publicTrial.stoppingRule,
      envelope.revealThresholds,
    )
  ) {
    fail("INVALID_BLINDING_ENVELOPE", "Envelope reveal thresholds differ from the public stopping rule.");
  }

  const {
    revealCommitment: _publicRevealCommitment,
    ...publicTrialWithoutCommitment
  } = publicTrial;
  const computedRevealCommitment = revealCommitment(
    secret,
    publicTrialWithoutCommitment,
    envelope.mapping,
    envelope.revealThresholds,
  );
  const publicCommitmentMatches = hashesEqual(
    computedRevealCommitment,
    publicTrial.revealCommitment,
  );
  const envelopeCommitmentMatches = hashesEqual(
    computedRevealCommitment,
    envelope.revealCommitment,
  );
  if (!publicCommitmentMatches || !envelopeCommitmentMatches) {
    fail(
      "REVEAL_COMMITMENT_MISMATCH",
      "The reveal inputs no longer match their secret-backed commitment.",
    );
  }

  const voteThresholdReached =
    observedVoteCount >= envelope.revealThresholds.minimumVotes;
  const closeThresholdReached = envelope.revealThresholds.closesAt !== undefined
    && Date.parse(currentTime) >= Date.parse(envelope.revealThresholds.closesAt);
  if (!voteThresholdReached && !closeThresholdReached) {
    fail("REVEAL_LOCKED", "The precommitted reveal threshold has not been reached.");
  }

  return {
    protocolVersion: TWEET_THREAD_BLINDING_PROTOCOL_VERSION,
    trialId: publicTrial.trialId,
    arms: publicTokens.map((armToken) => ({
      armToken,
      ...envelope.mapping[armToken]!,
    })),
  };
}
