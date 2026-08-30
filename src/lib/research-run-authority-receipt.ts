import {
  copyCanonicalJsonValue,
  canonicalJson,
  sha256Digest,
} from "./research-protocol/digest.ts";
import {
  parseRunManifestV1,
  type ArtifactRegistrationV1,
  type RunManifestSourceV1,
  type RunManifestV1,
} from "./research-protocol/run-manifest.ts";
import { isUtcTimestamp } from "./research-protocol/common.ts";
import type { ResearchRunV1 } from "./research-protocol/research-run.ts";

export const RESEARCH_RUN_RECEIPT_SCHEMA = "opencoven.research-run-receipt/v1" as const;

const RUN_ID_RE = /^run_[A-Za-z0-9_-]+$/;

export type ResearchRunAuthorityStatusV1 = "running" | "awaiting_authority" | "completed";

export type ResearchRunAuthorityRequestStatusV1 =
  | "pending"
  | "granted"
  | "denied"
  | "expired";

export type ResearchRunAuthorityScopeV1 =
  | string
  | readonly string[]
  | Readonly<Record<string, unknown>>;

export type ResearchRunAuthorityRequestV1 = {
  id: string;
  capability: string;
  requestedAt: string;
  status: ResearchRunAuthorityRequestStatusV1;
  scope?: ResearchRunAuthorityScopeV1;
  reason?: string;
  resolvedAt?: string;
};

export type ResearchRunAuthorityGrantV1 = {
  id: string;
  capability: string;
  grantedAt: string;
  exercised: boolean;
  requestId?: string;
  scope?: ResearchRunAuthorityScopeV1;
  mode?: string;
  expiresAt?: string;
};

export type ResearchRunAuthorityStateV1 = {
  status: ResearchRunAuthorityStatusV1;
  requests: readonly ResearchRunAuthorityRequestV1[];
  grants: readonly ResearchRunAuthorityGrantV1[];
};

export type ResearchRunAuthorityRequestInputV1 = Omit<
  ResearchRunAuthorityRequestV1,
  "status"
> & {
  status?: ResearchRunAuthorityRequestStatusV1;
};

export type ResearchRunPlanRevisionV1 = {
  revision: number;
  at: string;
  digest?: string;
  reason?: string;
};

export type ResearchRunPartialFailureV1 = {
  code: string;
  message: string;
  retryable?: boolean;
  at?: string;
  phase?: string;
};

export type ResearchRunCompletionReceiptV1 = {
  schema: typeof RESEARCH_RUN_RECEIPT_SCHEMA;
  runId: string;
  familiarId: string;
  skillId: string;
  skillVersion: string;
  runtime: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  planRevisionHistory: readonly ResearchRunPlanRevisionV1[];
  grantsExercised: readonly ResearchRunAuthorityGrantV1[];
  sourceManifest: readonly RunManifestSourceV1[];
  artifactManifest: readonly ArtifactRegistrationV1[];
  citationCount: number;
  partialFailures: readonly ResearchRunPartialFailureV1[];
  integrityDigest: string;
};

export type ResearchRunCompletionReceiptInputV1 = {
  manifest?: RunManifestV1;
  authority?: ResearchRunAuthorityStateV1;
  grantsExercised?: readonly ResearchRunAuthorityGrantV1[];
  planRevisionHistory?: readonly ResearchRunPlanRevisionV1[];
  sourceManifest?: readonly RunManifestSourceV1[];
  artifactManifest?: readonly ArtifactRegistrationV1[];
  citationCount?: number;
  partialFailures?: readonly ResearchRunPartialFailureV1[];
  familiarId?: string;
  skillId?: string;
  skillVersion?: string;
  runtime?: string;
  startedAt?: string;
  completedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return text(value, field);
}

function utcText(value: unknown, field: string): string {
  const timestamp = text(value, field);
  if (!isUtcTimestamp(timestamp)) throw new TypeError(`${field} must be a UTC timestamp`);
  return timestamp;
}

function optionalUtcText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return utcText(value, field);
}

function safeRunId(value: unknown): string {
  const id = text(value, "runId");
  if (!RUN_ID_RE.test(id)) throw new TypeError("runId must be a canonical ResearchRun id");
  return id;
}

function safeNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function safePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function safeDigest(value: unknown, field: string): string {
  const digest = text(value, field);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${field} must be a SHA-256 digest`);
  return digest;
}

function copyScope(value: unknown, field: string): ResearchRunAuthorityScopeV1 {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string")) {
      throw new TypeError(`${field} must contain only strings`);
    }
    return copyCanonicalJsonValue(value) as readonly string[];
  }
  if (isRecord(value)) return copyCanonicalJsonValue(value) as Readonly<Record<string, unknown>>;
  throw new TypeError(`${field} must be a string, string array, or JSON object`);
}

function copyRecordArray<T extends Record<string, unknown>>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const copied = copyCanonicalJsonValue(value);
  if (!Array.isArray(copied) || copied.some((item) => !isRecord(item))) {
    throw new TypeError(`${field} must contain JSON objects`);
  }
  return copied as T[];
}

function normalizeRequest(value: unknown, field: string): ResearchRunAuthorityRequestV1 {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const request: ResearchRunAuthorityRequestV1 = {
    id: text(value.id, `${field}.id`),
    capability: text(value.capability, `${field}.capability`),
    requestedAt: utcText(value.requestedAt, `${field}.requestedAt`),
    status: value.status === undefined
      ? "pending"
      : text(value.status, `${field}.status`) as ResearchRunAuthorityRequestStatusV1,
  };
  if (!["pending", "granted", "denied", "expired"].includes(request.status)) {
    throw new TypeError(`${field}.status is not a supported authority request status`);
  }
  if (hasOwn(value, "scope")) request.scope = copyScope(value.scope, `${field}.scope`);
  const reason = optionalText(value.reason, `${field}.reason`);
  const resolvedAt = optionalUtcText(value.resolvedAt, `${field}.resolvedAt`);
  if (reason !== undefined) request.reason = reason;
  if (resolvedAt !== undefined) request.resolvedAt = resolvedAt;
  return request;
}

function normalizeGrant(value: unknown, field: string): ResearchRunAuthorityGrantV1 {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const grant: ResearchRunAuthorityGrantV1 = {
    id: text(value.id, `${field}.id`),
    capability: text(value.capability, `${field}.capability`),
    grantedAt: utcText(value.grantedAt, `${field}.grantedAt`),
    exercised: value.exercised === undefined ? true : value.exercised === true,
  };
  const requestId = optionalText(value.requestId, `${field}.requestId`);
  const mode = optionalText(value.mode, `${field}.mode`);
  const expiresAt = optionalUtcText(value.expiresAt, `${field}.expiresAt`);
  if (requestId !== undefined) grant.requestId = requestId;
  if (mode !== undefined) grant.mode = mode;
  if (expiresAt !== undefined) grant.expiresAt = expiresAt;
  if (hasOwn(value, "scope")) grant.scope = copyScope(value.scope, `${field}.scope`);
  return grant;
}

function sameId(left: { id: string }, right: { id: string }): boolean {
  return left.id === right.id;
}

export function createResearchRunAuthorityState(): ResearchRunAuthorityStateV1 {
  return { status: "running", requests: [], grants: [] };
}

export function requestResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
  input: ResearchRunAuthorityRequestInputV1,
): ResearchRunAuthorityStateV1 {
  const request = normalizeRequest({ ...input, status: input.status ?? "pending" }, "authorityRequest");
  const requests = state.requests.filter((candidate) => !sameId(candidate, request));
  return {
    status: "awaiting_authority",
    requests: [...requests, request],
    grants: [...state.grants],
  };
}

export function grantResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
  input: ResearchRunAuthorityGrantV1,
): ResearchRunAuthorityStateV1 {
  const grant = normalizeGrant(input, "authorityGrant");
  const grants = [
    ...state.grants.filter((candidate) => !sameId(candidate, grant)),
    grant,
  ];
  const requests = state.requests.map((request) => {
    if (request.id !== grant.requestId) return request;
    return { ...request, status: "granted" as const, resolvedAt: grant.grantedAt };
  });
  const hasPending = requests.some((request) => request.status === "pending");
  return {
    status: hasPending ? "awaiting_authority" : "running",
    requests,
    grants,
  };
}

export function completeResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
): ResearchRunAuthorityStateV1 {
  return { ...state, status: "completed" };
}

export function validateResearchRunAuthorityState(
  value: unknown,
): ResearchRunAuthorityStateV1 {
  if (!isRecord(value)) throw new TypeError("authority state must be an object");
  const status = text(value.status, "authority.status") as ResearchRunAuthorityStatusV1;
  if (!["running", "awaiting_authority", "completed"].includes(status)) {
    throw new TypeError("authority.status is not supported");
  }
  const requests = copyRecordArray(value.requests, "authority.requests").map((item, index) =>
    normalizeRequest(item, `authority.requests[${index}]`));
  const grants = copyRecordArray(value.grants, "authority.grants").map((item, index) =>
    normalizeGrant(item, `authority.grants[${index}]`));
  return { status, requests, grants };
}

export function serializeResearchRunAuthorityState(
  state: ResearchRunAuthorityStateV1,
): string {
  return canonicalJson(validateResearchRunAuthorityState(state));
}

function manifestForReceipt(
  run: ResearchRunV1,
  input: ResearchRunCompletionReceiptInputV1,
): RunManifestV1 | undefined {
  const candidate = input.manifest ?? run.artifactManifest;
  if (candidate === undefined) return undefined;
  const parsed = parseRunManifestV1(candidate);
  if (!parsed.ok) throw new TypeError(`artifact manifest is invalid: ${parsed.error.message}`);
  if (parsed.value.runId !== run.id) {
    throw new TypeError("artifact manifest runId must match the receipt runId");
  }
  return parsed.value;
}

function manifestEntries<T extends Record<string, unknown>>(
  input: readonly T[] | undefined,
  fallback: readonly T[] | undefined,
  field: string,
): T[] {
  return copyRecordArray(input ?? fallback ?? [], field) as T[];
}

function normalizePlanHistory(
  values: readonly ResearchRunPlanRevisionV1[] | undefined,
  createdAt: string,
): ResearchRunPlanRevisionV1[] {
  const history = (values ?? []).map((value, index) => {
    if (!isRecord(value)) throw new TypeError(`planRevisionHistory[${index}] must be an object`);
    const revision = safePositiveInteger(value.revision, `planRevisionHistory[${index}].revision`);
    const at = value.at === undefined
      ? createdAt
      : utcText(value.at, `planRevisionHistory[${index}].at`);
    const digest = value.digest === undefined
      ? undefined
      : safeDigest(value.digest, `planRevisionHistory[${index}].digest`);
    const reason = optionalText(value.reason, `planRevisionHistory[${index}].reason`);
    return {
      revision,
      at,
      ...(digest ? { digest } : {}),
      ...(reason ? { reason } : {}),
    };
  });
  return history.sort((left, right) => left.revision - right.revision);
}

function normalizePartialFailures(
  values: readonly ResearchRunPartialFailureV1[] | undefined,
): ResearchRunPartialFailureV1[] {
  return (values ?? []).map((value, index) => {
    if (!isRecord(value)) throw new TypeError(`partialFailures[${index}] must be an object`);
    const failure: ResearchRunPartialFailureV1 = {
      code: text(value.code, `partialFailures[${index}].code`),
      message: text(value.message, `partialFailures[${index}].message`),
    };
    if (value.retryable !== undefined) {
      if (typeof value.retryable !== "boolean") {
        throw new TypeError(`partialFailures[${index}].retryable must be boolean`);
      }
      failure.retryable = value.retryable;
    }
    const at = optionalUtcText(value.at, `partialFailures[${index}].at`);
    const phase = optionalText(value.phase, `partialFailures[${index}].phase`);
    if (at) failure.at = at;
    if (phase) failure.phase = phase;
    return failure;
  });
}

function digestUnsignedReceipt(value: Omit<ResearchRunCompletionReceiptV1, "integrityDigest">): string {
  return sha256Digest(canonicalJson(value));
}

export function createResearchRunCompletionReceipt(
  run: ResearchRunV1,
  input: ResearchRunCompletionReceiptInputV1 = {},
): ResearchRunCompletionReceiptV1 {
  const manifest = manifestForReceipt(run, input);
  const authority = input.authority
    ? validateResearchRunAuthorityState(input.authority)
    : createResearchRunAuthorityState();
  const grants = input.grantsExercised ?? authority.grants.filter((grant) => grant.exercised);
  const sourceManifest = manifestEntries(input.sourceManifest, manifest?.sources, "sourceManifest");
  const artifactManifest = manifestEntries(input.artifactManifest, manifest?.artifacts, "artifactManifest");
  const citationCount = input.citationCount ?? 0;
  safeNonNegativeInteger(citationCount, "citationCount");

  const familiarId = input.familiarId ?? run.execution.modelBinding.familiarId;
  const skillId = input.skillId ?? "research";
  const skillVersion = input.skillVersion ?? "unknown";
  const runtime = input.runtime ?? run.execution.modelExecution;
  const startedAt = input.startedAt ?? run.createdAt;
  const completedAt = input.completedAt ?? run.updatedAt;
  const unsigned: Omit<ResearchRunCompletionReceiptV1, "integrityDigest"> = {
    schema: RESEARCH_RUN_RECEIPT_SCHEMA,
    runId: safeRunId(run.id),
    familiarId: text(familiarId, "familiarId"),
    skillId: text(skillId, "skillId"),
    skillVersion: text(skillVersion, "skillVersion"),
    runtime: text(runtime, "runtime"),
    createdAt: utcText(run.createdAt, "createdAt"),
    startedAt: utcText(startedAt, "startedAt"),
    completedAt: utcText(completedAt, "completedAt"),
    planRevisionHistory: normalizePlanHistory(input.planRevisionHistory, run.createdAt),
    grantsExercised: grants.map((grant, index) => normalizeGrant(grant, `grantsExercised[${index}]`)),
    sourceManifest,
    artifactManifest,
    citationCount,
    partialFailures: normalizePartialFailures(input.partialFailures),
  };
  return {
    ...unsigned,
    integrityDigest: digestUnsignedReceipt(unsigned),
  };
}

export function validateResearchRunCompletionReceipt(
  value: unknown,
): ResearchRunCompletionReceiptV1 {
  if (!isRecord(value)) throw new TypeError("completion receipt must be an object");
  const copied = copyCanonicalJsonValue(value);
  if (!isRecord(copied)) throw new TypeError("completion receipt must be a JSON object");
  if (copied.schema !== RESEARCH_RUN_RECEIPT_SCHEMA) {
    throw new TypeError("unsupported completion receipt schema");
  }
  if (!hasOwn(copied, "planRevisionHistory")) {
    throw new TypeError("completion receipt must include planRevisionHistory");
  }
  if (!hasOwn(copied, "partialFailures")) {
    throw new TypeError("completion receipt must include partialFailures");
  }

  const receipt: ResearchRunCompletionReceiptV1 = {
    schema: RESEARCH_RUN_RECEIPT_SCHEMA,
    runId: safeRunId(copied.runId),
    familiarId: text(copied.familiarId, "familiarId"),
    skillId: text(copied.skillId, "skillId"),
    skillVersion: text(copied.skillVersion, "skillVersion"),
    runtime: text(copied.runtime, "runtime"),
    createdAt: utcText(copied.createdAt, "createdAt"),
    startedAt: utcText(copied.startedAt, "startedAt"),
    completedAt: utcText(copied.completedAt, "completedAt"),
    planRevisionHistory: normalizePlanHistory(
      copied.planRevisionHistory as ResearchRunPlanRevisionV1[],
      copied.createdAt as string,
    ),
    grantsExercised: copyRecordArray(copied.grantsExercised, "grantsExercised").map(
      (grant, index) => normalizeGrant(grant, `grantsExercised[${index}]`),
    ),
    sourceManifest: copyRecordArray(copied.sourceManifest, "sourceManifest") as RunManifestSourceV1[],
    artifactManifest: copyRecordArray(
      copied.artifactManifest,
      "artifactManifest",
    ) as ArtifactRegistrationV1[],
    citationCount: safeNonNegativeInteger(copied.citationCount, "citationCount"),
    partialFailures: normalizePartialFailures(
      copied.partialFailures as ResearchRunPartialFailureV1[],
    ),
    integrityDigest: safeDigest(copied.integrityDigest, "integrityDigest"),
  };
  return receipt;
}

export function serializeResearchRunCompletionReceipt(
  receipt: ResearchRunCompletionReceiptV1,
): string {
  return canonicalJson(validateResearchRunCompletionReceipt(receipt));
}

export function verifyResearchRunCompletionReceipt(value: unknown): boolean {
  try {
    const receipt = validateResearchRunCompletionReceipt(value);
    const { integrityDigest, ...unsigned } = receipt;
    return integrityDigest === digestUnsignedReceipt(unsigned);
  } catch {
    return false;
  }
}
