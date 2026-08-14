import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

import {
  THREAD_VALIDATION_MAX_FINDINGS,
  compareOrdinalStrings as compareCoreOrdinalStrings,
  containsBannedPhrase as containsCoreBannedPhrase,
  validateThreadCandidateCore,
} from "./tweet-thread-validation-core.ts";
import {
  StrictJsonSnapshotError,
  createStrictJsonSnapshot,
} from "./strict-json-snapshot.ts";

export const TWEET_THREAD_PROTOCOL_VERSION = "opencoven.tweet-thread.v1" as const;

const RFC3339_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CLAIM_ID_RE = /^claim-[a-z0-9-]+$/;
const POST_ID_RE = /^post-[1-9][0-9]*$/;
const X_POST_ID_RE = /^[1-9][0-9]*$/;
const X_THREAD_URL_RE = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]*$/;
const HTTP_URL_RE = /^https?:\/\/[^\s/?#]+(?:[/?#]|$)/;
const THREAD_OBSERVATION_METRIC_NAMES = [
  "impressions",
  "likes",
  "reposts",
  "replies",
  "quotes",
  "bookmarks",
] as const;
const OBJECTIVE_WEIGHT_KEYS = [
  "factuality",
  "provenance",
  "accessibility",
  "voice",
  "coherence",
  "engagement",
] as const;
const JCS_JSON_VALUE_SCHEMA = Type.Unsafe({
  $defs: {
    value: {
      anyOf: [
        { type: "null" },
        { type: "boolean" },
        { type: "number" },
        {
          type: "string",
          pattern: "^(?:(?:[^\\uD800-\\uDFFF])|(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]))*$",
        },
        {
          type: "array",
          items: { $ref: "#/$defs/value" },
        },
        {
          type: "object",
          additionalProperties: { $ref: "#/$defs/value" },
        },
      ],
    },
  },
  $ref: "#/$defs/value",
});

const boundedNonWhitespaceString = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S" });

const boundedUrlString = (maxLength: number, pattern = HTTP_URL_RE.source) =>
  Type.String({ format: "uri", minLength: 1, maxLength, pattern });

const timestampString = () =>
  Type.String({ format: "date-time", minLength: 24, maxLength: 24, pattern: RFC3339_UTC_MILLIS.source });

const stableId = (prefix: string) =>
  Type.String({ minLength: prefix.length + 2, maxLength: 128, pattern: `^${prefix}-[a-z0-9-]+$` });

const protocolVersionLiteral = () =>
  Type.Literal(TWEET_THREAD_PROTOCOL_VERSION);

const claimIdSchema = () =>
  Type.String({ minLength: 7, maxLength: 128, pattern: CLAIM_ID_RE.source });

const postIdSchema = () =>
  Type.String({ minLength: 6, maxLength: 32, pattern: POST_ID_RE.source });

const xPostIdSchema = () =>
  Type.String({ minLength: 1, maxLength: 64, pattern: X_POST_ID_RE.source });

const xThreadUrlSchema = () =>
  boundedUrlString(2_000, X_THREAD_URL_RE.source);

const sha256Schema = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: SHA256_HEX.source });

export const ObjectiveWeightsSchema = Type.Object({
  factuality: Type.Number({ minimum: 0, maximum: 1 }),
  provenance: Type.Number({ minimum: 0, maximum: 1 }),
  accessibility: Type.Number({ minimum: 0, maximum: 1 }),
  voice: Type.Number({ minimum: 0, maximum: 1 }),
  coherence: Type.Number({ minimum: 0, maximum: 1 }),
  engagement: Type.Number({ minimum: 0, maximum: 1 }),
}, {
  additionalProperties: false,
  anyOf: OBJECTIVE_WEIGHT_KEYS.map((key) => ({
    required: [key],
    properties: {
      [key]: {
        type: "number",
        exclusiveMinimum: 0,
      },
    },
  })),
});
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
  topic: boundedNonWhitespaceString(500),
  audience: boundedNonWhitespaceString(500),
  objectiveWeights: ObjectiveWeightsSchema,
  constraints: ThreadConstraintsSchema,
  notes: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });
export type ThreadBrief = Static<typeof ThreadBriefSchema>;

export const EvidenceItemSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  evidenceId: stableId("evidence"),
  claimId: claimIdSchema(),
  summary: boundedNonWhitespaceString(2_000),
  sourceLabel: boundedNonWhitespaceString(200),
  sourceUrl: Type.Optional(boundedUrlString(2_000)),
  retrievedAt: timestampString(),
}, { additionalProperties: false });
export type EvidenceItem = Static<typeof EvidenceItemSchema>;

export const VoiceProfileSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  voiceProfileId: stableId("voice"),
  displayName: boundedNonWhitespaceString(120),
  tone: boundedNonWhitespaceString(500),
  do: Type.Array(boundedNonWhitespaceString(200), { maxItems: 32, uniqueItems: true }),
  dont: Type.Array(boundedNonWhitespaceString(200), { maxItems: 32, uniqueItems: true }),
}, { additionalProperties: false });
export type VoiceProfile = Static<typeof VoiceProfileSchema>;

export const ThreadPostMediaSchema = Type.Object({
  description: boundedNonWhitespaceString(500),
  altText: Type.Optional(boundedNonWhitespaceString(1_000)),
}, { additionalProperties: false });
export type ThreadPostMedia = Static<typeof ThreadPostMediaSchema>;

