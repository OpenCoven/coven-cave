import type {
  CanonicalMemoryDetail,
  CanonicalMemoryErrorCode,
  CanonicalMemoryOverview,
  CanonicalMemorySource,
  CanonicalMemorySummary,
  CanonicalMemoryVerificationState,
} from "./canonical-memory.ts";

const ERROR_CODES = new Set<CanonicalMemoryErrorCode>([
  "local_access_required",
  "local_daemon_required",
  "daemon_update_required",
  "canonical_memory_unavailable",
  "invalid_daemon_payload",
  "invalid_memory_id",
  "memory_not_found",
]);

const VERIFICATION_STATES = new Set<CanonicalMemoryVerificationState>([
  "verified",
  "needs-review",
  "degraded",
  "unknown",
  "unavailable",
]);

type JsonRecord = Record<string, unknown>;

type Parsed<T> =
  | { valid: true; value: T }
  | { valid: false };

export class CanonicalMemoryRequestError extends Error {
  public readonly code: CanonicalMemoryErrorCode;
  public readonly status: number;

  constructor(code: CanonicalMemoryErrorCode, status: number) {
    super(code);
    this.name = "CanonicalMemoryRequestError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return typeof value === "boolean" || value === null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isVerificationState(
  value: unknown,
): value is CanonicalMemoryVerificationState {
  return typeof value === "string" &&
    VERIFICATION_STATES.has(value as CanonicalMemoryVerificationState);
}

function decodeSource(value: unknown): CanonicalMemorySource | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    typeof value.label !== "string"
  ) {
    return null;
  }
  return {
    kind: value.kind,
    label: value.label,
  };
}

function decodeSummary(value: unknown): CanonicalMemorySummary | null {
  if (
    !isRecord(value) ||
    !isRecord(value.privacy) ||
    !isRecord(value.verification)
  ) {
    return null;
  }
  const source = decodeSource(value.source);
  if (
    source === null ||
    typeof value.id !== "string" ||
    typeof value.familiarId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.relativeUpdatedAt !== "string" ||
    typeof value.excerpt !== "string" ||
    !isStringOrNull(value.privacy.classification) ||
    !isBooleanOrNull(value.privacy.revealRequired) ||
    !isVerificationState(value.verification.state)
  ) {
    return null;
  }
  return {
    id: value.id,
    familiarId: value.familiarId,
    title: value.title,
    updatedAt: value.updatedAt,
    relativeUpdatedAt: value.relativeUpdatedAt,
    excerpt: value.excerpt,
    source,
    privacy: {
      classification: value.privacy.classification,
      revealRequired: value.privacy.revealRequired,
    },
    verification: {
      state: value.verification.state,
    },
  };
}

