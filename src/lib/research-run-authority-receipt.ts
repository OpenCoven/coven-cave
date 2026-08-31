import {
  copyCanonicalJsonValue,
  canonicalJson,
  sha256Digest,
} from "./research-protocol/digest.ts";
import {
  parseEmbeddedRunManifestCandidateV1,
  parseRunManifestArtifactsV1,
  parseRunManifestSourcesV1,
  type ArtifactRegistrationV1,
  type RunManifestSourceV1,
  type RunManifestV1,
} from "./research-protocol/run-manifest.ts";
import { isUtcTimestamp } from "./research-protocol/common.ts";
import {
  parseResearchRunV1,
  type ResearchRunV1,
} from "./research-protocol/research-run.ts";

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
  if (typeof value.exercised !== "boolean") {
    throw new TypeError(`${field}.exercised must be boolean`);
  }
  const grant: ResearchRunAuthorityGrantV1 = {
    id: text(value.id, `${field}.id`),
    capability: text(value.capability, `${field}.capability`),
    grantedAt: utcText(value.grantedAt, `${field}.grantedAt`),
    exercised: value.exercised,
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

function scopesCanonicallyEqual(
  left: ResearchRunAuthorityScopeV1 | undefined,
  right: ResearchRunAuthorityScopeV1 | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function assertGrantMatchesRequest(
  grant: ResearchRunAuthorityGrantV1,
  request: ResearchRunAuthorityRequestV1,
  field: string,
): void {
  if (grant.capability !== request.capability) {
    throw new TypeError(`${field}.capability must canonically match its authority request`);
  }
  if (!scopesCanonicallyEqual(grant.scope, request.scope)) {
    throw new TypeError(`${field}.scope must canonically match its authority request`);
  }
}

export function createResearchRunAuthorityState(): ResearchRunAuthorityStateV1 {
  return { status: "running", requests: [], grants: [] };
}

export function requestResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
  input: ResearchRunAuthorityRequestInputV1,
): ResearchRunAuthorityStateV1 {
  const current = validateResearchRunAuthorityState(state);
  if (current.status === "completed") {
    throw new TypeError("completed authority state is terminal");
  }
  const request = normalizeRequest({ ...input, status: input.status ?? "pending" }, "authorityRequest");
  if (request.status !== "pending") {
    throw new TypeError("new authority requests must be pending");
  }
  if (current.requests.some((candidate) => sameId(candidate, request))) {
    throw new TypeError("authority request id already exists");
  }
  return {
    status: "awaiting_authority",
    requests: [...current.requests, request],
    grants: [...current.grants],
  };
}

export function grantResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
  input: ResearchRunAuthorityGrantV1,
): ResearchRunAuthorityStateV1 {
  const current = validateResearchRunAuthorityState(state);
  if (current.status === "completed") {
    throw new TypeError("completed authority state is terminal");
  }
  const grant = normalizeGrant(input, "authorityGrant");
  const request = current.requests.find((candidate) =>
    candidate.id === grant.requestId && candidate.status === "pending");
  if (!request) {
    throw new TypeError(
      "authorityGrant.requestId must identify an existing pending authority request",
    );
  }
  if (grant.capability !== request.capability) {
    throw new TypeError(
      "authorityGrant.capability must canonically match the pending authority request",
    );
  }
  if (!scopesCanonicallyEqual(grant.scope, request.scope)) {
    throw new TypeError(
      "authorityGrant.scope must canonically match the pending authority request",
    );
  }
  const grants = [
    ...current.grants.filter((candidate) => !sameId(candidate, grant)),
    grant,
  ];
  const requests = current.requests.map((candidate) => {
    if (candidate.id !== request.id) return candidate;
    return { ...candidate, status: "granted" as const, resolvedAt: grant.grantedAt };
  });
  const hasPending = requests.some((request) => request.status === "pending");
  return validateResearchRunAuthorityState({
    status: hasPending ? "awaiting_authority" : "running",
    requests,
    grants,
  });
}