export const ThreadPostSchema = Type.Object({
  postId: postIdSchema(),
  text: boundedNonWhitespaceString(25_000),
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
export const ThreadCandidateCanonicalContentSchema = Type.Omit(
  ThreadCandidateSchema,
  ["candidateSha256"],
);
export type ThreadCandidateCanonicalContent = Omit<ThreadCandidate, "candidateSha256">;

const DeterministicFindingSchemaInternal = Type.Object({
  findingId: stableId("finding"),
  code: boundedNonWhitespaceString(120),
  severity: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("fail")]),
  message: boundedNonWhitespaceString(2_000),
  postId: Type.Optional(postIdSchema()),
  claimId: Type.Optional(claimIdSchema()),
}, { additionalProperties: false });
export const DeterministicFindingSchema = DeterministicFindingSchemaInternal;
export type DeterministicFinding = Static<typeof DeterministicFindingSchemaInternal>;

export const ThreadPostMeasurementSchema = Type.Object({
  postId: postIdSchema(),
  weightedLength: Type.Integer({ minimum: 0 }),
  urlCount: Type.Integer({ minimum: 0 }),
  hashtagCount: Type.Integer({ minimum: 0 }),
  repeatedHashtagCount: Type.Integer({ minimum: 0 }),
  repeatedEmojiRuns: Type.Integer({ minimum: 0 }),
  linkDensity: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });
export type ThreadPostMeasurement = Static<typeof ThreadPostMeasurementSchema>;

export interface ThreadValidationResult {
  candidateSha256: string | null;
  accepted: boolean;
  findings: DeterministicFinding[];
  measurements: ThreadPostMeasurement[];
}

export const ThreadValidationRecordSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  validationId: stableId("validation"),
  candidateSha256: sha256Schema(),
  validatedAt: timestampString(),
  accepted: Type.Boolean(),
  findings: Type.Array(DeterministicFindingSchemaInternal, {
    maxItems: THREAD_VALIDATION_MAX_FINDINGS,
  }),
  measurements: Type.Array(ThreadPostMeasurementSchema, { maxItems: 50 }),
}, { additionalProperties: false });
export type ThreadValidationRecord = Static<typeof ThreadValidationRecordSchema>;

const DimensionScoreSchemaInternal = (dimension: DeterministicDimension) => Type.Object({
  dimension: Type.Literal(dimension),
  score: Type.Number({ minimum: 0, maximum: 1 }),
  rationale: boundedNonWhitespaceString(2_000),
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

export const ThreadScorecardBlindingProvenanceSchema = Type.Object({
  trialId: Type.String({ minLength: 7, maxLength: 128, pattern: "^trial-[a-z0-9-]+$" }),
  publicTrialSha256: sha256Schema(),
  armToken: Type.String({ minLength: 68, maxLength: 68, pattern: "^arm-[a-f0-9]{64}$" }),
}, { additionalProperties: false });
export type ThreadScorecardBlindingProvenance = Static<typeof ThreadScorecardBlindingProvenanceSchema>;

export const ThreadScorecardSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  scorecardId: stableId("scorecard"),
  candidateSha256: sha256Schema(),
  scoredAt: timestampString(),
  dimensions: ThreadScorecardDimensionsSchema,
  blinding: Type.Optional(ThreadScorecardBlindingProvenanceSchema),
}, { additionalProperties: false });
export type ThreadScorecard = Static<typeof ThreadScorecardSchema>;

export const ApprovalRecordSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  approvalId: stableId("approval"),
  candidateSha256: sha256Schema(),
  decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
  actor: boundedNonWhitespaceString(200),
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

const publishReceiptRemoteEvidenceProperties = () => ({
  publishedAt: timestampString(),
  threadUrl: xThreadUrlSchema(),
  remotePostIds: Type.Array(xPostIdSchema(), { minItems: 1, maxItems: 50, uniqueItems: true }),
});

export const PublishReceiptSchema = Type.Union([
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("publishing"),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("published"),
    ...publishReceiptRemoteEvidenceProperties(),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("partial"),
    ...publishReceiptRemoteEvidenceProperties(),
    errorCode: boundedNonWhitespaceString(120),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("failed"),
    errorCode: boundedNonWhitespaceString(120),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("uncertain"),
    errorCode: boundedNonWhitespaceString(120),
  }, { additionalProperties: false }),
  Type.Object({
    ...publishReceiptBaseProperties(),
    status: Type.Literal("uncertain"),
    ...publishReceiptRemoteEvidenceProperties(),
    errorCode: boundedNonWhitespaceString(120),
  }, { additionalProperties: false }),
]);
export type PublishReceipt = Static<typeof PublishReceiptSchema>;

