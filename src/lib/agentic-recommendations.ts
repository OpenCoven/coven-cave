import { redactSecretText } from "./secret-redaction.ts";

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
  "reference-canonicalization",
  "reference-deduplication",
  "identifier-normalization",
  "read-only-projection",
  "prose",
  "dependency",
  "topic",
  "action",
] as const;
export type AgenticRecommendationKind = (typeof AGENTIC_RECOMMENDATION_KINDS)[number];

export const AUTO_APPLY_RECOMMENDATION_KINDS = [
  "reference-canonicalization",
  "reference-deduplication",
  "identifier-normalization",
  "read-only-projection",
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
const MAX_VERIFICATION_CHECKS = 16;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_PAYLOAD_DEPTH = 12;
const MAX_PAYLOAD_ENTRIES = 128;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_CONTEXT_DEPTH = 16;
const MAX_CONTEXT_ENTRIES = 256;
const ID_RE = /^[A-Za-z][A-Za-z0-9._:/-]*$/;
const FINGERPRINT_RE = /^ctx-v1-[0-9a-f]{32}$/;
const verificationStatuses = new Set<AgenticVerificationStatus>(["verified", "proposal", "blocked"]);
const verificationCheckStates = new Set<AgenticVerificationCheckState>(["passed", "pending", "failed"]);
const agenticSurfaces = new Set<string>(AGENTIC_SURFACES);
const evidenceKinds = new Set<string>(AGENTIC_EVIDENCE_KINDS);
const recommendationKinds = new Set<string>(AGENTIC_RECOMMENDATION_KINDS);
const autoApplyKinds = new Set<string>(AUTO_APPLY_RECOMMENDATION_KINDS);

type RawRecord = Record<string, unknown>;

function parseError(code: AgenticRecommendationParseErrorCode): never {
  throw new AgenticRecommendationParseError(code);
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function parsePayload(value: unknown): AgenticPayload {
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
  return value as AgenticPayload;
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
    if (!isValidId(entry.id) || !isBoundedString(entry.label)) parseError("invalid_evidence");
    const kind = asEvidenceKind(entry.kind);
    if (redactSecretText(entry.id) !== entry.id || redactSecretText(entry.label) !== entry.label) {
      parseError("secret_evidence");
    }
    return { id: entry.id, kind, label: entry.label };
  });
}

function parseVerification(value: unknown): AgenticVerification {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "checks"]) || typeof value.status !== "string") {
    parseError("invalid_verification");
  }
  const status = value.status as AgenticVerificationStatus;
  if (!verificationStatuses.has(status) || !Array.isArray(value.checks) || value.checks.length > MAX_VERIFICATION_CHECKS) {
    parseError("invalid_verification");
  }
  const checks = value.checks.map((check) => {
    if (!isRecord(check) || !hasExactKeys(check, ["id", "state", "detail"])) parseError("invalid_verification");
    const state = check.state as AgenticVerificationCheckState;
    if (!isValidId(check.id) || typeof check.state !== "string" || !verificationCheckStates.has(state) || !isBoundedString(check.detail)) {
      parseError("invalid_verification");
    }
    return { id: check.id, state: check.state as AgenticVerificationCheckState, detail: check.detail };
  });
  return { status, checks };
}

function parseApplication(value: unknown): AgenticApplication {
  if (!isRecord(value) || !hasExactKeys(value, ["mode", "requiresApproval", "reversible"])) {
    parseError("invalid_application");
  }
  if (
    (value.mode !== "auto-apply" && value.mode !== "review") ||
    typeof value.requiresApproval !== "boolean" ||
    typeof value.reversible !== "boolean"
  ) {
    parseError("invalid_application");
  }
  return {
    mode: value.mode,
    requiresApproval: value.requiresApproval,
    reversible: value.reversible,
  };
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
      "verification",
      "application",
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

  const recommendation: AgenticRecommendation = {
    id: value.id,
    surface: asSurface(value.surface),
    kind: asKind(value.kind),
    payload: parsePayload(value.payload),
    rationale: value.rationale,
    inferredGoal: value.inferredGoal,
    rankReasons: [...value.rankReasons],
    evidenceRefs: parseEvidenceRefs(value.evidenceRefs),
    contextFingerprint: value.contextFingerprint,
    verification: parseVerification(value.verification),
    application: parseApplication(value.application),
  };
  if (recommendation.application.mode === "auto-apply" && !isAutoApplyAllowed(recommendation)) {
    parseError("auto_apply_forbidden");
  }
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

/** The only machine-applied recommendation operations; all content changes remain review proposals. */
export function isAutoApplyAllowed(recommendation: Pick<AgenticRecommendation, "kind" | "verification" | "application">): boolean {
  return (
    autoApplyKinds.has(recommendation.kind) &&
    recommendation.application.mode === "auto-apply" &&
    !recommendation.application.requiresApproval &&
    recommendation.application.reversible &&
    recommendation.verification.status === "verified" &&
    recommendation.verification.checks.some((check) => check.state === "passed")
  );
}

function rankTier(recommendation: AgenticRecommendation): number {
  switch (recommendation.verification.status) {
    case "verified":
      return 0;
    case "proposal":
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
    return { ...recommendation, ordinal };
  });
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function canonicalJson(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  budget: { entries: number },
): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("context must contain JSON values");
    return JSON.stringify(value);
  }
  if (depth <= 0 || !Array.isArray(value) && !isRecord(value)) throw new Error("context must contain bounded JSON values");
  if (ancestors.has(value)) throw new Error("context must not contain cycles");

  const entries = Array.isArray(value) ? value : Object.keys(value).sort().map((key) => [key, value[key]] as const);
  if (entries.length > MAX_CONTEXT_ENTRIES - budget.entries) throw new Error("context has too many entries");
  budget.entries += entries.length;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalJson(entry, depth - 1, ancestors, budget)).join(",")}]`;
    }
    return `{${(entries as ReadonlyArray<readonly [string, unknown]>)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry, depth - 1, ancestors, budget)}`)
      .join(",")}}`;
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
  const canonical = canonicalJson(context, MAX_CONTEXT_DEPTH, new Set(), { entries: 0 });
  if (utf8ByteLength(canonical) > MAX_CONTEXT_BYTES) throw new Error("context is too large to fingerprint");
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
