import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import canonicalize from "canonicalize";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import {
  ThreadScorecardDimensionsSchema,
  ThreadScorecardSchema,
  TWEET_THREAD_PROTOCOL_VERSION,
  assertValidThreadCandidate,
  compareOrdinalStrings,
} from "./tweet-thread-protocol.ts";
import type {
  EvidenceItem,
  ThreadCandidate,
  ThreadPost,
  ThreadPostMedia,
  ThreadScorecard,
} from "./tweet-thread-protocol.ts";
import {
  StrictJsonSnapshotError,
  createStrictJsonSnapshot,
} from "./strict-json-snapshot.ts";

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

// These limits admit the protocol maximum of 32 arms with 512 evidence items
// each while bounding hostile descriptor graphs before recursive traversal.
const STRICT_SNAPSHOT_MAX_DEPTH = 64;
const STRICT_SNAPSHOT_MAX_NODE_PROPERTY_BUDGET = 1_000_000;
const STRICT_SNAPSHOT_MAX_OBJECT_KEYS = 1_024;
const STRICT_SNAPSHOT_MAX_ARRAY_LENGTH = 1_024;

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
  | "MIXED_JUDGE_CONTEXT"
  | "TOKEN_COLLISION"
  | "INVALID_PUBLIC_TRIAL"
  | "INVALID_BLINDING_ENVELOPE"
  | "INVALID_VOTE_COUNT"
  | "INVALID_CURRENT_TIME"
  | "TRIAL_ID_MISMATCH"
  | "TRIAL_COMMITMENT_MISMATCH"
  | "REVEAL_COMMITMENT_MISMATCH"
  | "TOKEN_SET_MISMATCH"
  | "REVEAL_LOCKED"
  | "INVALID_BLINDED_SCORECARD"
  | "DUPLICATE_ARM_SCORECARD";

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

export interface TweetThreadJudgeContext {
  topic: string;
  audience: string;
  objectiveWeights: {
    factuality: number;
    provenance: number;
    accessibility: number;
    voice: number;
    coherence: number;
    engagement: number;
  };
  constraints: {
    minPosts: number;
    maxPosts: number;
    requiredClaimIds: string[];
    bannedPhrases: string[];
    requireAltText: boolean;
  };
  voice: {
    tone: string;
    do: string[];
    dont: string[];
  };
}