function decodeSummaryList(value: unknown): CanonicalMemorySummary[] | null {
  if (!Array.isArray(value)) return null;
  const entries: CanonicalMemorySummary[] = [];
  for (const candidate of value) {
    const entry = decodeSummary(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}

function decodeOverview(value: unknown): CanonicalMemoryOverview | null {
  if (
    !isRecord(value) ||
    !isRecord(value.totals) ||
    !isRecord(value.capabilities) ||
    !isRecord(value.verification)
  ) {
    return null;
  }
  const { totals, capabilities, verification } = value;
  if (
    typeof value.generatedAt !== "string" ||
    !isStringOrNull(value.lastUpdatedAt) ||
    !isNonNegativeInteger(totals.entries) ||
    !isNonNegativeInteger(totals.familiars) ||
    !isNonNegativeInteger(totals.verified) ||
    !isNonNegativeInteger(totals.needsReview) ||
    !isNonNegativeInteger(totals.unknown) ||
    typeof capabilities.detail !== "boolean" ||
    typeof capabilities.verification !== "boolean" ||
    typeof capabilities.attestationMetadata !== "boolean" ||
    typeof capabilities.supersessionHistory !== "boolean" ||
    typeof capabilities.mutations !== "boolean" ||
    !isVerificationState(verification.state) ||
    typeof verification.checkedAt !== "string" ||
    !isStringOrNull(verification.manifest) ||
    !isStringOrNull(verification.index) ||
    !Array.isArray(verification.issues) ||
    !verification.issues.every((issue) => typeof issue === "string")
  ) {
    return null;
  }
  return {
    generatedAt: value.generatedAt,
    totals: {
      entries: totals.entries,
      familiars: totals.familiars,
      verified: totals.verified,
      needsReview: totals.needsReview,
      unknown: totals.unknown,
    },
    lastUpdatedAt: value.lastUpdatedAt,
    capabilities: {
      detail: capabilities.detail,
      verification: capabilities.verification,
      attestationMetadata: capabilities.attestationMetadata,
      supersessionHistory: capabilities.supersessionHistory,
      mutations: capabilities.mutations,
    },
    verification: {
      state: verification.state,
      checkedAt: verification.checkedAt,
      manifest: verification.manifest,
      index: verification.index,
      issues: [...verification.issues],
    },
  };
}

function decodeDetail(value: unknown): CanonicalMemoryDetail | null {
  if (
    !isRecord(value) ||
    !isRecord(value.privacy) ||
    !isRecord(value.verification) ||
    !isRecord(value.supersession)
  ) {
    return null;
  }
  const source = decodeSource(value.source);
  let attestationMetadata: CanonicalMemoryDetail["attestationMetadata"];
  if (value.attestationMetadata === null) {
    attestationMetadata = null;
  } else if (
    isRecord(value.attestationMetadata) &&
    isNonNegativeInteger(value.attestationMetadata.fieldCount)
  ) {
    attestationMetadata = {
      fieldCount: value.attestationMetadata.fieldCount,
    };
  } else {
    return null;
  }
  if (
    source === null ||
    typeof value.id !== "string" ||
    typeof value.familiarId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.content !== "string" ||
    value.contentFormat !== "markdown" ||
    !isStringOrNull(value.privacy.classification) ||
    !isBooleanOrNull(value.privacy.revealRequired) ||
    typeof value.privacy.reason !== "string" ||
    !isVerificationState(value.verification.state) ||
    typeof value.verification.reason !== "string" ||
    !isStringOrNull(value.supersession.supersedes) ||
    !isStringOrNull(value.supersession.supersededBy)
  ) {
    return null;
  }
  return {
    id: value.id,
    familiarId: value.familiarId,
    title: value.title,
    updatedAt: value.updatedAt,
    source,
    content: value.content,
    contentFormat: value.contentFormat,
    privacy: {
      classification: value.privacy.classification,
      revealRequired: value.privacy.revealRequired,
      reason: value.privacy.reason,
    },
    verification: {
      state: value.verification.state,
      reason: value.verification.reason,
    },
    attestationMetadata,
    supersession: {
      supersedes: value.supersession.supersedes,
      supersededBy: value.supersession.supersededBy,
    },
  };
}

function isErrorCode(value: unknown): value is CanonicalMemoryErrorCode {
  return typeof value === "string" &&
    ERROR_CODES.has(value as CanonicalMemoryErrorCode);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function invalidPayload(status: number): CanonicalMemoryRequestError {
  return new CanonicalMemoryRequestError(
    "invalid_daemon_payload",
    Number.isInteger(status) ? status : 0,
  );
}

async function canonicalMemoryRequest<T>(
  url: string,
  signal: AbortSignal | undefined,
  parse: (payload: unknown) => Parsed<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw invalidPayload(0);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw invalidPayload(response.status);
  }

  if (isRecord(payload) && payload.ok === false && isErrorCode(payload.code)) {
    throw new CanonicalMemoryRequestError(payload.code, response.status);
  }
  const parsed = parse(payload);
  if (!response.ok || !parsed.valid) {
    throw invalidPayload(response.status);
  }
  return parsed.value;
}

export function fetchCanonicalMemoryList(
  signal?: AbortSignal,
): Promise<CanonicalMemorySummary[]> {
  return canonicalMemoryRequest(
    "/api/coven-memory",
    signal,
    (payload): Parsed<CanonicalMemorySummary[]> => {
      if (!isRecord(payload) || payload.ok !== true) return { valid: false };
      const entries = decodeSummaryList(payload.entries);
      return entries === null
        ? { valid: false }
        : { valid: true, value: entries };
    },
  );
}

export function fetchCanonicalMemoryOverview(
  signal?: AbortSignal,
): Promise<CanonicalMemoryOverview> {
  return canonicalMemoryRequest(
    "/api/coven-memory/overview",
    signal,
    (payload): Parsed<CanonicalMemoryOverview> => {
      if (!isRecord(payload) || payload.ok !== true) return { valid: false };
      const overview = decodeOverview(payload.overview);
      return overview === null
        ? { valid: false }
        : { valid: true, value: overview };
    },
  );
}

export function fetchCanonicalMemoryDetail(
  id: string,
  signal?: AbortSignal,
): Promise<CanonicalMemoryDetail> {
  return canonicalMemoryRequest(
    `/api/coven-memory/${encodeURIComponent(id)}`,
    signal,
    (payload): Parsed<CanonicalMemoryDetail> => {
      if (!isRecord(payload) || payload.ok !== true) return { valid: false };
      const entry = decodeDetail(payload.entry);
      return entry === null
        ? { valid: false }
        : { valid: true, value: entry };
    },
  );
}
