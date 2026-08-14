import { isDeepStrictEqual } from "node:util";

import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const TWEET_THREAD_PROTOCOL_VERSION = "opencoven.tweet-thread.v1" as const;

const RFC3339_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CLAIM_ID_RE = /^claim-[a-z0-9-]+$/;
const POST_ID_RE = /^post-[1-9][0-9]*$/;
const WORD_CHARACTER_RE = /[\p{L}\p{N}_]/u;

const boundedString = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength });

const boundedNonWhitespaceString = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S" });

const timestampString = () =>
  Type.String({ minLength: 24, maxLength: 24, pattern: RFC3339_UTC_MILLIS.source });

const stableId = (prefix: string) =>
  Type.String({ minLength: prefix.length + 2, maxLength: 128, pattern: `^${prefix}-[a-z0-9-]+$` });

const protocolVersionLiteral = () =>
  Type.Literal(TWEET_THREAD_PROTOCOL_VERSION);

const claimIdSchema = () =>
  Type.String({ minLength: 7, maxLength: 128, pattern: CLAIM_ID_RE.source });

const postIdSchema = () =>
  Type.String({ minLength: 6, maxLength: 32, pattern: POST_ID_RE.source });

const sha256Schema = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: SHA256_HEX.source });

export const ObjectiveWeightsSchema = Type.Object({
  factuality: Type.Number({ minimum: 0, maximum: 1 }),
  provenance: Type.Number({ minimum: 0, maximum: 1 }),
  accessibility: Type.Number({ minimum: 0, maximum: 1 }),
  voice: Type.Number({ minimum: 0, maximum: 1 }),
  coherence: Type.Number({ minimum: 0, maximum: 1 }),
  engagement: Type.Number({ minimum: 0, maximum: 1 }),
}, { additionalProperties: false });
export type ObjectiveWeights = Static<typeof ObjectiveWeightsSchema>;

export const ThreadConstraintsSchema = Type.Object({
  minPosts: Type.Integer({ minimum: 1, maximum: 50 }),
  maxPosts: Type.Integer({ minimum: 1, maximum: 50 }),
  requiredClaimIds: Type.Array(claimIdSchema(), { maxItems: 128, uniqueItems: true }),
  bannedPhrases: Type.Array(boundedNonWhitespaceString(200), { maxItems: 128, uniqueItems: true }),
  requireAltText: Type.Boolean(),
}, { additionalProperties: false });
export type ThreadConstraints = Static<typeof ThreadConstraintsSchema>;

export const ThreadBriefSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  briefId: stableId("brief"),
  topic: boundedString(500),
  audience: boundedString(500),
  objectiveWeights: ObjectiveWeightsSchema,
  constraints: ThreadConstraintsSchema,
  notes: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });
export type ThreadBrief = Static<typeof ThreadBriefSchema>;

export const EvidenceItemSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  evidenceId: stableId("evidence"),
  claimId: claimIdSchema(),
  summary: boundedString(2_000),
  sourceLabel: boundedString(200),
  sourceUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  retrievedAt: timestampString(),
}, { additionalProperties: false });
export type EvidenceItem = Static<typeof EvidenceItemSchema>;

export const VoiceProfileSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  voiceProfileId: stableId("voice"),
  displayName: boundedString(120),
  tone: boundedString(500),
  do: Type.Array(boundedString(200), { maxItems: 32, uniqueItems: true }),
  dont: Type.Array(boundedString(200), { maxItems: 32, uniqueItems: true }),
}, { additionalProperties: false });
export type VoiceProfile = Static<typeof VoiceProfileSchema>;

export const ThreadPostMediaSchema = Type.Object({
  description: Type.String({ minLength: 1, maxLength: 500 }),
  altText: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
}, { additionalProperties: false });
export type ThreadPostMedia = Static<typeof ThreadPostMediaSchema>;

