import { containsSecretText } from "./secret-redaction.ts";

export const AGENTIC_SURFACES = ["board", "research", "chat"] as const;
export type AgenticSurface = (typeof AGENTIC_SURFACES)[number];

export const AGENTIC_EVIDENCE_KINDS = [
  "task",
  "dependency",
  "github",
  "mission",
  "saved-link",
  "vault",
  "message",
  "artifact",
] as const;
export type AgenticEvidenceKind = (typeof AGENTIC_EVIDENCE_KINDS)[number];

export const AGENTIC_RECOMMENDATION_KINDS = [
  "canonicalize-reference",
  "deduplicate-reference",
  "identifier-normalization",
  "recompute-readonly-projection",
  "prose",
  "dependency",
  "topic",
  "action",
] as const;
export type AgenticRecommendationKind = (typeof AGENTIC_RECOMMENDATION_KINDS)[number];

export const AUTO_APPLY_RECOMMENDATION_KINDS = [
  "canonicalize-reference",
  "deduplicate-reference",
  "identifier-normalization",
  "recompute-readonly-projection",
] as const;
export type AutoApplyRecommendationKind = (typeof AUTO_APPLY_RECOMMENDATION_KINDS)[number];

export type AgenticApplyMode = "auto-apply" | "review";
export type AgenticVerificationStatus = "verified" | "proposal" | "blocked";
export type AgenticVerificationCheckState = "passed" | "pending" | "failed";

export type AgenticJsonValue =
  | string
  | number
  | boolean
  | null
  | AgenticJsonValue[]
  | { [key: string]: AgenticJsonValue };
export type AgenticPayload = { [key: string]: AgenticJsonValue };

export type CanonicalizeReferencePayload = {
  referenceId: string;
  canonicalUrl: string;
};

export type DeduplicateReferencePayload = {
  duplicateReferenceId: string;
  canonicalReferenceId: string;
};

export type IdentifierNormalizationPayload = {
  entityId: string;
  normalizedIdentifier: string;
};

export type RecomputeReadonlyProjectionPayload = {
  entityId: string;
  projection: "dependency-summary" | "reference-summary" | "status-summary";
};

export type AutoApplyPayload =
  | CanonicalizeReferencePayload
  | DeduplicateReferencePayload
  | IdentifierNormalizationPayload
  | RecomputeReadonlyProjectionPayload;

export type AgenticEvidenceRef = {
  id: string;
  kind: AgenticEvidenceKind;
  label: string;
};

export type AgenticVerificationCheck = {
  id: string;
  state: AgenticVerificationCheckState;
  detail: string;
};

/** Mechanical facts supplied by a trusted surface adapter, never model output. */
export type AgenticAdapterVerificationCheck = AgenticVerificationCheck;

export type AgenticVerification = {
  status: AgenticVerificationStatus;
  checks: AgenticVerificationCheck[];
};

export type AgenticApplication = {
  mode: AgenticApplyMode;
  requiresApproval: boolean;
  reversible: boolean;
};

export type AgenticRecommendation<TPayload extends AgenticPayload = AgenticPayload> = {
  id: string;
  surface: AgenticSurface;
  kind: AgenticRecommendationKind;
  payload: TPayload;
  rationale: string;
  inferredGoal: string;
  rankReasons: string[];
  evidenceRefs: AgenticEvidenceRef[];
  contextFingerprint: string;
  verification: AgenticVerification;
  application: AgenticApplication;
};

export type RankedAgenticRecommendation<TPayload extends AgenticPayload = AgenticPayload> =
  AgenticRecommendation<TPayload> & { ordinal: number };

export type AgenticRecommendationParseErrorCode =
  | "output_too_large"
  | "invalid_envelope"
  | "invalid_json"
  | "invalid_recommendations"
  | "too_many_recommendations"
  | "invalid_recommendation"
  | "invalid_id"
  | "duplicate_id"
  | "unknown_surface"
  | "kind_too_long"
  | "unknown_kind"
  | "invalid_payload"
  | "invalid_evidence"
  | "secret_evidence"
  | "invalid_verification"
  | "invalid_verified_checks"
  | "invalid_application"
  | "auto_apply_forbidden";

export class AgenticRecommendationParseError extends Error {
  readonly code: AgenticRecommendationParseErrorCode;

  constructor(code: AgenticRecommendationParseErrorCode) {
    super(`agentic recommendation output rejected: ${code}`);
    this.name = "AgenticRecommendationParseError";
    this.code = code;
  }
}