export const ThreadObservationMetricsSchema = Type.Object({
  impressions: Type.Optional(Type.Integer({ minimum: 0 })),
  likes: Type.Optional(Type.Integer({ minimum: 0 })),
  reposts: Type.Optional(Type.Integer({ minimum: 0 })),
  replies: Type.Optional(Type.Integer({ minimum: 0 })),
  quotes: Type.Optional(Type.Integer({ minimum: 0 })),
  bookmarks: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type ThreadObservationMetrics = Static<typeof ThreadObservationMetricsSchema>;

export const ThreadObservationMetricNameSchema = Type.Union([
  Type.Literal("impressions"),
  Type.Literal("likes"),
  Type.Literal("reposts"),
  Type.Literal("replies"),
  Type.Literal("quotes"),
  Type.Literal("bookmarks"),
]);
export type ThreadObservationMetricName = typeof THREAD_OBSERVATION_METRIC_NAMES[number];

export const ThreadObservationMissingMetricReasonSchema = Type.Object({
  metric: ThreadObservationMetricNameSchema,
  reason: boundedNonWhitespaceString(500),
}, { additionalProperties: false });
export type ThreadObservationMissingMetricReason = Static<typeof ThreadObservationMissingMetricReasonSchema>;

export const ThreadObservationSchema = Type.Object({
  protocolVersion: protocolVersionLiteral(),
  observationId: stableId("observation"),
  candidateSha256: sha256Schema(),
  publishReceiptId: stableId("publish"),
  source: Type.Literal("x"),
  retrievedAt: timestampString(),
  exposedAt: timestampString(),
  metrics: ThreadObservationMetricsSchema,
  missingMetricReasons: Type.Array(ThreadObservationMissingMetricReasonSchema, {
    maxItems: THREAD_OBSERVATION_METRIC_NAMES.length,
  }),
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
  validations: Type.Array(ThreadValidationRecordSchema, { maxItems: 64 }),
  scorecards: Type.Array(ThreadScorecardSchema, { maxItems: 64 }),
  approvals: Type.Array(ApprovalRecordSchema, { maxItems: 64 }),
  publishReceipts: Type.Array(PublishReceiptSchema, { maxItems: 64 }),
  observations: Type.Array(ThreadObservationSchema, { maxItems: 256 }),
}, { additionalProperties: false });
export type ThreadRunManifest = Static<typeof ThreadRunManifestSchema>;

export class TweetThreadProtocolValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Tweet thread protocol validation failed: ${issues.join("; ")}`);
    this.name = "TweetThreadProtocolValidationError";
    this.issues = issues;
  }
}

export function createThreadValidationRecord(
  result: ThreadValidationResult,
  validationId: string,
  validatedAt: string,
): ThreadValidationRecord {
  const record = {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    validationId,
    candidateSha256: result.candidateSha256,
    validatedAt,
    accepted: result.accepted,
    findings: result.findings.map((finding) => ({ ...finding })),
    measurements: result.measurements.map((measurement) => ({ ...measurement })),
  };
  const issues: string[] = [];
  if (!Value.Check(ThreadValidationRecordSchema, record)) {
    issues.push("ThreadValidationRecord does not match ThreadValidationRecordSchema.");
  }
  const hasFailFinding = record.findings.some((finding) => finding.severity === "fail");
  if (record.accepted === hasFailFinding) {
    issues.push("ThreadValidationRecord.accepted must be true exactly when findings contain no fail severity.");
  }
  issues.push(...collectTimestampIssues(record.validatedAt, "ThreadValidationRecord.validatedAt"));
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return record as ThreadValidationRecord;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

export function compareOrdinalStrings(left: string, right: string): number {
  return compareCoreOrdinalStrings(left, right);
}

function snapshotProtocolValue<T>(value: T, path: string): T {
  try {
    return createStrictJsonSnapshot(value);
  } catch (error) {
    if (error instanceof StrictJsonSnapshotError) {
      throw new TweetThreadProtocolValidationError([
        `${path} must be strict accessor-free plain JSON without custom prototypes, toJSON hooks, symbols, sparse arrays, cycles, unsupported primitives, or resource-budget excess.`,
      ]);
    }
    throw error;
  }
}

function serializeCanonicalThreadCandidateSnapshot(
  candidate: ThreadCandidate | ThreadCandidateCanonicalContent,
): string {
  const content = { ...candidate } as UnknownRecord;
  delete content.candidateSha256;
  if (!Value.Check(JCS_JSON_VALUE_SCHEMA, content)) {
    throw new TweetThreadProtocolValidationError([
      "Thread candidate content must contain only finite JSON values and well-formed Unicode before JCS serialization.",
    ]);
  }
  const serialized = canonicalize(content);
  if (serialized === undefined) {
    throw new TweetThreadProtocolValidationError([
      "Thread candidate content could not be serialized as RFC 8785 JCS.",
    ]);
  }
  return serialized;
}

function computeThreadCandidateSnapshotSha256(
  candidate: ThreadCandidate | ThreadCandidateCanonicalContent,
): string {
  return createHash("sha256")
    .update(serializeCanonicalThreadCandidateSnapshot(candidate), "utf8")
    .digest("hex");
}

export function serializeCanonicalThreadCandidate(
  candidate: ThreadCandidate | ThreadCandidateCanonicalContent,
): string {
  const snapshot = snapshotProtocolValue(candidate, "ThreadCandidate");
  return serializeCanonicalThreadCandidateSnapshot(snapshot);
}

export function computeThreadCandidateSha256(
  candidate: ThreadCandidate | ThreadCandidateCanonicalContent,
): string {
  const snapshot = snapshotProtocolValue(candidate, "ThreadCandidate");
  return computeThreadCandidateSnapshotSha256(snapshot);
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

export function containsBannedPhrase(text: string, phrase: string): boolean {
  return containsCoreBannedPhrase(text, phrase);
}

function collectObjectiveWeightIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object with exact objective weight keys.`];
  const issues: string[] = [];
  let hasPositiveWeight = false;
  for (const key of OBJECTIVE_WEIGHT_KEYS) {
    const current = value[key];
    if (typeof current !== "number" || current < 0 || current > 1) {
      issues.push(`${path}.${key} must be a number in 0..1.`);
    } else if (current > 0) {
      hasPositiveWeight = true;
    }
  }
  if (!hasPositiveWeight) {
    issues.push(`${path} must include at least one positive objective weight.`);
  }
  return issues;
}