export interface PublicBlindedTweetThreadTrial {
  protocolVersion: typeof TWEET_THREAD_BLINDING_PROTOCOL_VERSION;
  trialId: string;
  seedHash: string;
  judgeContext: TweetThreadJudgeContext;
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

export const BlindedThreadScorecardSchema = Type.Object({
  protocolVersion: Type.Literal(TWEET_THREAD_BLINDING_PROTOCOL_VERSION),
  trialId: Type.String({ minLength: 7, maxLength: 128, pattern: TRIAL_ID_RE.source }),
  publicTrialSha256: Type.String({ minLength: 64, maxLength: 64, pattern: SHA256_RE.source }),
  armToken: Type.String({ minLength: 68, maxLength: 68, pattern: ARM_TOKEN_RE.source }),
  scorecardId: Type.String({ minLength: 11, maxLength: 128, pattern: "^scorecard-[a-z0-9-]+$" }),
  scoredAt: Type.String({
    format: "date-time",
    minLength: 24,
    maxLength: 24,
    pattern: RFC3339_UTC_MILLIS.source,
  }),
  dimensions: ThreadScorecardDimensionsSchema,
}, { additionalProperties: false });
export type BlindedThreadScorecard = Static<typeof BlindedThreadScorecardSchema>;

export interface RevealBlindedThreadScorecardsInput
  extends RevealBlindedTweetThreadTrialInput {
  scorecards: readonly BlindedThreadScorecard[];
}

type UnknownRecord = Record<string, unknown>;

interface KnownSnapshotField {
  readonly key: string;
  readonly code: TweetThreadBlindingErrorCode;
  readonly message: string;
}

interface CapturedKnownRecord {
  readonly source: object;
  readonly descriptors: PropertyDescriptorMap;
  readonly depth: number;
}

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

function createStrictJsonSnapshotter() {
  const ancestors = new WeakSet<object>();
  let nodePropertyBudget = 0;

  const consumeBudget = (
    amount: number,
    code: TweetThreadBlindingErrorCode,
    message: string,
  ): void => {
    if (
      amount > STRICT_SNAPSHOT_MAX_NODE_PROPERTY_BUDGET - nodePropertyBudget
    ) {
      fail(code, message);
    }
    nodePropertyBudget += amount;
  };

  const visit = (
    current: unknown,
    code: TweetThreadBlindingErrorCode,
    message: string,
    depth: number,
  ): unknown => {
    if (depth > STRICT_SNAPSHOT_MAX_DEPTH) {
      fail(code, message);
    }
    if (
      current === null
      || typeof current === "string"
      || typeof current === "boolean"
    ) {
      consumeBudget(1, code, message);
      return current;
    }
    if (typeof current === "number") {
      consumeBudget(1, code, message);
      return Number.isFinite(current) ? current : fail(code, message);
    }
    if (typeof current !== "object") fail(code, message);
    if (ancestors.has(current)) fail(code, message);

    let array: boolean;
    try {
      array = Array.isArray(current);
    } catch {
      fail(code, message);
    }

    if (array) {
      let prototype: object | null;
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        prototype = Object.getPrototypeOf(current);
        lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      } catch {
        fail(code, message);
      }
      if (prototype !== Array.prototype) fail(code, message);
      if (
        lengthDescriptor === undefined
        || !("value" in lengthDescriptor)
        || lengthDescriptor.enumerable === true
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || lengthDescriptor.value > STRICT_SNAPSHOT_MAX_ARRAY_LENGTH
      ) {
        fail(code, message);
      }

      const length = lengthDescriptor.value as number;
      let keys: PropertyKey[];
      try {
        keys = Reflect.ownKeys(current);
      } catch {
        fail(code, message);
      }
      if (
        keys.some((key) => typeof key === "symbol")
        || keys.length !== length + 1
      ) {
        fail(code, message);
      }
      const keySet = new Set(keys as string[]);
      if (!keySet.has("length")) fail(code, message);
      for (let index = 0; index < length; index += 1) {
        if (!keySet.has(String(index))) fail(code, message);
      }
      consumeBudget(1 + keys.length, code, message);

      const descriptors: PropertyDescriptor[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        } catch {
          fail(code, message);
        }
        if (
          descriptor === undefined
          || !("value" in descriptor)
          || descriptor.enumerable !== true
        ) {
          fail(code, message);
        }
        descriptors[index] = descriptor;
      }

      ancestors.add(current);
      try {
        const snapshot: unknown[] = new Array(length);
        for (let index = 0; index < length; index += 1) {
          snapshot[index] = visit(
            (descriptors[index] as PropertyDescriptor & { value: unknown }).value,
            code,
            message,
            depth + 1,
          );
        }
        return Object.freeze(snapshot);
      } finally {
        ancestors.delete(current);
      }
    }

    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(current);
    } catch {
      fail(code, message);
    }
    if (
      keys.some((key) => typeof key === "symbol")
      || keys.length > STRICT_SNAPSHOT_MAX_OBJECT_KEYS
    ) {
      fail(code, message);
    }
    consumeBudget(1 + keys.length, code, message);

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(current);
    } catch {
      fail(code, message);
    }
    if (prototype !== Object.prototype && prototype !== null) {
      fail(code, message);
    }

    const descriptors: PropertyDescriptorMap = Object.create(null);
    for (const key of keys as string[]) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        fail(code, message);
      }
      if (
        descriptor === undefined
        || !("value" in descriptor)
        || descriptor.enumerable !== true
      ) {
        fail(code, message);
      }
      descriptors[key] = descriptor;
    }

    ancestors.add(current);
    try {
      const snapshot: UnknownRecord = Object.create(null) as UnknownRecord;
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]!;
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: visit(descriptor.value, code, message, depth + 1),
          writable: false,
        });
      }
      return Object.freeze(snapshot);
    } finally {
      ancestors.delete(current);
    }
  };

  const captureKnownRecord = (
    value: unknown,
    fields: readonly KnownSnapshotField[],
    fallbackCode: TweetThreadBlindingErrorCode,
    fallbackMessage: string,
    depth = 0,
  ): CapturedKnownRecord => {
    if (
      depth > STRICT_SNAPSHOT_MAX_DEPTH
      || value === null
      || typeof value !== "object"
    ) {
      fail(fallbackCode, fallbackMessage);
    }

    let array: boolean;
    try {
      array = Array.isArray(value);
    } catch {
      fail(fallbackCode, fallbackMessage);
    }
    if (array) {
      fail(fallbackCode, fallbackMessage);
    }

    let keys: PropertyKey[];
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      fail(fallbackCode, fallbackMessage);
    }
    if (
      keys.some((key) => typeof key === "symbol")
      || keys.length > STRICT_SNAPSHOT_MAX_OBJECT_KEYS
    ) {
      fail(fallbackCode, fallbackMessage);
    }
    consumeBudget(1 + keys.length, fallbackCode, fallbackMessage);

    const expectedKeys = new Set(fields.map((field) => field.key));
    const descriptors: PropertyDescriptorMap = Object.create(null);
    for (const field of fields) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, field.key);
      } catch {
        fail(field.code, field.message);
      }
      if (
        descriptor === undefined
        || !("value" in descriptor)
        || descriptor.enumerable !== true
      ) {
        fail(field.code, field.message);
      }
      descriptors[field.key] = descriptor;
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail(fallbackCode, fallbackMessage);
    }
    if (prototype !== Object.prototype && prototype !== null) {
      fail(fallbackCode, fallbackMessage);
    }
    if (
      keys.length !== fields.length
      || keys.some((key) => !expectedKeys.has(key as string))
    ) {
      fail(fallbackCode, fallbackMessage);
    }
    return { source: value, descriptors, depth };
  };

  const snapshotCapturedField = <T>(
    captured: CapturedKnownRecord,
    field: KnownSnapshotField,
  ): T =>
    visit(
      (captured.descriptors[field.key] as PropertyDescriptor & { value: unknown }).value,
      field.code,
      field.message,
      captured.depth + 1,
    ) as T;

  return {
    captureKnownRecord,
    snapshotCapturedField,
    snapshot<T>(
      value: T,
      code: TweetThreadBlindingErrorCode,
      message: string,
      depth = 0,
    ): T {
      return visit(value, code, message, depth) as T;
    },
  };
}