export const ThreadPostSchema = Type.Object({
  postId: postIdSchema(),
  text: Type.String({ minLength: 1, maxLength: 25_000 }),
  claimIds: Type.Array(claimIdSchema(), { maxItems: 32, uniqueItems: true }),
  media: Type.Optional(Type.Array(ThreadPostMediaSchema, { maxItems: 4 })),
}, { additionalProperties: false });
export type ThreadPost = Static<typeof ThreadPostSchema>;

export const ThreadCandidateSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  candidateId: stableId("candidate"),
  candidateSha256: sha256Schema(),
  brief: ThreadBriefSchema,
  voiceProfile: VoiceProfileSchema,
  evidence: Type.Array(EvidenceItemSchema, { minItems: 1, maxItems: 512 }),
  posts: Type.Array(ThreadPostSchema, { minItems: 1, maxItems: 50 }),
  generatedAt: timestampString(),
}, { additionalProperties: false });
export type ThreadCandidate = Static<typeof ThreadCandidateSchema>;

const DeterministicFindingSchemaInternal = Type.Object({
  findingId: stableId("finding"),
  code: boundedString(120),
  severity: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("fail")]),
  message: boundedString(2_000),
  postId: Type.Optional(postIdSchema()),
  claimId: Type.Optional(claimIdSchema()),
}, { additionalProperties: false });
export const DeterministicFindingSchema = DeterministicFindingSchemaInternal;
export type DeterministicFinding = Static<typeof DeterministicFindingSchemaInternal>;

const DimensionScoreSchemaInternal = (dimension: DeterministicDimension) => Type.Object({
  dimension: Type.Literal(dimension),
  score: Type.Number({ minimum: 0, maximum: 1 }),
  rationale: boundedString(2_000),
  findings: Type.Array(DeterministicFindingSchemaInternal, { maxItems: 128 }),
}, { additionalProperties: false });

type DeterministicDimension = "factuality" | "provenance" | "accessibility" | "voice" | "coherence" | "engagement";

export const DimensionScoreSchema = Type.Union([
  DimensionScoreSchemaInternal("factuality"),
  DimensionScoreSchemaInternal("provenance"),
  DimensionScoreSchemaInternal("accessibility"),
  DimensionScoreSchemaInternal("voice"),
  DimensionScoreSchemaInternal("coherence"),
  DimensionScoreSchemaInternal("engagement"),
]);
export type DimensionScore = Static<typeof DimensionScoreSchema>;

export const ThreadScorecardDimensionsSchema = Type.Object({
  factuality: DimensionScoreSchemaInternal("factuality"),
  provenance: DimensionScoreSchemaInternal("provenance"),
  accessibility: DimensionScoreSchemaInternal("accessibility"),
  voice: DimensionScoreSchemaInternal("voice"),
  coherence: DimensionScoreSchemaInternal("coherence"),
  engagement: DimensionScoreSchemaInternal("engagement"),
}, { additionalProperties: false });
export type ThreadScorecardDimensions = Static<typeof ThreadScorecardDimensionsSchema>;

export const ThreadScorecardSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  scorecardId: stableId("scorecard"),
  candidateSha256: sha256Schema(),
  scoredAt: timestampString(),
  dimensions: ThreadScorecardDimensionsSchema,
}, { additionalProperties: false });
export type ThreadScorecard = Static<typeof ThreadScorecardSchema>;

export const ApprovalRecordSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  approvalId: stableId("approval"),
  candidateSha256: sha256Schema(),
  decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
  actor: boundedString(200),
  decidedAt: timestampString(),
  note: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });
export type ApprovalRecord = Static<typeof ApprovalRecordSchema>;

const publishReceiptBaseProperties = () => ({
  protocolVersion: protocolVersionLiteral(),
  receiptId: stableId("publish"),
  candidateSha256: sha256Schema(),
  platform: Type.Literal("x"),
  attemptedAt: timestampString(),
});