function collectThreadBriefIssues(value: unknown, path = "ThreadBrief"): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object.`];
  issues.push(...collectNonWhitespaceStringIssues(value.topic, `${path}.topic`));
  issues.push(...collectNonWhitespaceStringIssues(value.audience, `${path}.audience`));
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

function collectTimestampOrderIssues(
  value: unknown,
  bound: unknown,
  valuePath: string,
  boundPath: string,
  order: "at-or-before" | "at-or-after",
): string[] {
  if (typeof value !== "string" || typeof bound !== "string") return [];
  const valueMs = Date.parse(value);
  const boundMs = Date.parse(bound);
  if (!Number.isFinite(valueMs) || !Number.isFinite(boundMs)) return [];
  const valid = order === "at-or-before" ? valueMs <= boundMs : valueMs >= boundMs;
  if (valid) return [];
  const relation = order === "at-or-before" ? "less than or equal to" : "greater than or equal to";
  return [`${valuePath} must be ${relation} ${boundPath}.`];
}

function collectNonWhitespaceStringIssues(value: unknown, path: string): string[] {
  return typeof value === "string" && value.trim().length === 0
    ? [`${path} must contain non-whitespace text.`]
    : [];
}

const MAX_PROTOCOL_ISSUES = 256;
const MAX_ISSUE_VALUE_LENGTH = 128;

function boundedIssueValue(value: string): string {
  return value.length <= MAX_ISSUE_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_ISSUE_VALUE_LENGTH)}…`;
}

function pushDuplicateIssue(seen: Set<string>, next: string, path: string, issues: string[]): void {
  if (seen.has(next)) {
    if (issues.length < MAX_PROTOCOL_ISSUES) {
      issues.push(
        `${path} must be unique; duplicate value "${boundedIssueValue(next)}" found.`,
      );
    }
    return;
  }
  seen.add(next);
}

function collectStableIdIssues(
  values: readonly unknown[],
  property: string,
  path: string,
  issues: string[],
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!isRecord(value) || typeof value[property] !== "string") continue;
    pushDuplicateIssue(seen, value[property], `${path}[${index}].${property}`, issues);
  }
}

type PublishReceiptWithRemoteEvidence = PublishReceipt & {
  publishedAt: string;
  threadUrl: string;
  remotePostIds: string[];
};

function hasKnownRemoteEvidence(receipt: PublishReceipt): receipt is PublishReceiptWithRemoteEvidence {
  return "publishedAt" in receipt && "threadUrl" in receipt && "remotePostIds" in receipt;
}

function latestApprovalAtOrBefore(
  approvals: readonly ApprovalRecord[],
  candidateSha256: string,
  attemptedAt: string,
): ApprovalRecord | undefined {
  const attemptedAtMs = Date.parse(attemptedAt);
  let latest: ApprovalRecord | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const approval of approvals) {
    if (approval.candidateSha256 !== candidateSha256) continue;
    const decidedAtMs = Date.parse(approval.decidedAt);
    if (decidedAtMs > attemptedAtMs || decidedAtMs < latestMs) continue;
    latest = approval;
    latestMs = decidedAtMs;
  }
  return latest;
}