function strictJsonSnapshot<T>(
  value: T,
  code: TweetThreadBlindingErrorCode,
  message: string,
): T {
  return createStrictJsonSnapshotter().snapshot(value, code, message);
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

function serializeCommittedJson(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError("Blinding commitment input is not valid RFC 8785 JSON.");
  }
  return serialized;
}

function publicTrialCommitment(publicTrial: PublicBlindedTweetThreadTrial): string {
  const snapshot = strictJsonSnapshot(
    publicTrial,
    "INVALID_PUBLIC_TRIAL",
    "The public trial commitment input must be plain JSON data.",
  );
  return createHash("sha256")
    .update(serializeCommittedJson(snapshot), "utf8")
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
      `tweet-thread-reveal\u0000${serializeCommittedJson(snapshot)}`,
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

function publicJudgeContext(candidate: ThreadCandidate): TweetThreadJudgeContext {
  return {
    topic: candidate.brief.topic,
    audience: candidate.brief.audience,
    objectiveWeights: {
      factuality: candidate.brief.objectiveWeights.factuality,
      provenance: candidate.brief.objectiveWeights.provenance,
      accessibility: candidate.brief.objectiveWeights.accessibility,
      voice: candidate.brief.objectiveWeights.voice,
      coherence: candidate.brief.objectiveWeights.coherence,
      engagement: candidate.brief.objectiveWeights.engagement,
    },
    constraints: {
      minPosts: candidate.brief.constraints.minPosts,
      maxPosts: candidate.brief.constraints.maxPosts,
      requiredClaimIds: [...candidate.brief.constraints.requiredClaimIds],
      bannedPhrases: [...candidate.brief.constraints.bannedPhrases],
      requireAltText: candidate.brief.constraints.requireAltText,
    },
    voice: {
      tone: candidate.voiceProfile.tone,
      do: [...candidate.voiceProfile.do],
      dont: [...candidate.voiceProfile.dont],
    },
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

function assertValidJudgeContext(value: unknown): asserts value is TweetThreadJudgeContext {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      ["topic", "audience", "objectiveWeights", "constraints", "voice"],
    )
    || !isBoundedNonWhitespaceString(value.topic, 500)
    || !isBoundedNonWhitespaceString(value.audience, 500)
    || !isRecord(value.objectiveWeights)
    || !hasExactKeys(
      value.objectiveWeights,
      ["factuality", "provenance", "accessibility", "voice", "coherence", "engagement"],
    )
    || !isRecord(value.constraints)
    || !hasExactKeys(
      value.constraints,
      ["minPosts", "maxPosts", "requiredClaimIds", "bannedPhrases", "requireAltText"],
    )
    || !isRecord(value.voice)
    || !hasExactKeys(value.voice, ["tone", "do", "dont"])
  ) {
    fail("INVALID_PUBLIC_TRIAL", "The public judge context is malformed.");
  }

  const objectiveWeights = Object.values(value.objectiveWeights);
  if (
    objectiveWeights.some((weight) =>
      typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1
    )
    || !objectiveWeights.some((weight) => (weight as number) > 0)
  ) {
    fail("INVALID_PUBLIC_TRIAL", "The public judge objective weights are malformed.");
  }

  const constraints = value.constraints;
  if (
    !Number.isInteger(constraints.minPosts)
    || !Number.isInteger(constraints.maxPosts)
    || (constraints.minPosts as number) < 1
    || (constraints.maxPosts as number) > 50
    || (constraints.minPosts as number) > (constraints.maxPosts as number)
    || !Array.isArray(constraints.requiredClaimIds)
    || constraints.requiredClaimIds.length > 128
    || !constraints.requiredClaimIds.every(isCanonicalClaimId)
    || new Set(constraints.requiredClaimIds).size !== constraints.requiredClaimIds.length
    || !Array.isArray(constraints.bannedPhrases)
    || constraints.bannedPhrases.length > 128
    || !constraints.bannedPhrases.every((phrase) =>
      isBoundedNonWhitespaceString(phrase, 200)
    )
    || new Set(constraints.bannedPhrases).size !== constraints.bannedPhrases.length
    || typeof constraints.requireAltText !== "boolean"
  ) {
    fail("INVALID_PUBLIC_TRIAL", "The public judge constraints are malformed.");
  }

  if (
    !isBoundedNonWhitespaceString(value.voice.tone, 500)
    || !Array.isArray(value.voice.do)
    || value.voice.do.length > 32
    || !value.voice.do.every((entry) => isBoundedNonWhitespaceString(entry, 200))
    || new Set(value.voice.do).size !== value.voice.do.length
    || !Array.isArray(value.voice.dont)
    || value.voice.dont.length > 32
    || !value.voice.dont.every((entry) => isBoundedNonWhitespaceString(entry, 200))
    || new Set(value.voice.dont).size !== value.voice.dont.length
  ) {
    fail("INVALID_PUBLIC_TRIAL", "The public judge voice context is malformed.");
  }
}

function assertValidPublicTrial(
  value: unknown,
): asserts value is PublicBlindedTweetThreadTrial {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      [
        "protocolVersion",
        "trialId",
        "seedHash",
        "judgeContext",
        "revealCommitment",
        "stoppingRule",
        "arms",
      ],
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
  assertValidJudgeContext(value.judgeContext);
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

const CREATE_INPUT_FIELDS = [
  {
    key: "trialId",
    code: "INVALID_TRIAL_ID",
    message: "trialId must be an own data property.",
  },
  {
    key: "seed",
    code: "INVALID_SEED",
    message: "The shuffle seed must be an own data property.",
  },
  {
    key: "secret",
    code: "INVALID_SECRET",
    message: "The blinding secret must be an own data property.",
  },
  {
    key: "stoppingRule",
    code: "INVALID_STOPPING_RULE",
    message: "The stopping rule must be plain JSON data.",
  },
  {
    key: "candidates",
    code: "INVALID_CANDIDATE",
    message: "Candidate inputs must be plain JSON data.",
  },
] as const satisfies readonly KnownSnapshotField[];

const PUBLIC_TRIAL_FIELDS = [
  {
    key: "protocolVersion",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public trial protocol must be an own data property.",
  },
  {
    key: "trialId",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public trial identifier must be an own data property.",
  },
  {
    key: "seedHash",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public seed hash must be an own data property.",
  },
  {
    key: "judgeContext",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public judge context must be plain JSON data.",
  },
  {
    key: "revealCommitment",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public reveal commitment must be an own data property.",
  },
  {
    key: "stoppingRule",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public stopping rule must be plain JSON data.",
  },
  {
    key: "arms",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public arms must be plain JSON data.",
  },
] as const satisfies readonly KnownSnapshotField[];

const ENVELOPE_FIELDS = [
  {
    key: "protocolVersion",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The envelope protocol must be an own data property.",
  },
  {
    key: "trialId",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The envelope trial identifier must be an own data property.",
  },
  {
    key: "publicTrialSha256",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The public trial SHA-256 must be an own data property.",
  },
  {
    key: "revealCommitment",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The envelope reveal commitment must be an own data property.",
  },
  {
    key: "revealThresholds",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The envelope reveal thresholds must be plain JSON data.",
  },
  {
    key: "mapping",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The envelope mapping must be plain JSON data.",
  },
] as const satisfies readonly KnownSnapshotField[];

const REVEAL_INPUT_FIELDS = [
  {
    key: "observedVoteCount",
    code: "INVALID_VOTE_COUNT",
    message: "observedVoteCount must be an own data property.",
  },
  {
    key: "currentTime",
    code: "INVALID_CURRENT_TIME",
    message: "currentTime must be an own data property.",
  },
  {
    key: "secret",
    code: "INVALID_SECRET",
    message: "The reveal secret must be an own data property.",
  },
  {
    key: "publicTrial",
    code: "INVALID_PUBLIC_TRIAL",
    message: "The public trial must be plain JSON data.",
  },
  {
    key: "envelope",
    code: "INVALID_BLINDING_ENVELOPE",
    message: "The blinding envelope must be plain JSON data.",
  },
] as const satisfies readonly KnownSnapshotField[];

type StrictJsonSnapshotter = ReturnType<typeof createStrictJsonSnapshotter>;

function capturePublicTrial(
  snapshotter: StrictJsonSnapshotter,
  value: unknown,
): CapturedKnownRecord {
  return snapshotter.captureKnownRecord(
    value,
    PUBLIC_TRIAL_FIELDS,
    "INVALID_PUBLIC_TRIAL",
    "The public trial must contain only the known own data properties.",
  );
}

function snapshotPublicTrialControls(
  snapshotter: StrictJsonSnapshotter,
  captured: CapturedKnownRecord,
): Omit<PublicBlindedTweetThreadTrial, "arms"> {
  return {
    protocolVersion: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[0],
    ),
    trialId: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[1],
    ),
    seedHash: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[2],
    ),
    judgeContext: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[3],
    ),
    revealCommitment: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[4],
    ),
    stoppingRule: snapshotter.snapshotCapturedField(
      captured,
      PUBLIC_TRIAL_FIELDS[5],
    ),
  };
}