const RECOMMENDATIONS_TAG = "recommendations";
const MAX_MODEL_OUTPUT_CHARS = 64 * 1024;
const MAX_RECOMMENDATIONS = 16;
const MAX_KIND_CHARS = 64;
const MAX_ID_CHARS = 96;
const MAX_TEXT_CHARS = 2_000;
const MAX_RANK_REASONS = 8;
const MAX_EVIDENCE_REFS = 16;
const MAX_ADAPTER_VERIFICATION_CHECKS = 16;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_PAYLOAD_DEPTH = 12;
const MAX_PAYLOAD_ENTRIES = 128;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_CONTEXT_DEPTH = 16;
const MAX_CONTEXT_ENTRIES = 256;
const MAX_VERIFICATION_STAMP_BYTES = 96 * 1024;
const ID_RE = /^[A-Za-z][A-Za-z0-9._:/-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const GITHUB_ISSUE_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*#[1-9][0-9]*$/;
const FINGERPRINT_RE = /^ctx-v1-[0-9a-f]{32}$/;
const agenticSurfaces = new Set<string>(AGENTIC_SURFACES);
const evidenceKinds = new Set<string>(AGENTIC_EVIDENCE_KINDS);
const recommendationKinds = new Set<string>(AGENTIC_RECOMMENDATION_KINDS);
const autoApplyKinds = new Set<string>(AUTO_APPLY_RECOMMENDATION_KINDS);
const READONLY_PROJECTIONS = new Set<RecomputeReadonlyProjectionPayload["projection"]>([
  "dependency-summary",
  "reference-summary",
  "status-summary",
]);
const trustedVerifiedRecommendationStamps = new WeakMap<object, string>();

type RawRecord = Record<string, unknown>;

function parseError(code: AgenticRecommendationParseErrorCode): never {
  throw new AgenticRecommendationParseError(code);
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isPlainObject(value);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: RawRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isBoundedString(value: unknown, max = MAX_TEXT_CHARS): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isValidId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_CHARS) && ID_RE.test(value);
}

function isGitOid(value: unknown): value is string {
  return typeof value === "string" && GIT_OID_RE.test(value);
}

function isValidEvidenceId(value: unknown, kind: AgenticEvidenceKind): value is string {
  return (
    isValidId(value)
    || (typeof value === "string" && UUID_RE.test(value))
    || isGitOid(value)
    || (kind === "github" && typeof value === "string" && GITHUB_ISSUE_REFERENCE_RE.test(value))
  );
}

function asSurface(value: unknown): AgenticSurface {
  if (typeof value !== "string" || !agenticSurfaces.has(value)) parseError("unknown_surface");
  return value as AgenticSurface;
}

function asKind(value: unknown): AgenticRecommendationKind {
  if (typeof value !== "string") parseError("unknown_kind");
  if (value.length > MAX_KIND_CHARS) parseError("kind_too_long");
  if (!recommendationKinds.has(value)) parseError("unknown_kind");
  return value as AgenticRecommendationKind;
}

function asEvidenceKind(value: unknown): AgenticEvidenceKind {
  if (typeof value !== "string" || !evidenceKinds.has(value)) parseError("invalid_evidence");
  return value as AgenticEvidenceKind;
}

function parsePayload(kind: AgenticRecommendationKind, value: unknown): AgenticPayload {
  if (!isRecord(value) || !isBoundedJsonValue(value, MAX_PAYLOAD_DEPTH, { entries: 0 })) {
    parseError("invalid_payload");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    parseError("invalid_payload");
  }
  if (utf8ByteLength(serialized) > MAX_PAYLOAD_BYTES) parseError("invalid_payload");
  if (!autoApplyKinds.has(kind)) return value as AgenticPayload;
  return parseAutoApplyPayload(kind as AutoApplyRecommendationKind, value);
}