export function completeResearchRunAuthority(
  state: ResearchRunAuthorityStateV1,
): ResearchRunAuthorityStateV1 {
  const current = validateResearchRunAuthorityState(state);
  if (current.requests.some((request) => request.status === "pending")) {
    throw new TypeError("pending authority requests cannot be completed");
  }
  return validateResearchRunAuthorityState({ ...current, status: "completed" });
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

  const requestIds = new Set<string>();
  for (const [index, request] of requests.entries()) {
    if (requestIds.has(request.id)) {
      throw new TypeError(`authority.requests[${index}].id must be unique`);
    }
    requestIds.add(request.id);
  }
  const grantIds = new Set<string>();
  const grantsByRequest = new Map<string, number>();
  for (const [index, grant] of grants.entries()) {
    if (grantIds.has(grant.id)) {
      throw new TypeError(`authority.grants[${index}].id must be unique`);
    }
    grantIds.add(grant.id);
    const request = requests.find((candidate) =>
      candidate.id === grant.requestId && candidate.status === "granted");
    if (!request) {
      throw new TypeError(
        `authority.grants[${index}].requestId must identify an existing granted authority request`,
      );
    }
    assertGrantMatchesRequest(grant, request, `authority.grants[${index}]`);
    grantsByRequest.set(request.id, (grantsByRequest.get(request.id) ?? 0) + 1);
  }
  for (const [index, request] of requests.entries()) {
    if (request.status === "granted" && grantsByRequest.get(request.id) !== 1) {
      throw new TypeError(
        `authority.requests[${index}] granted requests require exactly one matching authority grant`,
      );
    }
  }
  const hasPending = requests.some((request) => request.status === "pending");
  if (hasPending && status !== "awaiting_authority") {
    throw new TypeError("authority pending requests require awaiting_authority status");
  }
  if (!hasPending && status === "awaiting_authority") {
    throw new TypeError("authority awaiting_authority status requires a pending request");
  }
  return { status, requests, grants };
}

export function serializeResearchRunAuthorityState(
  state: ResearchRunAuthorityStateV1,
): string {
  return canonicalJson(validateResearchRunAuthorityState(state));
}