function collectThreadCandidateIssues(
  value: unknown,
  path = "ThreadCandidate",
  includeDeterministicFailures = false,
): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object.`];
  issues.push(...collectThreadBriefIssues(value.brief, `${path}.brief`));
  const matchesCandidateSchema = Value.Check(ThreadCandidateSchema, value);
  if (!matchesCandidateSchema) {
    issues.push(`${path} does not match ThreadCandidateSchema.`);
  }
  issues.push(...collectTimestampIssues(value.generatedAt, `${path}.generatedAt`));
  if (
    matchesCandidateSchema
    && typeof value.candidateSha256 === "string"
    && SHA256_HEX.test(value.candidateSha256)
  ) {
    try {
      const computedSha256 = computeThreadCandidateSnapshotSha256(value as ThreadCandidate);
      if (computedSha256 !== value.candidateSha256) {
        issues.push(
          `${path}.candidateSha256 must equal the SHA-256 of canonical candidate content; expected "${computedSha256}".`,
        );
      }
    } catch {
      issues.push(`${path} must be serializable as canonical JSON before candidateSha256 can be verified.`);
    }
  }
  if (!isRecord(value.brief) || !Array.isArray(value.evidence) || !Array.isArray(value.posts)) return issues;
  if (isRecord(value.voiceProfile)) {
    issues.push(...collectNonWhitespaceStringIssues(value.voiceProfile.displayName, `${path}.voiceProfile.displayName`));
    issues.push(...collectNonWhitespaceStringIssues(value.voiceProfile.tone, `${path}.voiceProfile.tone`));
  }

  const evidenceClaimIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const [index, item] of value.evidence.entries()) {
    if (!isRecord(item)) continue;
    issues.push(...collectTimestampIssues(item.retrievedAt, `${path}.evidence[${index}].retrievedAt`));
    issues.push(...collectTimestampOrderIssues(
      item.retrievedAt,
      value.generatedAt,
      `${path}.evidence[${index}].retrievedAt`,
      `${path}.generatedAt`,
      "at-or-before",
    ));
    issues.push(...collectNonWhitespaceStringIssues(item.summary, `${path}.evidence[${index}].summary`));
    issues.push(...collectNonWhitespaceStringIssues(item.sourceLabel, `${path}.evidence[${index}].sourceLabel`));
    if (typeof item.evidenceId === "string") {
      pushDuplicateIssue(evidenceIds, item.evidenceId, `${path}.evidence[${index}].evidenceId`, issues);
    }
    if (typeof item.claimId === "string") {
      pushDuplicateIssue(evidenceClaimIds, item.claimId, `${path}.evidence[${index}].claimId`, issues);
    }
  }

  const postIds = new Set<string>();
  for (const [index, post] of value.posts.entries()) {
    if (!isRecord(post)) continue;
    issues.push(...collectNonWhitespaceStringIssues(post.text, `${path}.posts[${index}].text`));
    if (typeof post.postId === "string") {
      pushDuplicateIssue(postIds, post.postId, `${path}.posts[${index}].postId`, issues);
    }
    if (Array.isArray(post.media)) {
      for (const [mediaIndex, media] of post.media.entries()) {
        if (!isRecord(media)) continue;
        issues.push(...collectNonWhitespaceStringIssues(
          media.description,
          `${path}.posts[${index}].media[${mediaIndex}].description`,
        ));
      }
    }
  }

  if (includeDeterministicFailures) {
    const postIndexById = new Map(
      value.posts.flatMap((post, index) =>
        isRecord(post) && typeof post.postId === "string"
          ? [[post.postId, index] as const]
          : []
      ),
    );
    for (const finding of validateThreadCandidateCore(value).findings) {
      if (finding.severity !== "fail") continue;
      const postIndex = finding.postId === undefined
        ? undefined
        : postIndexById.get(finding.postId);
      const findingPath = postIndex === undefined ? path : `${path}.posts[${postIndex}]`;
      issues.push(
        `${findingPath} deterministic validation failed (${finding.code}): ${finding.message}`,
      );
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

function candidateReferencesFromValidation(
  validation: ThreadValidationRecord,
  candidate: ThreadCandidate,
  path: string,
): string[] {
  const issues: string[] = [];
  const postIds = new Set(candidate.posts.map((post) => post.postId));
  const claimIds = new Set(candidate.evidence.map((item) => item.claimId));
  const measuredPostIds = new Set<string>();
  for (const [index, measurement] of validation.measurements.entries()) {
    if (!postIds.has(measurement.postId)) {
      issues.push(`${path}.measurements[${index}].postId references missing post "${measurement.postId}".`);
    }
    pushDuplicateIssue(
      measuredPostIds,
      measurement.postId,
      `${path}.measurements[${index}].postId`,
      issues,
    );
  }
  for (const postId of postIds) {
    if (!measuredPostIds.has(postId)) {
      issues.push(`${path}.measurements must include candidate post "${postId}".`);
    }
  }
  for (const [index, finding] of validation.findings.entries()) {
    if (finding.postId && !postIds.has(finding.postId)) {
      issues.push(`${path}.findings[${index}].postId references missing post "${finding.postId}".`);
    }
    if (finding.claimId && !claimIds.has(finding.claimId)) {
      issues.push(`${path}.findings[${index}].claimId references missing claim "${finding.claimId}".`);
    }
  }
  return issues;
}

function scorecardHasFailFinding(scorecard: ThreadScorecard): boolean {
  return Object.values(scorecard.dimensions).some((dimension) =>
    dimension.findings.some((finding) => finding.severity === "fail")
  );
}

function collectGateEvidenceIssues(
  manifest: ThreadRunManifest,
  candidateSha256: string,
  boundaryAt: string,
  boundaryPath: string,
  boundaryKind: "approved" | "publication",
): string[] {
  const issues: string[] = [];
  const validations = manifest.validations
    .map((validation, index) => ({ validation, index }))
    .filter(({ validation }) => validation.candidateSha256 === candidateSha256);
  if (validations.length !== 1) {
    issues.push(
      `${boundaryPath} for an ${boundaryKind === "approved" ? "approved" : "publishing"} candidate requires exactly one current validation record.`,
    );
  } else {
    const [{ validation, index }] = validations;
    if (
      validation.accepted !== true
      || validation.findings.some((finding) => finding.severity === "fail")
    ) {
      issues.push(`${boundaryPath} requires an accepted validation record with no fail finding.`);
    }
    if (Date.parse(boundaryAt) < Date.parse(validation.validatedAt)) {
      issues.push(
        `${boundaryPath}.${boundaryKind === "approved" ? "decidedAt" : "attemptedAt"} must be greater than or equal to ThreadRunManifest.validations[${index}].validatedAt.`,
      );
    }
  }

  const boundScorecards = manifest.scorecards
    .map((scorecard, index) => ({ scorecard, index }))
    .filter(({ scorecard }) => scorecard.candidateSha256 === candidateSha256);
  const boundaryAtMs = Date.parse(boundaryAt);
  let current: (typeof boundScorecards)[number] | undefined;
  let currentMs = Number.NEGATIVE_INFINITY;
  for (const entry of boundScorecards) {
    const scoredAtMs = Date.parse(entry.scorecard.scoredAt);
    if (scoredAtMs > boundaryAtMs || scoredAtMs < currentMs) continue;
    current = entry;
    currentMs = scoredAtMs;
  }
  if (!current) {
    const later = boundScorecards.find(({ scorecard }) =>
      Date.parse(scorecard.scoredAt) > boundaryAtMs
    );
    if (later) {
      issues.push(
        `${boundaryPath}.${boundaryKind === "approved" ? "decidedAt" : "attemptedAt"} must be greater than or equal to ThreadRunManifest.scorecards[${later.index}].scoredAt.`,
      );
    } else {
      issues.push(
        `${boundaryPath} for an ${boundaryKind === "approved" ? "approved" : "publishing"} candidate requires at least one bound scorecard with no fail finding.`,
      );
    }
  } else if (scorecardHasFailFinding(current.scorecard)) {
    issues.push(
      `${boundaryPath} for an ${boundaryKind === "approved" ? "approved" : "publishing"} candidate requires the current bound scorecard at or before the boundary to have no fail finding.`,
    );
  }
  return issues;
}

export function normalizeThreadBrief(input: unknown): ThreadBrief {
  const source = snapshotProtocolValue(input, "ThreadBrief");
  if (!isRecord(source)) {
    throw new TweetThreadProtocolValidationError(["ThreadBrief must be an object."]);
  }
  const normalized: UnknownRecord = { ...source };
  normalized.protocolVersion = trimIfString(source.protocolVersion);
  normalized.briefId = trimIfString(source.briefId);
  normalized.topic = trimIfString(source.topic);
  normalized.audience = trimIfString(source.audience);
  if (Object.hasOwn(source, "notes")) normalized.notes = trimIfString(source.notes);
  if (isRecord(source.objectiveWeights)) {
    normalized.objectiveWeights = { ...source.objectiveWeights };
  }
  if (isRecord(source.constraints)) {
    normalized.constraints = { ...source.constraints };
    (normalized.constraints as UnknownRecord).requiredClaimIds =
      dedupeTrimmedList(source.constraints.requiredClaimIds);
    (normalized.constraints as UnknownRecord).bannedPhrases =
      dedupeTrimmedList(source.constraints.bannedPhrases);
  }

  const issues = collectThreadBriefIssues(normalized);
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return normalized as ThreadBrief;
}

export function assertValidThreadCandidate(input: unknown): ThreadCandidate {
  const snapshot = snapshotProtocolValue(input, "ThreadCandidate");
  const issues = collectThreadCandidateIssues(snapshot, "ThreadCandidate", true);
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return snapshot as ThreadCandidate;
}

export function inspectThreadCandidateForValidation(input: unknown): {
  snapshot: unknown;
  issues: string[];
} {
  const snapshot = snapshotProtocolValue(input, "ThreadCandidate");
  return {
    snapshot,
    issues: collectThreadCandidateIssues(snapshot),
  };
}

export function assertValidThreadRunManifest(input: unknown): ThreadRunManifest {
  const issues: string[] = [];
  const snapshot = snapshotProtocolValue(input, "ThreadRunManifest");
  if (!isRecord(snapshot)) {
    throw new TweetThreadProtocolValidationError(["ThreadRunManifest must be an object."]);
  }
  if (!Value.Check(ThreadRunManifestSchema, snapshot)) {
    issues.push("ThreadRunManifest does not match ThreadRunManifestSchema.");
  }
  issues.push(...collectTimestampIssues(snapshot.createdAt, "ThreadRunManifest.createdAt"));
  issues.push(...collectThreadBriefIssues(snapshot.brief, "ThreadRunManifest.brief"));
  if (!Array.isArray(snapshot.candidates)) {
    issues.push("ThreadRunManifest.candidates must be an array.");
  } else {
    for (const [index, candidate] of snapshot.candidates.entries()) {
      issues.push(...collectThreadCandidateIssues(candidate, `ThreadRunManifest.candidates[${index}]`));
    }
  }
  if (Array.isArray(snapshot.scorecards)) {
    for (const [index, scorecard] of snapshot.scorecards.entries()) {
      if (isRecord(scorecard)) {
        issues.push(...collectTimestampIssues(scorecard.scoredAt, `ThreadRunManifest.scorecards[${index}].scoredAt`));
      }
    }
    if (Array.isArray(snapshot.validations)) {
      for (const [index, validation] of snapshot.validations.entries()) {
        if (isRecord(validation)) {
          issues.push(...collectTimestampIssues(
            validation.validatedAt,
            `ThreadRunManifest.validations[${index}].validatedAt`,
          ));
        }
      }
    }
  }
  if (Array.isArray(snapshot.approvals)) {
    for (const [index, approval] of snapshot.approvals.entries()) {
      if (isRecord(approval)) {
        issues.push(...collectTimestampIssues(approval.decidedAt, `ThreadRunManifest.approvals[${index}].decidedAt`));
        issues.push(...collectNonWhitespaceStringIssues(
          approval.actor,
          `ThreadRunManifest.approvals[${index}].actor`,
        ));
      }
    }
  }
  if (Array.isArray(snapshot.publishReceipts)) {
    for (const [index, receipt] of snapshot.publishReceipts.entries()) {
      if (!isRecord(receipt)) continue;
      issues.push(...collectTimestampIssues(receipt.attemptedAt, `ThreadRunManifest.publishReceipts[${index}].attemptedAt`));
      issues.push(...collectTimestampIssues(receipt.publishedAt, `ThreadRunManifest.publishReceipts[${index}].publishedAt`));
    }
  }
  if (Array.isArray(snapshot.observations)) {
    for (const [index, observation] of snapshot.observations.entries()) {
      if (!isRecord(observation)) continue;
      issues.push(...collectTimestampIssues(observation.retrievedAt, `ThreadRunManifest.observations[${index}].retrievedAt`));
      issues.push(...collectTimestampIssues(observation.exposedAt, `ThreadRunManifest.observations[${index}].exposedAt`));
    }
  }
  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);

  const manifest = snapshot as ThreadRunManifest;
  collectStableIdIssues(manifest.candidates, "candidateId", "ThreadRunManifest.candidates", issues);
  collectStableIdIssues(manifest.validations, "validationId", "ThreadRunManifest.validations", issues);
  collectStableIdIssues(manifest.scorecards, "scorecardId", "ThreadRunManifest.scorecards", issues);
  collectStableIdIssues(manifest.approvals, "approvalId", "ThreadRunManifest.approvals", issues);
  collectStableIdIssues(manifest.publishReceipts, "receiptId", "ThreadRunManifest.publishReceipts", issues);
  collectStableIdIssues(manifest.observations, "observationId", "ThreadRunManifest.observations", issues);

  const validationFindingIds = new Set<string>();
  for (const [validationIndex, validation] of manifest.validations.entries()) {
    for (const [findingIndex, finding] of validation.findings.entries()) {
      pushDuplicateIssue(
        validationFindingIds,
        finding.findingId,
        `ThreadRunManifest.validations[${validationIndex}].findings[${findingIndex}].findingId`,
        issues,
      );
    }
  }
  const scorecardFindingIds = new Set<string>();
  for (const [scorecardIndex, scorecard] of manifest.scorecards.entries()) {
    for (const [dimensionName, dimension] of Object.entries(scorecard.dimensions)) {
      for (const [findingIndex, finding] of dimension.findings.entries()) {
        pushDuplicateIssue(
          scorecardFindingIds,
          finding.findingId,
          `ThreadRunManifest.scorecards[${scorecardIndex}].dimensions.${dimensionName}.findings[${findingIndex}].findingId`,
          issues,
        );
      }
    }
  }

  const candidateBySha = new Map<string, ThreadCandidate>();
  for (const [index, candidate] of manifest.candidates.entries()) {
    if (!canonicalJsonEqual(candidate.brief, manifest.brief)) {
      issues.push(`ThreadRunManifest.candidates[${index}].brief must equal ThreadRunManifest.brief.`);
    }
    if (!canonicalJsonEqual(candidate.voiceProfile, manifest.voiceProfile)) {
      issues.push(`ThreadRunManifest.candidates[${index}].voiceProfile must equal ThreadRunManifest.voiceProfile.`);
    }
    if (candidateBySha.has(candidate.candidateSha256)) {
      issues.push(`ThreadRunManifest.candidates must have unique candidateSha256 values; duplicate "${candidate.candidateSha256}" found.`);
      continue;
    }
    candidateBySha.set(candidate.candidateSha256, candidate);
  }

  for (const [index, validation] of manifest.validations.entries()) {
    const validationPath = `ThreadRunManifest.validations[${index}]`;
    const hasFailFinding = validation.findings.some((finding) => finding.severity === "fail");
    if (validation.accepted === hasFailFinding) {
      issues.push(`${validationPath}.accepted must be true exactly when findings contain no fail severity.`);
    }
    const candidate = candidateBySha.get(validation.candidateSha256);
    if (!candidate) {
      issues.push(`${validationPath} candidate sha "${validation.candidateSha256}" does not match any candidate.`);
      continue;
    }
    const candidateIndex = manifest.candidates.indexOf(candidate);
    issues.push(...collectTimestampOrderIssues(
      validation.validatedAt,
      candidate.generatedAt,
      `${validationPath}.validatedAt`,
      `ThreadRunManifest.candidates[${candidateIndex}].generatedAt`,
      "at-or-after",
    ));
    issues.push(...candidateReferencesFromValidation(validation, candidate, validationPath));
    const recomputed = validateThreadCandidateCore(candidate);
    if (!canonicalJsonEqual(
      {
        accepted: validation.accepted,
        findings: validation.findings,
        measurements: validation.measurements,
      },
      {
        accepted: recomputed.accepted,
        findings: recomputed.findings,
        measurements: recomputed.measurements,
      },
    )) {
      issues.push(
        `${validationPath} accepted, findings, and measurements must exactly match recomputed deterministic validation evidence.`,
      );
    }
  }

  for (const [index, scorecard] of manifest.scorecards.entries()) {
    const candidate = candidateBySha.get(scorecard.candidateSha256);
    if (!candidate) {
      issues.push(`ThreadRunManifest.scorecards[${index}] candidate sha "${scorecard.candidateSha256}" does not match any candidate.`);
      continue;
    }
    const candidateIndex = manifest.candidates.indexOf(candidate);
    issues.push(...collectTimestampOrderIssues(
      scorecard.scoredAt,
      candidate.generatedAt,
      `ThreadRunManifest.scorecards[${index}].scoredAt`,
      `ThreadRunManifest.candidates[${candidateIndex}].generatedAt`,
      "at-or-after",
    ));
    issues.push(...candidateReferencesFromScorecard(scorecard, candidate, `ThreadRunManifest.scorecards[${index}]`));
  }

  for (const [index, approval] of manifest.approvals.entries()) {
    const candidate = candidateBySha.get(approval.candidateSha256);
    if (!candidate) {
      issues.push(`ThreadRunManifest.approvals[${index}] candidate sha "${approval.candidateSha256}" does not match any candidate.`);
      continue;
    }
    if (Date.parse(approval.decidedAt) < Date.parse(candidate.generatedAt)) {
      const candidateIndex = manifest.candidates.indexOf(candidate);
      issues.push(
        `ThreadRunManifest.approvals[${index}].decidedAt must be greater than or equal to ThreadRunManifest.candidates[${candidateIndex}].generatedAt.`,
      );
    }
    if (approval.decision === "approved") {
      issues.push(...collectGateEvidenceIssues(
        manifest,
        approval.candidateSha256,
        approval.decidedAt,
        `ThreadRunManifest.approvals[${index}]`,
        "approved",
      ));
    }
  }

  const receiptById = new Map<string, PublishReceipt>();
  for (const [index, receipt] of manifest.publishReceipts.entries()) {
    if (!receiptById.has(receipt.receiptId)) receiptById.set(receipt.receiptId, receipt);
    const candidate = candidateBySha.get(receipt.candidateSha256);
    if (!candidate) {
      issues.push(`ThreadRunManifest.publishReceipts[${index}] candidate sha "${receipt.candidateSha256}" does not match any candidate.`);
      continue;
    }
    const receiptPath = `ThreadRunManifest.publishReceipts[${index}]`;
    if (Date.parse(receipt.attemptedAt) < Date.parse(candidate.generatedAt)) {
      const candidateIndex = manifest.candidates.indexOf(candidate);
      issues.push(
        `${receiptPath}.attemptedAt must be greater than or equal to ThreadRunManifest.candidates[${candidateIndex}].generatedAt.`,
      );
    }
    const latestApproval = latestApprovalAtOrBefore(
      manifest.approvals,
      receipt.candidateSha256,
      receipt.attemptedAt,
    );
    if (latestApproval?.decision !== "approved") {
      issues.push(`${receiptPath} requires the candidate's latest approval at or before attemptedAt to be approved.`);
    }
    issues.push(...collectGateEvidenceIssues(
      manifest,
      receipt.candidateSha256,
      receipt.attemptedAt,
      receiptPath,
      "publication",
    ));
    if (hasKnownRemoteEvidence(receipt)) {
      const threadStatusId = receipt.threadUrl.slice(receipt.threadUrl.lastIndexOf("/") + 1);
      if (threadStatusId !== receipt.remotePostIds[0]) {
        issues.push(`${receiptPath}.threadUrl status ID must equal ${receiptPath}.remotePostIds[0].`);
      }
      if (Date.parse(receipt.publishedAt) < Date.parse(receipt.attemptedAt)) {
        issues.push(`${receiptPath}.publishedAt must be greater than or equal to ${receiptPath}.attemptedAt.`);
      }
      if (receipt.status === "published" && receipt.remotePostIds.length !== candidate.posts.length) {
        issues.push(`${receiptPath}.remotePostIds count must equal the associated candidate posts count for a published receipt.`);
      }
      if (
        (receipt.status === "partial" || receipt.status === "uncertain")
        && receipt.remotePostIds.length >= candidate.posts.length
      ) {
        issues.push(`${receiptPath}.remotePostIds count must be less than the associated candidate posts count for a ${receipt.status} receipt.`);
      }
    }
  }

  for (const [index, observation] of manifest.observations.entries()) {
    const observationPath = `ThreadRunManifest.observations[${index}]`;
    if (!candidateBySha.has(observation.candidateSha256)) {
      issues.push(`${observationPath} candidate sha "${observation.candidateSha256}" does not match any candidate.`);
    }

    const presentMetrics = new Set(
      THREAD_OBSERVATION_METRIC_NAMES.filter((metric) => observation.metrics[metric] !== undefined),
    );
    const missingMetricReasons = new Set<ThreadObservationMetricName>();
    for (const [reasonIndex, missingReason] of observation.missingMetricReasons.entries()) {
      const reasonPath = `${observationPath}.missingMetricReasons[${reasonIndex}].metric`;
      if (missingMetricReasons.has(missingReason.metric)) {
        issues.push(`${reasonPath} must be unique; duplicate value "${missingReason.metric}" found.`);
        continue;
      }
      missingMetricReasons.add(missingReason.metric);
      if (presentMetrics.has(missingReason.metric)) {
        issues.push(`${reasonPath} must name an unavailable metric, but "${missingReason.metric}" is present.`);
      }
    }
    for (const metric of THREAD_OBSERVATION_METRIC_NAMES) {
      if (!presentMetrics.has(metric) && !missingMetricReasons.has(metric)) {
        issues.push(`${observationPath}.missingMetricReasons must include unavailable metric "${metric}".`);
      }
    }
    if (presentMetrics.size === 0 && missingMetricReasons.size === 0) {
      issues.push(`${observationPath} must include at least one value in metrics or one missingMetricReasons entry.`);
    }

    if (Date.parse(observation.retrievedAt) < Date.parse(observation.exposedAt)) {
      issues.push(`${observationPath}.retrievedAt must be greater than or equal to ${observationPath}.exposedAt.`);
    }

    const receipt = receiptById.get(observation.publishReceiptId);
    if (!receipt) {
      issues.push(`${observationPath}.publishReceiptId references missing receipt "${observation.publishReceiptId}".`);
      continue;
    }
    if (receipt.candidateSha256 !== observation.candidateSha256) {
      issues.push(`${observationPath}.publishReceiptId references a receipt whose candidateSha256 does not match the observation.`);
    }
    if (!hasKnownRemoteEvidence(receipt)) {
      issues.push(`${observationPath}.publishReceiptId must reference a published, partial, or uncertain receipt with known remote evidence.`);
      continue;
    }
    if (Date.parse(observation.exposedAt) < Date.parse(receipt.publishedAt)) {
      const receiptIndex = manifest.publishReceipts.indexOf(receipt);
      issues.push(
        `${observationPath}.exposedAt must be greater than or equal to ThreadRunManifest.publishReceipts[${receiptIndex}].publishedAt.`,
      );
    }
  }

  if (issues.length > 0) throw new TweetThreadProtocolValidationError(issues);
  return manifest;
}