export const PublishReceiptSchema = Type.Union([
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("publishing"),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("published"),
    publishedAt: timestampString(),
    threadUrl: boundedNonWhitespaceString(2_000),
    remotePostIds: Type.Array(boundedNonWhitespaceString(64), { minItems: 1, maxItems: 50 }),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("failed"),
    errorCode: Type.String({ minLength: 1, maxLength: 120 }),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("uncertain"),
    errorCode: Type.String({ minLength: 1, maxLength: 120 }),
  }, { additionalProperties: false }),
]);
export type PublishReceipt = Static<typeof PublishReceiptSchema>;

export const ThreadObservationMetricsSchema = Type.Object({
  impressions: Type.Optional(Type.Number({ minimum: 0 })),
  likes: Type.Optional(Type.Number({ minimum: 0 })),
  reposts: Type.Optional(Type.Number({ minimum: 0 })),
  replies: Type.Optional(Type.Number({ minimum: 0 })),
  bookmarks: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false });
export type ThreadObservationMetrics = Static<typeof ThreadObservationMetricsSchema>;

export const ThreadObservationSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  observationId: stableId("observation"),
  candidateSha256: sha256Schema(),
  source: Type.Literal("x"),
  retrievedAt: timestampString(),
  exposedAt: timestampString(),
  metrics: ThreadObservationMetricsSchema,
  note: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });
export type ThreadObservation = Static<typeof ThreadObservationSchema>;

export const ThreadRunManifestSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  manifestId: stableId("manifest"),
  runId: stableId("run"),
  createdAt: timestampString(),
  brief: ThreadBriefSchema,
  voiceProfile: VoiceProfileSchema,
  candidates: Type.Array(ThreadCandidateSchema, { minItems: 1, maxItems: 32 }),
  scorecards: Type.Array(ThreadScorecardSchema, { maxItems: 64 }),
  approvals: Type.Array(ApprovalRecordSchema, { maxItems: 64 }),
  publishReceipts: Type.Array(PublishReceiptSchema, { maxItems: 64 }),
  observations: Type.Array(ThreadObservationSchema, { maxItems: 256 }),
}, { additionalProperties: false });
export type ThreadRunManifest = Static<typeof ThreadRunManifestSchema>;

export class TweetThreadProtocolValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("Tweet thread protocol validation failed");
    this.name = "TweetThreadProtocolValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimIfString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function dedupeTrimmedList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  for (const entry of value) {
    const normalized = typeof entry === "string" ? entry.trim() : entry;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function containsBannedPhrase(text: string, phrase: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedPhrase = phrase.trim().toLowerCase();
  if (normalizedPhrase.length === 0) return false;

  const [firstCharacter] = normalizedPhrase;
  const lastCharacter = Array.from(normalizedPhrase).at(-1);
  const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const startBoundary = firstCharacter && WORD_CHARACTER_RE.test(firstCharacter) ? "(?<![\\p{L}\\p{N}_])" : "";
  const endBoundary = lastCharacter && WORD_CHARACTER_RE.test(lastCharacter) ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(`${startBoundary}${escapedPhrase}${endBoundary}`, "u").test(normalizedText);
}

function collectObjectiveWeightIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object with exact objective weight keys.`];
  const issues: string[] = [];
  for (const key of ["factuality", "provenance", "accessibility", "voice", "coherence", "engagement"] as const) {
    const current = value[key];
    if (typeof current !== "number" || current < 0 || current > 1) {
      issues.push(`${path}.${key} must be a number in 0..1.`);
    }
  }
  return issues;
}

function collectThreadBriefIssues(value: unknown, path = "ThreadBrief"): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object.`];
  issues.push(...collectObjectiveWeightIssues(value.objectiveWeights, `${path}.objectiveWeights`));
  const constraints = value.constraints;
  if (!isRecord(constraints)) {
    issues.push(`${path}.constraints must be an object.`);
  } else {
    if (
      typeof constraints.minPosts === "number"
      && typeof constraints.maxPosts === "number"
      && Number.isInteger(constraints.minPosts)
      && Number.isInteger(constraints.maxPosts)
      && constraints.minPosts > constraints.maxPosts
    ) {
      issues.push(`${path}.constraints.minPosts must be less than or equal to maxPosts.`);
    }
    if (Array.isArray(constraints.bannedPhrases)) {
      for (const [index, phrase] of constraints.bannedPhrases.entries()) {
        if (typeof phrase === "string" && phrase.trim().length === 0) {
          issues.push(`${path}.constraints.bannedPhrases[${index}] must contain non-whitespace text.`);
        }
      }
    }
  }
  if (!Value.Check(ThreadBriefSchema, value)) {
    issues.push(`${path} does not match ThreadBriefSchema.`);
  }
  return issues;
}