function validatedRunForReceipt(
  run: ResearchRunV1,
): ResearchRunV1 & { artifactManifest: RunManifestV1 } {
  const parsed = parseResearchRunV1(run);
  if (!parsed.ok) {
    throw new TypeError(
      `ResearchRun is invalid at ${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  if (!["completed", "failed", "cancelled", "expired"].includes(parsed.value.status)) {
    throw new TypeError("completion receipts require a terminal ResearchRun");
  }
  if (!parsed.value.artifactManifest || parsed.value.artifactManifest.state !== "final") {
    throw new TypeError("completion receipts require an embedded final artifactManifest");
  }
  return parsed.value as ResearchRunV1 & { artifactManifest: RunManifestV1 };
}

function assertManifestOverridesMatch(
  manifest: RunManifestV1,
  input: ResearchRunCompletionReceiptInputV1,
): void {
  if (input.manifest !== undefined) {
    const parsed = parseEmbeddedRunManifestCandidateV1(input.manifest);
    if (!parsed.ok) {
      throw new TypeError(`artifact manifest is invalid: ${parsed.error.message}`);
    }
    if (canonicalJson(parsed.value) !== canonicalJson(manifest)) {
      throw new TypeError(
        "manifest override must canonically equal the embedded artifactManifest",
      );
    }
  }
  if (input.sourceManifest !== undefined) {
    const sources = manifestSources(input.sourceManifest);
    if (canonicalJson(sources) !== canonicalJson(manifest.sources)) {
      throw new TypeError(
        "sourceManifest override must canonically equal the embedded manifest sources",
      );
    }
  }
  if (input.artifactManifest !== undefined) {
    const artifacts = manifestArtifacts(input.artifactManifest);
    if (canonicalJson(artifacts) !== canonicalJson(manifest.artifacts)) {
      throw new TypeError(
        "artifactManifest override must canonically equal the embedded manifest artifacts",
      );
    }
  }
}

function assertScalarProvenanceOverridesMatch(
  run: ResearchRunV1,
  input: ResearchRunCompletionReceiptInputV1,
): void {
  const canonical = {
    familiarId: run.execution.modelBinding.familiarId,
    runtime: run.execution.modelExecution,
    startedAt: run.createdAt,
    completedAt: run.updatedAt,
  };
  for (const [field, expected] of Object.entries(canonical)) {
    const supplied = input[field as keyof ResearchRunCompletionReceiptInputV1];
    if (supplied !== undefined && supplied !== expected) {
      throw new TypeError(`${field} override must match the canonical ResearchRun`);
    }
  }
}

function manifestSources(value: unknown): RunManifestSourceV1[] {
  const parsed = parseRunManifestSourcesV1(value, "sourceManifest");
  if (!parsed.ok) {
    throw new TypeError(`sourceManifest is invalid at ${parsed.error.path}: ${parsed.error.message}`);
  }
  return copyCanonicalJsonValue(parsed.value);
}

function manifestArtifacts(value: unknown): ArtifactRegistrationV1[] {
  const parsed = parseRunManifestArtifactsV1(value, "artifactManifest");
  if (!parsed.ok) {
    throw new TypeError(
      `artifactManifest is invalid at ${parsed.error.path}: ${parsed.error.message}`,
    );
  }
  return copyCanonicalJsonValue(parsed.value);
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
  const validatedRun = validatedRunForReceipt(run);
  const manifest = validatedRun.artifactManifest;
  assertScalarProvenanceOverridesMatch(validatedRun, input);
  assertManifestOverridesMatch(manifest, input);
  const authority = input.authority
    ? validateResearchRunAuthorityState(input.authority)
    : createResearchRunAuthorityState();
  if (hasOwn(input as Record<string, unknown>, "grantsExercised")) {
    throw new TypeError("grantsExercised cannot override validated authority state");
  }
  const grants = authority.grants.filter((grant) => grant.exercised === true);
  const sourceManifest = manifestSources(manifest.sources);
  const artifactManifest = manifestArtifacts(manifest.artifacts);
  const citationCount = input.citationCount ?? 0;
  safeNonNegativeInteger(citationCount, "citationCount");

  const familiarId = validatedRun.execution.modelBinding.familiarId;
  const skillId = input.skillId ?? "research";
  const skillVersion = input.skillVersion ?? "unknown";
  const runtime = validatedRun.execution.modelExecution;
  const startedAt = validatedRun.createdAt;
  const completedAt = validatedRun.updatedAt;
  const unsigned: Omit<ResearchRunCompletionReceiptV1, "integrityDigest"> = {
    schema: RESEARCH_RUN_RECEIPT_SCHEMA,
    runId: safeRunId(validatedRun.id),
    familiarId: text(familiarId, "familiarId"),
    skillId: text(skillId, "skillId"),
    skillVersion: text(skillVersion, "skillVersion"),
    runtime: text(runtime, "runtime"),
    createdAt: utcText(validatedRun.createdAt, "createdAt"),
    startedAt: utcText(startedAt, "startedAt"),
    completedAt: utcText(completedAt, "completedAt"),
    planRevisionHistory: normalizePlanHistory(input.planRevisionHistory, validatedRun.createdAt),
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
      (grant, index) => {
        const normalized = normalizeGrant(grant, `grantsExercised[${index}]`);
        if (normalized.exercised !== true) {
          throw new TypeError(`grantsExercised[${index}].exercised must be true`);
        }
        return normalized;
      },
    ),
    sourceManifest: manifestSources(copied.sourceManifest),
    artifactManifest: manifestArtifacts(copied.artifactManifest),
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