function parseAutoApplyPayload(
  kind: AutoApplyRecommendationKind,
  value: RawRecord,
): AutoApplyPayload {
  switch (kind) {
    case "canonicalize-reference":
      if (
        !hasExactKeys(value, ["referenceId", "canonicalUrl"])
        || !isValidId(value.referenceId)
        || !isCanonicalUrl(value.canonicalUrl)
      ) parseError("invalid_payload");
      return { referenceId: value.referenceId, canonicalUrl: value.canonicalUrl };
    case "deduplicate-reference":
      if (
        !hasExactKeys(value, ["duplicateReferenceId", "canonicalReferenceId"])
        || !isValidId(value.duplicateReferenceId)
        || !isValidId(value.canonicalReferenceId)
        || value.duplicateReferenceId === value.canonicalReferenceId
      ) parseError("invalid_payload");
      return {
        duplicateReferenceId: value.duplicateReferenceId,
        canonicalReferenceId: value.canonicalReferenceId,
      };
    case "identifier-normalization":
      if (
        !hasExactKeys(value, ["entityId", "normalizedIdentifier"])
        || !isValidId(value.entityId)
        || !isValidId(value.normalizedIdentifier)
        || value.normalizedIdentifier !== value.normalizedIdentifier.toLowerCase()
      ) parseError("invalid_payload");
      return { entityId: value.entityId, normalizedIdentifier: value.normalizedIdentifier };
    case "recompute-readonly-projection":
      if (
        !hasExactKeys(value, ["entityId", "projection"])
        || !isValidId(value.entityId)
        || typeof value.projection !== "string"
        || !READONLY_PROJECTIONS.has(value.projection as RecomputeReadonlyProjectionPayload["projection"])
      ) parseError("invalid_payload");
      return {
        entityId: value.entityId,
        projection: value.projection as RecomputeReadonlyProjectionPayload["projection"],
      };
  }
}

function isCanonicalUrl(value: unknown): value is string {
  if (!isBoundedString(value, MAX_TEXT_CHARS)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === ""
      && url.hash === ""
      && url.href === value
    );
  } catch {
    return false;
  }
}

function isAutoApplyPayload(
  kind: AgenticRecommendationKind,
  payload: unknown,
): payload is AutoApplyPayload {
  if (!autoApplyKinds.has(kind) || !isRecord(payload)) return false;
  try {
    parseAutoApplyPayload(kind as AutoApplyRecommendationKind, payload);
    return true;
  } catch {
    return false;
  }
}

function isBoundedJsonValue(
  value: unknown,
  depth: number,
  budget: { entries: number },
): value is AgenticJsonValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_TEXT_CHARS;
  if (depth <= 0 || !Array.isArray(value) && !isRecord(value)) return false;

  const entries = Array.isArray(value) ? value : Object.values(value);
  if (entries.length > MAX_PAYLOAD_ENTRIES - budget.entries) return false;
  budget.entries += entries.length;
  return entries.every((entry) => isBoundedJsonValue(entry, depth - 1, budget));
}

function parseEvidenceRefs(value: unknown): AgenticEvidenceRef[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) parseError("invalid_evidence");
  return value.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["id", "kind", "label"])) parseError("invalid_evidence");
    const kind = asEvidenceKind(entry.kind);
    if (!isValidEvidenceId(entry.id, kind) || !isBoundedString(entry.label)) parseError("invalid_evidence");
    if (containsSecretText(entry.id) || containsSecretText(entry.label)) {
      parseError("secret_evidence");
    }
    return { id: entry.id, kind, label: entry.label };
  });
}

function hasPassedVerificationChecks(verification: Pick<AgenticVerification, "status" | "checks">): boolean {
  return (
    verification.status === "verified"
    && verification.checks.length > 0
    && verification.checks.every((check) => check.state === "passed")
  );
}

function verificationStampDigest(
  recommendation: AgenticRecommendation | RankedAgenticRecommendation,
): string | undefined {
  const values: Record<string, unknown> = {
    id: recommendation.id,
    surface: recommendation.surface,
    kind: recommendation.kind,
    payload: recommendation.payload,
    evidenceRefs: recommendation.evidenceRefs,
    contextFingerprint: recommendation.contextFingerprint,
    verification: recommendation.verification,
    application: recommendation.application,
  };
  if ("ordinal" in recommendation) values.ordinal = recommendation.ordinal;

  try {
    const writer: CanonicalWriter = { parts: [], bytes: 0, maxBytes: MAX_VERIFICATION_STAMP_BYTES };
    canonicalJson(values, MAX_CONTEXT_DEPTH, new Set(), { entries: 0 }, writer);
    return writer.parts.join("");
  } catch {
    return undefined;
  }
}

function stampTrustedVerifiedRecommendation(
  recommendation: AgenticRecommendation | RankedAgenticRecommendation,
): void {
  const digest = verificationStampDigest(recommendation);
  if (digest !== undefined) trustedVerifiedRecommendationStamps.set(recommendation, digest);
}

function hasTrustedVerificationStamp(
  recommendation: AgenticRecommendation | RankedAgenticRecommendation,
): boolean {
  const stampedDigest = trustedVerifiedRecommendationStamps.get(recommendation);
  return stampedDigest !== undefined && stampedDigest === verificationStampDigest(recommendation);
}