function collectTimestampIssues(value: unknown, path: string): string[] {
  if (typeof value !== "string" || !RFC3339_UTC_MILLIS.test(value)) return [];
  const timestamp = new Date(value);
  if (!Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value) return [];
  return [`${path} must be a calendar-valid UTC-millisecond timestamp.`];
}

function pushDuplicateIssue(seen: Set<string>, next: string, path: string, issues: string[]): void {
  if (seen.has(next)) {
    issues.push(`${path} must be unique; duplicate value "${next}" found.`);
    return;
  }
  seen.add(next);
}

function collectThreadCandidateIssues(value: unknown, path = "ThreadCandidate"): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object.`];
  issues.push(...collectThreadBriefIssues(value.brief, `${path}.brief`));
  if (!Value.Check(ThreadCandidateSchema, value)) {
    issues.push(`${path} does not match ThreadCandidateSchema.`);
  }
  issues.push(...collectTimestampIssues(value.generatedAt, `${path}.generatedAt`));
  if (!isRecord(value.brief) || !Array.isArray(value.evidence) || !Array.isArray(value.posts)) return issues;

  const evidenceClaimIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const [index, item] of value.evidence.entries()) {
    if (!isRecord(item)) continue;
    issues.push(...collectTimestampIssues(item.retrievedAt, `${path}.evidence[${index}].retrievedAt`));
    if (typeof item.evidenceId === "string") {
      pushDuplicateIssue(evidenceIds, item.evidenceId, `${path}.evidence[${index}].evidenceId`, issues);
    }
    if (typeof item.claimId === "string") {
      pushDuplicateIssue(evidenceClaimIds, item.claimId, `${path}.evidence[${index}].claimId`, issues);
    }
  }

  const constraints = isRecord(value.brief.constraints) ? value.brief.constraints : null;
  if (constraints && Array.isArray(constraints.requiredClaimIds)) {
    for (const claimId of constraints.requiredClaimIds) {
      if (typeof claimId === "string" && !evidenceClaimIds.has(claimId)) {
        issues.push(`${path}.brief.constraints.requiredClaimIds references missing evidence ledger claim "${claimId}".`);
      }
    }
  }

  const postIds = new Set<string>();
  const postedClaimIds = new Set<string>();
  for (const [index, post] of value.posts.entries()) {
    if (!isRecord(post)) continue;
    if (typeof post.postId === "string") {
      pushDuplicateIssue(postIds, post.postId, `${path}.posts[${index}].postId`, issues);
    }
    if (Array.isArray(post.claimIds)) {
      for (const claimId of post.claimIds) {
        if (typeof claimId === "string") postedClaimIds.add(claimId);
        if (typeof claimId === "string" && !evidenceClaimIds.has(claimId)) {
          issues.push(`${path}.posts[${index}].claimIds references missing evidence ledger claim "${claimId}".`);
        }
      }
    }
    if (typeof post.text === "string" && constraints && Array.isArray(constraints.bannedPhrases)) {
      for (const phrase of constraints.bannedPhrases) {
        if (typeof phrase === "string" && containsBannedPhrase(post.text, phrase)) {
          issues.push(`${path}.posts[${index}].text contains banned phrase "${phrase.trim()}".`);
        }
      }
    }
    if (constraints?.requireAltText && Array.isArray(post.media)) {
      for (const [mediaIndex, media] of post.media.entries()) {
        if (!isRecord(media)) continue;
        const altText = media.altText;
        if (typeof altText !== "string" || altText.trim().length === 0) {
          issues.push(`${path}.posts[${index}].media[${mediaIndex}] must include non-empty alt text when requireAltText is true.`);
        }
      }
    }
  }

  if (constraints && Array.isArray(constraints.requiredClaimIds)) {
    for (const claimId of constraints.requiredClaimIds) {
      if (typeof claimId === "string" && !postedClaimIds.has(claimId)) {
        issues.push(`${path}.brief.constraints.requiredClaimIds claim "${claimId}" must appear in at least one post.`);
      }
    }
  }

  if (
    constraints
    && typeof constraints.minPosts === "number"
    && typeof constraints.maxPosts === "number"
    && Number.isInteger(constraints.minPosts)
    && Number.isInteger(constraints.maxPosts)
  ) {
    if (value.posts.length < constraints.minPosts || value.posts.length > constraints.maxPosts) {
      issues.push(`${path}.posts length must stay within brief constraints (${constraints.minPosts}..${constraints.maxPosts}).`);
    }
  }

  return issues;
}

function candidateReferencesFromScorecard(scorecard: ThreadScorecard, candidate: ThreadCandidate, path: string): string[] {
  const issues: string[] = [];
  const postIds = new Set(candidate.posts.map((post) => post.postId));
  const claimIds = new Set(candidate.evidence.map((item) => item.claimId));
  for (const [dimensionName, dimension] of Object.entries(scorecard.dimensions)) {
    for (const [findingIndex, finding] of dimension.findings.entries()) {
      if (finding.postId && !postIds.has(finding.postId)) {
        issues.push(`${path}.dimensions.${dimensionName}.findings[${findingIndex}].postId references missing post "${finding.postId}".`);
      }
      if (finding.claimId && !claimIds.has(finding.claimId)) {
        issues.push(`${path}.dimensions.${dimensionName}.findings[${findingIndex}].claimId references missing claim "${finding.claimId}".`);
      }
    }
  }
  return issues;
}

export function normalizeThreadBrief(input: unknown): ThreadBrief {
  if (!isRecord(input)) {
    throw new TweetThreadProtocolValidationError(["ThreadBrief must be an object."]);
  }
  const normalized: UnknownRecord = { ...input };
  normalized.protocolVersion = trimIfString(input.protocolVersion);
  normalized.briefId = trimIfString(input.briefId);
  normalized.topic = trimIfString(input.topic);
  normalized.audience = trimIfString(input.audience);
  if (Object.hasOwn(input, "notes")) normalized.notes = trimIfString(input.notes);
  if (isRecord(input.objectiveWeights)) {
    normalized.objectiveWeights = { ...input.objectiveWeights };
  }
  if (isRecord(input.constraints)) {
    normalized.constraints = { ...input.constraints };
    (normalized.constraints as UnknownRecord).requiredClaimIds = dedupeTrimmedList(input.constraints.requiredClaimIds);
    (normalized.constraints as UnknownRecord).bannedPhrases = dedupeTrimmedList(input.constraints.bannedPhrases);
  }

  const issues = collectThreadBriefIssues(normalized);
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return normalized as ThreadBrief;
}

export function assertValidThreadCandidate(input: unknown): ThreadCandidate {
  const issues = collectThreadCandidateIssues(input);
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return input as ThreadCandidate;
}

export function assertValidThreadRunManifest(input: unknown): ThreadRunManifest {
  const issues: string[] = [];
  if (!isRecord(input)) {
    throw new TweetThreadProtocolValidationError(["ThreadRunManifest must be an object."]);
  }
  if (!Value.Check(ThreadRunManifestSchema, input)) {
    issues.push("ThreadRunManifest does not match ThreadRunManifestSchema.");
  }
  issues.push(...collectTimestampIssues(input.createdAt, "ThreadRunManifest.createdAt"));
  issues.push(...collectThreadBriefIssues(input.brief, "ThreadRunManifest.brief"));
  if (!Array.isArray(input.candidates)) {
    issues.push("ThreadRunManifest.candidates must be an array.");
  } else {
    for (const [index, candidate] of input.candidates.entries()) {
      issues.push(...collectThreadCandidateIssues(candidate, `ThreadRunManifest.candidates[${index}]`));
    }
  }
  if (Array.isArray(input.scorecards)) {
    for (const [index, scorecard] of input.scorecards.entries()) {
      if (isRecord(scorecard)) {
        issues.push(...collectTimestampIssues(scorecard.scoredAt, `ThreadRunManifest.scorecards[${index}].scoredAt`));
      }
    }
  }
  if (Array.isArray(input.approvals)) {
    for (const [index, approval] of input.approvals.entries()) {
      if (isRecord(approval)) {
        issues.push(...collectTimestampIssues(approval.decidedAt, `ThreadRunManifest.approvals[${index}].decidedAt`));
      }
    }
  }
  if (Array.isArray(input.publishReceipts)) {
    for (const [index, receipt] of input.publishReceipts.entries()) {
      if (!isRecord(receipt)) continue;
      issues.push(...collectTimestampIssues(receipt.attemptedAt, `ThreadRunManifest.publishReceipts[${index}].attemptedAt`));
      issues.push(...collectTimestampIssues(receipt.publishedAt, `ThreadRunManifest.publishReceipts[${index}].publishedAt`));
    }
  }
  if (Array.isArray(input.observations)) {
    for (const [index, observation] of input.observations.entries()) {
      if (!isRecord(observation)) continue;
      issues.push(...collectTimestampIssues(observation.retrievedAt, `ThreadRunManifest.observations[${index}].retrievedAt`));
      issues.push(...collectTimestampIssues(observation.exposedAt, `ThreadRunManifest.observations[${index}].exposedAt`));
    }
  }
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);

  const manifest = input as ThreadRunManifest;
  const candidateBySha = new Map<string, ThreadCandidate>();
  for (const [index, candidate] of manifest.candidates.entries()) {
    if (!isDeepStrictEqual(candidate.brief, manifest.brief)) {
      issues.push(`ThreadRunManifest.candidates[${index}].brief must equal ThreadRunManifest.brief.`);
    }
    if (!isDeepStrictEqual(candidate.voiceProfile, manifest.voiceProfile)) {
      issues.push(`ThreadRunManifest.candidates[${index}].voiceProfile must equal ThreadRunManifest.voiceProfile.`);
    }
    if (candidateBySha.has(candidate.candidateSha256)) {
      issues.push(`ThreadRunManifest.candidates must have unique candidateSha256 values; duplicate "${candidate.candidateSha256}" found.`);
      continue;
    }
    candidateBySha.set(candidate.candidateSha256, candidate);
  }

  for (const [index, scorecard] of manifest.scorecards.entries()) {
    const candidate = candidateBySha.get(scorecard.candidateSha256);
    if (!candidate) {
      issues.push(`ThreadRunManifest.scorecards[${index}] candidate sha "${scorecard.candidateSha256}" does not match any candidate.`);
      continue;
    }
    issues.push(...candidateReferencesFromScorecard(scorecard, candidate, `ThreadRunManifest.scorecards[${index}]`));
  }

  for (const [index, approval] of manifest.approvals.entries()) {
    if (!candidateBySha.has(approval.candidateSha256)) {
      issues.push(`ThreadRunManifest.approvals[${index}] candidate sha "${approval.candidateSha256}" does not match any candidate.`);
    }
  }

  for (const [index, receipt] of manifest.publishReceipts.entries()) {
    if (!candidateBySha.has(receipt.candidateSha256)) {
      issues.push(`ThreadRunManifest.publishReceipts[${index}] candidate sha "${receipt.candidateSha256}" does not match any candidate.`);
    }
  }

  for (const [index, observation] of manifest.observations.entries()) {
    if (!candidateBySha.has(observation.candidateSha256)) {
      issues.push(`ThreadRunManifest.observations[${index}] candidate sha "${observation.candidateSha256}" does not match any candidate.`);
    }
  }

  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return manifest;
}