function captureEnvelope(
  snapshotter: StrictJsonSnapshotter,
  value: unknown,
): CapturedKnownRecord {
  return snapshotter.captureKnownRecord(
    value,
    ENVELOPE_FIELDS,
    "INVALID_BLINDING_ENVELOPE",
    "The blinding envelope must contain only the known own data properties.",
  );
}

function snapshotEnvelopeControls(
  snapshotter: StrictJsonSnapshotter,
  captured: CapturedKnownRecord,
): Omit<BlindingEnvelope, "mapping"> {
  return {
    protocolVersion: snapshotter.snapshotCapturedField(
      captured,
      ENVELOPE_FIELDS[0],
    ),
    trialId: snapshotter.snapshotCapturedField(
      captured,
      ENVELOPE_FIELDS[1],
    ),
    publicTrialSha256: snapshotter.snapshotCapturedField(
      captured,
      ENVELOPE_FIELDS[2],
    ),
    revealCommitment: snapshotter.snapshotCapturedField(
      captured,
      ENVELOPE_FIELDS[3],
    ),
    revealThresholds: snapshotter.snapshotCapturedField(
      captured,
      ENVELOPE_FIELDS[4],
    ),
  };
}

export function createBlindedTweetThreadTrial(
  input: CreateBlindedTweetThreadTrialInput,
): CreateBlindedTweetThreadTrialResult {
  const snapshotter = createStrictJsonSnapshotter();
  const capturedInput = snapshotter.captureKnownRecord(
    input,
    CREATE_INPUT_FIELDS,
    "INVALID_TRIAL_ID",
    "The blinded trial input must contain only the known own data properties.",
  );
  const trialId = snapshotter.snapshotCapturedField<string>(
    capturedInput,
    CREATE_INPUT_FIELDS[0],
  );
  const seed = snapshotter.snapshotCapturedField<string>(
    capturedInput,
    CREATE_INPUT_FIELDS[1],
  );
  const capturedSecret = snapshotter.snapshotCapturedField<string>(
    capturedInput,
    CREATE_INPUT_FIELDS[2],
  );
  const stoppingRule =
    snapshotter.snapshotCapturedField<TweetThreadTrialStoppingRule>(
      capturedInput,
      CREATE_INPUT_FIELDS[3],
    );
  const candidateInput = snapshotter.snapshotCapturedField<unknown[]>(
    capturedInput,
    CREATE_INPUT_FIELDS[4],
  );
  if (
    typeof trialId !== "string"
    || trialId.length > 128
    || !TRIAL_ID_RE.test(trialId)
  ) {
    fail("INVALID_TRIAL_ID", "trialId must be a strict stable trial identifier.");
  }
  if (!isNonWhitespaceString(capturedSecret)) {
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
  const sharedBrief = candidates[0]!.brief;
  const sharedVoiceProfile = candidates[0]!.voiceProfile;
  if (candidates.some((candidate) =>
    !isDeepStrictEqual(candidate.brief, sharedBrief)
    || !isDeepStrictEqual(candidate.voiceProfile, sharedVoiceProfile)
  )) {
    fail(
      "MIXED_JUDGE_CONTEXT",
      "All blinded trial candidates must share deeply identical brief and voice profile content.",
    );
  }

  const prepared = candidates
    .sort((left, right) =>
      compareOrdinalStrings(left.candidateSha256, right.candidateSha256)
    )
    .map((candidate) => {
      const armToken = deriveArmToken(
        capturedSecret,
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
    judgeContext: publicJudgeContext(candidates[0]!),
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
    capturedSecret,
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
  const snapshotter = createStrictJsonSnapshotter();
  const capturedInput = snapshotter.captureKnownRecord(
    input,
    REVEAL_INPUT_FIELDS,
    "INVALID_PUBLIC_TRIAL",
    "The reveal input must contain only the known own data properties.",
  );
  const observedVoteCount = snapshotter.snapshotCapturedField<number>(
    capturedInput,
    REVEAL_INPUT_FIELDS[0],
  );
  const currentTime = snapshotter.snapshotCapturedField<string>(
    capturedInput,
    REVEAL_INPUT_FIELDS[1],
  );
  const capturedSecret = snapshotter.snapshotCapturedField<string>(
    capturedInput,
    REVEAL_INPUT_FIELDS[2],
  );
  const publicTrialCaptured = capturePublicTrial(
    snapshotter,
    (
      capturedInput.descriptors.publicTrial as PropertyDescriptor & {
        value: unknown;
      }
    ).value,
  );
  const envelopeCaptured = captureEnvelope(
    snapshotter,
    (
      capturedInput.descriptors.envelope as PropertyDescriptor & {
        value: unknown;
      }
    ).value,
  );
  const publicTrialControls = snapshotPublicTrialControls(
    snapshotter,
    publicTrialCaptured,
  );
  const envelopeControls = snapshotEnvelopeControls(
    snapshotter,
    envelopeCaptured,
  );
  const publicTrial: PublicBlindedTweetThreadTrial = {
    ...publicTrialControls,
    arms: snapshotter.snapshotCapturedField(
      publicTrialCaptured,
      PUBLIC_TRIAL_FIELDS[6],
    ),
  };
  const envelope: BlindingEnvelope = {
    ...envelopeControls,
    mapping: snapshotter.snapshotCapturedField(
      envelopeCaptured,
      ENVELOPE_FIELDS[5],
    ),
  };

  assertValidPublicTrial(publicTrial);
  assertValidEnvelope(envelope);
  if (!Number.isSafeInteger(observedVoteCount) || observedVoteCount < 0) {
    fail("INVALID_VOTE_COUNT", "observedVoteCount must be a non-negative safe integer.");
  }
  if (!isStrictRfc3339Timestamp(currentTime)) {
    fail("INVALID_CURRENT_TIME", "currentTime must be a real RFC3339 UTC timestamp with milliseconds.");
  }
  if (!isNonWhitespaceString(capturedSecret)) {
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
    capturedSecret,
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

export function revealBlindedThreadScorecards(
  input: RevealBlindedThreadScorecardsInput,
): ThreadScorecard[] {
  let snapshot: RevealBlindedThreadScorecardsInput;
  try {
    snapshot = createStrictJsonSnapshot(input);
  } catch (error) {
    if (error instanceof StrictJsonSnapshotError) {
      fail(
        "INVALID_BLINDED_SCORECARD",
        "Blinded scorecard conversion requires strict accessor-free plain JSON inputs.",
      );
    }
    throw error;
  }

  const reveal = revealBlindedTweetThreadTrial({
    publicTrial: snapshot.publicTrial,
    envelope: snapshot.envelope,
    observedVoteCount: snapshot.observedVoteCount,
    currentTime: snapshot.currentTime,
    secret: snapshot.secret,
  });
  if (
    !Array.isArray(snapshot.scorecards)
    || snapshot.scorecards.length < 1
    || snapshot.scorecards.length > MAXIMUM_ARM_COUNT
  ) {
    fail(
      "INVALID_BLINDED_SCORECARD",
      "Blinded scorecards must be a bounded non-empty array.",
    );
  }

  const revealedByToken = new Map(
    reveal.arms.map((arm) => [arm.armToken, arm]),
  );
  const seenArmTokens = new Set<string>();
  const seenScorecardIds = new Set<string>();
  const converted: ThreadScorecard[] = [];
  for (const scorecard of snapshot.scorecards) {
    if (!Value.Check(BlindedThreadScorecardSchema, scorecard)) {
      fail(
        "INVALID_BLINDED_SCORECARD",
        "A blinded scorecard does not match BlindedThreadScorecardSchema.",
      );
    }
    if (
      scorecard.trialId !== snapshot.publicTrial.trialId
      || scorecard.publicTrialSha256 !== snapshot.envelope.publicTrialSha256
      || !revealedByToken.has(scorecard.armToken)
    ) {
      fail(
        "INVALID_BLINDED_SCORECARD",
        "A blinded scorecard is not bound to this committed trial arm.",
      );
    }
    if (seenArmTokens.has(scorecard.armToken)) {
      fail(
        "DUPLICATE_ARM_SCORECARD",
        "Each blinded trial arm may have at most one scorecard.",
      );
    }
    if (seenScorecardIds.has(scorecard.scorecardId)) {
      fail(
        "INVALID_BLINDED_SCORECARD",
        "Blinded scorecard identifiers must be unique.",
      );
    }
    seenArmTokens.add(scorecard.armToken);
    seenScorecardIds.add(scorecard.scorecardId);
    const candidateSha256 = revealedByToken.get(scorecard.armToken)!.candidateSha256;
    const canonical: ThreadScorecard = {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      scorecardId: scorecard.scorecardId,
      candidateSha256,
      scoredAt: scorecard.scoredAt,
      dimensions: scorecard.dimensions,
      blinding: {
        trialId: scorecard.trialId,
        publicTrialSha256: scorecard.publicTrialSha256,
        armToken: scorecard.armToken,
      },
    };
    if (!Value.Check(ThreadScorecardSchema, canonical)) {
      fail(
        "INVALID_BLINDED_SCORECARD",
        "Converted scorecard does not match ThreadScorecardSchema.",
      );
    }
    converted.push(createStrictJsonSnapshot(canonical));
  }
  Object.freeze(converted);
  return converted;
}