function parseRecommendation(value: unknown): AgenticRecommendation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "surface",
      "kind",
      "payload",
      "rationale",
      "inferredGoal",
      "rankReasons",
      "evidenceRefs",
      "contextFingerprint",
    ])
  ) {
    parseError("invalid_recommendation");
  }
  if (!isValidId(value.id)) parseError("invalid_id");
  if (
    !isBoundedString(value.rationale) ||
    !isBoundedString(value.inferredGoal) ||
    !Array.isArray(value.rankReasons) ||
    value.rankReasons.length > MAX_RANK_REASONS ||
    !value.rankReasons.every((reason) => isBoundedString(reason)) ||
    typeof value.contextFingerprint !== "string" ||
    !FINGERPRINT_RE.test(value.contextFingerprint)
  ) {
    parseError("invalid_recommendation");
  }
  const kind = asKind(value.kind);

  const recommendation: AgenticRecommendation = {
    id: value.id,
    surface: asSurface(value.surface),
    kind,
    payload: parsePayload(kind, value.payload),
    rationale: value.rationale,
    inferredGoal: value.inferredGoal,
    rankReasons: [...value.rankReasons],
    evidenceRefs: parseEvidenceRefs(value.evidenceRefs),
    contextFingerprint: value.contextFingerprint,
    verification: { status: "proposal", checks: [] },
    application: { mode: "review", requiresApproval: true, reversible: false },
  };
  return recommendation;
}

function extractJsonPayload(text: string): string {
  if (text.length > MAX_MODEL_OUTPUT_CHARS) parseError("output_too_large");
  const trimmed = text.trim();
  const tag = new RegExp(`^<${RECOMMENDATIONS_TAG}>\\s*([\\s\\S]*?)\\s*</${RECOMMENDATIONS_TAG}>$`).exec(trimmed);
  if (tag) return tag[1]!;
  const fenced = /^```json\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (fenced) return fenced[1]!;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  parseError("invalid_envelope");
}

/** Parse a complete, tagged or JSON-only model result without recovering prose around it. */
export function parseAgenticRecommendationsOutput(text: string): AgenticRecommendation[] {
  const payload = extractJsonPayload(text);
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    parseError("invalid_json");
  }
  if (!isRecord(decoded) || !hasExactKeys(decoded, ["recommendations"])) parseError("invalid_envelope");
  if (!Array.isArray(decoded.recommendations)) parseError("invalid_recommendations");
  if (decoded.recommendations.length > MAX_RECOMMENDATIONS) parseError("too_many_recommendations");

  const ids = new Set<string>();
  return decoded.recommendations.map((entry) => {
    const recommendation = parseRecommendation(entry);
    if (ids.has(recommendation.id)) parseError("duplicate_id");
    ids.add(recommendation.id);
    return recommendation;
  });
}

function parseAdapterVerificationChecks(
  checks: readonly AgenticAdapterVerificationCheck[],
): AgenticVerificationCheck[] | undefined {
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > MAX_ADAPTER_VERIFICATION_CHECKS) {
    return undefined;
  }

  const ids = new Set<string>();
  const parsed: AgenticVerificationCheck[] = [];
  for (const check of checks) {
    if (
      !isRecord(check)
      || !hasExactKeys(check, ["id", "state", "detail"])
      || !isValidId(check.id)
      || (check.state !== "passed" && check.state !== "pending" && check.state !== "failed")
      || !isBoundedString(check.detail)
      || ids.has(check.id)
    ) {
      return undefined;
    }
    ids.add(check.id);
    parsed.push({ id: check.id, state: check.state, detail: check.detail });
  }
  return parsed;
}

function createVerificationResult(
  recommendation: AgenticRecommendation,
  status: AgenticVerificationStatus,
  checks: AgenticVerificationCheck[],
): AgenticRecommendation {
  const result: AgenticRecommendation = {
    ...recommendation,
    payload: Object.freeze({ ...recommendation.payload }),
    verification: { status, checks },
    application: status === "verified"
      ? { mode: "auto-apply", requiresApproval: false, reversible: true }
      : { mode: "review", requiresApproval: true, reversible: false },
  };
  Object.freeze(result.verification.checks);
  Object.freeze(result.verification);
  Object.freeze(result.application);
  Object.freeze(result);
  return result;
}

/**
 * Validates one deterministic proposal in application code and issues an
 * in-process verification stamp only after trusted adapter checks pass. Persisted
 * data must be passed through here again with fresh mechanical checks.
 */
export function verifyAutoApplicableRecommendation(
  recommendation: AgenticRecommendation,
  adapterChecks: readonly AgenticAdapterVerificationCheck[],
): AgenticRecommendation | undefined {
  if (!isAutoApplyPayload(recommendation.kind, recommendation.payload)) return undefined;

  const schemaCheck: AgenticVerificationCheck = {
    id: "deterministic-payload-schema",
    state: "passed",
    detail: "The code-owned payload schema accepted this deterministic operation.",
  };
  const mechanicalChecks = parseAdapterVerificationChecks(adapterChecks);
  if (!mechanicalChecks) {
    return createVerificationResult(recommendation, "blocked", [
      schemaCheck,
      {
        id: "adapter-verification-required",
        state: "failed",
        detail: "A trusted adapter must provide nonempty mechanical verification checks.",
      },
    ]);
  }

  const checks = [schemaCheck, ...mechanicalChecks];
  if (!mechanicalChecks.every((check) => check.state === "passed")) {
    return createVerificationResult(recommendation, "blocked", checks);
  }

  const verified = createVerificationResult(recommendation, "verified", checks);
  stampTrustedVerifiedRecommendation(verified);
  return verified;
}

/** The only machine-applied recommendation operations; all content changes remain review proposals. */
export function isAutoApplyAllowed(
  recommendation: AgenticRecommendation | RankedAgenticRecommendation,
): boolean {
  return (
    typeof recommendation === "object"
    && recommendation !== null
    && hasTrustedVerificationStamp(recommendation)
    && autoApplyKinds.has(recommendation.kind)
    && isAutoApplyPayload(recommendation.kind, recommendation.payload)
    && recommendation.application.mode === "auto-apply"
    && !recommendation.application.requiresApproval
    && recommendation.application.reversible
    && hasPassedVerificationChecks(recommendation.verification)
  );
}

function rankTier(recommendation: AgenticRecommendation): number {
  if (
    hasTrustedVerificationStamp(recommendation)
    && hasPassedVerificationChecks(recommendation.verification)
  ) return 0;
  switch (recommendation.verification.status) {
    case "proposal":
    case "verified":
      return 1;
    case "blocked":
      return 2;
  }
}

/**
 * Dense ordinal rank from verification tiers. Ties retain model order, while
 * the number of rendered tiers adapts to the recommendations actually present.
 */
export function rankAgenticRecommendations<TPayload extends AgenticPayload>(
  recommendations: readonly AgenticRecommendation<TPayload>[],
): RankedAgenticRecommendation<TPayload>[] {
  const ordered = recommendations
    .map((recommendation, index) => ({ recommendation, index, tier: rankTier(recommendation) }))
    .sort((left, right) => left.tier - right.tier || left.index - right.index);

  let ordinal = 0;
  let previousTier: number | undefined;
  return ordered.map(({ recommendation, tier }) => {
    if (tier !== previousTier) {
      ordinal += 1;
      previousTier = tier;
    }
    const ranked = { ...recommendation, ordinal };
    if (
      hasTrustedVerificationStamp(recommendation)
      && ranked.payload === recommendation.payload
      && ranked.verification === recommendation.verification
      && ranked.application === recommendation.application
    ) {
      stampTrustedVerifiedRecommendation(ranked);
    }
    return ranked;
  });
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

interface CanonicalWriter {
  parts: string[];
  bytes: number;
  maxBytes: number;
}

function appendCanonical(writer: CanonicalWriter, fragment: string): void {
  let bytes = writer.bytes;
  for (let index = 0; index < fragment.length; index += 1) {
    const code = fragment.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < fragment.length
      && fragment.charCodeAt(index + 1) >= 0xdc00
      && fragment.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > writer.maxBytes) throw new Error("context is too large to fingerprint");
  }
  writer.bytes = bytes;
  writer.parts.push(fragment);
}

function appendCanonicalString(writer: CanonicalWriter, value: string): void {
  appendCanonical(writer, "\"");
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        appendCanonical(writer, "\\b");
        break;
      case 0x09:
        appendCanonical(writer, "\\t");
        break;
      case 0x0a:
        appendCanonical(writer, "\\n");
        break;
      case 0x0c:
        appendCanonical(writer, "\\f");
        break;
      case 0x0d:
        appendCanonical(writer, "\\r");
        break;
      case 0x22:
        appendCanonical(writer, "\\\"");
        break;
      case 0x5c:
        appendCanonical(writer, "\\\\");
        break;
      default:
        if (code <= 0x1f || (code >= 0xd800 && code <= 0xdfff && (
          code > 0xdbff
          || index + 1 >= value.length
          || value.charCodeAt(index + 1) < 0xdc00
          || value.charCodeAt(index + 1) > 0xdfff
        ))) {
          appendCanonical(writer, `\\u${code.toString(16).padStart(4, "0")}`);
        } else if (code >= 0xd800 && code <= 0xdbff) {
          appendCanonical(writer, value.slice(index, index + 2));
          index += 1;
        } else {
          appendCanonical(writer, value[index]!);
        }
    }
  }
  appendCanonical(writer, "\"");
}

function canonicalJson(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  budget: { entries: number },
  writer: CanonicalWriter,
): void {
  if (value === null || typeof value === "boolean") {
    appendCanonical(writer, JSON.stringify(value));
    return;
  }
  if (typeof value === "string") {
    appendCanonicalString(writer, value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("context must not contain non-finite numbers");
    appendCanonical(writer, JSON.stringify(value));
    return;
  }
  if (typeof value === "function") throw new Error("context must not contain functions");
  if (typeof value === "symbol") throw new Error("context must not contain symbols");
  if (typeof value === "bigint") throw new Error("context must not contain bigints");
  if (typeof value === "undefined") throw new Error("context must not contain undefined values");
  if (depth <= 0) throw new Error("context exceeds the maximum nesting depth");
  if (typeof value !== "object") throw new Error("context must contain only JSON values");
  if (ancestors.has(value)) throw new Error("context must not contain cycles");

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error("context arrays must use the Array prototype");
    }
    canonicalArray(value, depth, ancestors, budget, writer);
    return;
  }
  if (!isPlainObject(value)) throw new Error("context objects must be plain objects");
  canonicalObject(value as RawRecord, depth, ancestors, budget, writer);
}

function canonicalArray(
  value: unknown[],
  depth: number,
  ancestors: Set<object>,
  budget: { entries: number },
  writer: CanonicalWriter,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    throw new Error("context arrays must not have non-index properties");
  }
  if (value.length > MAX_CONTEXT_ENTRIES - budget.entries) throw new Error("context has too many entries");
  budget.entries += value.length;

  ancestors.add(value);
  try {
    appendCanonical(writer, "[");
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("context arrays must not be sparse or accessor-backed");
      }
      if (index > 0) appendCanonical(writer, ",");
      canonicalJson(descriptor.value, depth - 1, ancestors, budget, writer);
    }
    appendCanonical(writer, "]");
  } finally {
    ancestors.delete(value);
  }
}

function canonicalObject(
  value: RawRecord,
  depth: number,
  ancestors: Set<object>,
  budget: { entries: number },
  writer: CanonicalWriter,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new Error("context must not contain symbol keys");
  if (keys.length > MAX_CONTEXT_ENTRIES - budget.entries) throw new Error("context has too many entries");
  budget.entries += keys.length;
  const sortedKeys = (keys as string[]).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  ancestors.add(value);
  try {
    appendCanonical(writer, "{");
    for (let index = 0; index < sortedKeys.length; index += 1) {
      const key = sortedKeys[index]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("context plain objects must contain enumerable data properties");
      }
      if (index > 0) appendCanonical(writer, ",");
      appendCanonicalString(writer, key);
      appendCanonical(writer, ":");
      canonicalJson(descriptor.value, depth - 1, ancestors, budget, writer);
    }
    appendCanonical(writer, "}");
  } finally {
    ancestors.delete(value);
  }
}

function hash32(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A deterministic, versioned client-safe fingerprint for stale-context checks, not an integrity signature. */
export function contextFingerprint(context: unknown): string {
  const writer: CanonicalWriter = { parts: [], bytes: 0, maxBytes: MAX_CONTEXT_BYTES };
  canonicalJson(context, MAX_CONTEXT_DEPTH, new Set(), { entries: 0 }, writer);
  const canonical = writer.parts.join("");
  return `ctx-v1-${[
    hash32(canonical, 0x811c9dc5),
    hash32(canonical, 0x9e3779b9),
    hash32(canonical, 0x85ebca6b),
    hash32(canonical, 0xc2b2ae35),
  ].join("")}`;
}

export function isRecommendationContextStale(
  recommendation: Pick<AgenticRecommendation, "contextFingerprint">,
  currentContext: unknown,
): boolean {
  return recommendation.contextFingerprint !== contextFingerprint(currentContext);
}
