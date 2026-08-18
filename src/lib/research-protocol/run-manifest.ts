import {
  compareUtcTimestamps,
  copyProtocolJsonValue,
  fail,
  isOpaqueId,
  isRecord,
  isSha256,
  isUtcTimestamp,
  parseResearchContextBindingV1,
  pass,
  retentionDoesNotExceed,
  RETENTION_ORDER,
  utcTimestampPlusDays,
  type ProtocolParseResult,
  type ResearchContextBindingV1,
  type RetentionPolicyV1,
  type UnknownFields,
} from "./common.ts";
import { canonicalJson, digestProtocolObject } from "./digest.ts";
import {
  parseResearchModelReceiptV1,
  type ResearchModelReceiptV1,
} from "./topic-discovery.ts";

const RUN_MANIFEST_SCHEMA = "opencoven.run-manifest/v1";
const RUN_MANIFEST_SCHEMA_RE = /^opencoven\.run-manifest\/v(\d+)$/;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const SOURCE_KINDS = ["context-pack", "public-evidence"] as const;
const CONTEXT_AVAILABILITY = ["device-local"] as const;
const ARTIFACT_PLACEMENTS = ["device-local", "cloud-metadata", "cloud-content"] as const;
const CONTENT_SYNCS = ["not-requested", "pending", "synced", "failed"] as const;
const TASK_PHASES = ["scope", "challenge", "synthesize", "control"] as const;
const RETENTION_POLICIES = ["run-only", "7-days", "project"] as const;
const RETENTION_STATUSES = ["active", "deletion_scheduled", "deletion_pending", "deleted"] as const;
const DELETION_STATUSES = ["not_scheduled", "scheduled", "pending", "completed", "partial_failure"] as const;
const MANIFEST_STATES = ["assembling", "final"] as const;
const COMPLETENESS_VALUES = ["complete", "partial", "unreported"] as const;

/** V1 USD wire numbers compare within one billionth of a dollar. */
export const USD_AGGREGATE_TOLERANCE = 1e-9;

const ARTIFACT_TITLE_URI_SCHEME_PREFIX_RE = /^[A-Z][A-Z0-9+.-]*:/i;
const ARTIFACT_TITLE_SECRET_RE = /(?:sk-|ghp_|github_pat_)/;
const ARTIFACT_TITLE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const SENSITIVE_KEY_SEPARATOR_RE = /[._\s-]+/g;
const FORBIDDEN_SENSITIVE_KEYS = new Set([
  "excerpt",
  "privateexcerpt",
  "text",
  "content",
  "blob",
  "filename",
  "localpath",
  "filepath",
  "path",
  "credential",
  "credentials",
  "secret",
  "objectkey",
  "storagekey",
  "bucketkey",
  "deletedcontent",
]);

function normalizeSensitiveKey(key: string): string {
  return key
    .replace(/[A-Z]/g, (character) => character.toLowerCase())
    .replace(SENSITIVE_KEY_SEPARATOR_RE, "");
}

export type ArtifactRegistrationV1 = {
  id: string;
  kind: string;
  title: string;
  mediaType: string;
  digest: string;
  bytes: number;
  placement: "device-local" | "cloud-metadata" | "cloud-content";
  contentSync: "not-requested" | "pending" | "synced" | "failed";
  createdAt: string;
} & UnknownFields;

export type RunManifestSourceV1 =
  | ({
      kind: "context-pack";
      id: string;
      digest: string;
      availability: "device-local";
    } & UnknownFields)
  | ({
      kind: "public-evidence";
      id: string;
      contentDigest: string;
      snapshotDigest: string;
      canonicalUrl: string;
      fetchedAt: string;
    } & UnknownFields);

export type RunManifestModelExecutionV1 = {
  taskId: string;
  phase: "scope" | "challenge" | "synthesize" | "control";
  attempt: number;
  inputDigest: string;
  outputDigest: string;
  receipt: ResearchModelReceiptV1;
} & UnknownFields;

export type RunManifestUsageV1 = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  completeness: "complete" | "partial" | "unreported";
} & UnknownFields;

export type RunManifestRetentionV1 = {
  policy: "run-only" | "7-days" | "project";
  effectivePolicy: "run-only" | "7-days" | "project";
  status: "active" | "deletion_scheduled" | "deletion_pending" | "deleted";
  contentExpiresAt: string | null;
  updatedAt: string;
} & UnknownFields;

export type RunManifestDeletionReceiptV1 = {
  status: "not_scheduled" | "scheduled" | "pending" | "completed" | "partial_failure";
  requestedAt?: string;
  completedAt?: string;
  deletedObjectCount?: number;
  retainedAuditUntil?: string;
  eventSequence?: number;
} & UnknownFields;

export type RunManifestV1 = {
  schema: "opencoven.run-manifest/v1";
  id: string;
  runId: string;
  digest: string;
  revision: number;
  previousDigest?: string;
  state: "assembling" | "final";
  createdAt: string;
  finalizedAt?: string;
  context?: ResearchContextBindingV1;
  sources: RunManifestSourceV1[];
  artifacts: ArtifactRegistrationV1[];
  modelExecutions: RunManifestModelExecutionV1[];
  usage: RunManifestUsageV1;
  retention: RunManifestRetentionV1;
  deletion: RunManifestDeletionReceiptV1;
} & UnknownFields;

export type ManifestRevisionOptions = {
  freshConsent?: boolean;
  contextConsent?: RetentionPolicyV1;
};

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function indexPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateSensitiveObjectKeys(
  value: unknown,
  path: string,
): ProtocolParseResult<void> {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nested = validateSensitiveObjectKeys(entry, indexPath(path, index));
      if (!nested.ok) return nested;
    }
    return pass(undefined);
  }
  if (!isRecord(value)) return pass(undefined);

  for (const key of Object.keys(value)) {
    const keyPath = childPath(path, key);
    if (FORBIDDEN_SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
      return fail(
        "semantic_conflict",
        keyPath,
        `Sensitive manifest objects must not contain ${key}`,
      );
    }
    const nested = validateSensitiveObjectKeys(value[key], keyPath);
    if (!nested.ok) return nested;
  }
  return pass(undefined);
}

function parseObject(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return fail("invalid_type", path, "Expected an object");
  }
  return pass(value);
}

function parseRequiredField(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<unknown> {
  if (!hasOwn(record, key)) {
    return fail("missing_field", childPath(path, key), `Missing required field ${key}`);
  }
  return pass(record[key]);
}

function parseString(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  return pass(value);
}

function parseEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  label: string,
): ProtocolParseResult<T[number]> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!allowed.includes(value as T[number])) {
    return fail("invalid_value", path, `${label} must be one of ${allowed.join(", ")}`);
  }
  return pass(value as T[number]);
}

function parseSchema(value: unknown, path: string): ProtocolParseResult<"opencoven.run-manifest/v1"> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, "schema must be a string");
  }
  if (value === RUN_MANIFEST_SCHEMA) {
    return pass(RUN_MANIFEST_SCHEMA);
  }
  const match = RUN_MANIFEST_SCHEMA_RE.exec(value);
  if (match) {
    return fail("unknown_major", path, `Unsupported schema major v${match[1]}`);
  }
  return fail("invalid_value", path, `schema must equal ${RUN_MANIFEST_SCHEMA}`);
}

function parseSafeIntegerInRange(
  value: unknown,
  path: string,
  label: string,
  minimum: number,
  maximum: number,
): ProtocolParseResult<number> {
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    return fail("invalid_value", path, `${label} must be a safe integer`);
  }
  if (value < minimum || value > maximum) {
    return fail("invalid_value", path, `${label} must be between ${minimum} and ${maximum}`);
  }
  return pass(value);
}

function parsePositiveSafeInteger(value: unknown, path: string, label: string): ProtocolParseResult<number> {
  return parseSafeIntegerInRange(value, path, label, 1, MAX_SAFE_INTEGER);
}

function parseNullableSafeInteger(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number | null> {
  if (value === null) return pass(null);
  return parseSafeIntegerInRange(value, path, label, 0, MAX_SAFE_INTEGER);
}

function parseNonNegativeFiniteNumber(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number> {
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number`);
  }
  if (!Number.isFinite(value) || value < 0) {
    return fail("invalid_value", path, `${label} must be a finite number >= 0`);
  }
  return pass(value);
}

function parseNullableNonNegativeFiniteNumber(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<number | null> {
  if (value === null) return pass(null);
  return parseNonNegativeFiniteNumber(value, path, label);
}

function parseOpaqueIdentifier(
  value: unknown,
  prefix: string,
  path: string,
  label: string,
): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isOpaqueId(value, prefix)) {
    return fail("invalid_value", path, `${label} must match ${prefix}_...`);
  }
  return pass(value);
}

function parseSha256(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isSha256(value)) {
    return fail("invalid_value", path, `${label} must be a lowercase SHA-256 digest`);
  }
  return pass(value);
}

function parseUtc(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isUtcTimestamp(value)) {
    return fail("invalid_value", path, `${label} must be a UTC RFC 3339 timestamp`);
  }
  return pass(value);
}

function parseNullableUtc(value: unknown, path: string, label: string): ProtocolParseResult<string | null> {
  if (value === null) return pass(null);
  return parseUtc(value, path, label);
}

function parseArtifactTitle(value: unknown, path: string): ProtocolParseResult<string> {
  const title = parseString(value, path, "title");
  if (!title.ok) return title;
  if (
    title.value.includes("/") ||
    title.value.includes("\\") ||
    ARTIFACT_TITLE_URI_SCHEME_PREFIX_RE.test(title.value) ||
    ARTIFACT_TITLE_CONTROL_RE.test(title.value) ||
    ARTIFACT_TITLE_SECRET_RE.test(title.value)
  ) {
    return fail(
      "invalid_value",
      path,
      "title must not contain paths, URI schemes, control characters, or known secret prefixes",
    );
  }
  return title;
}

function parseSource(value: unknown, path: string): ProtocolParseResult<RunManifestSourceV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const kindField = parseRequiredField(object.value, "kind", path);
  if (!kindField.ok) return kindField;
  const kind = parseEnumValue(kindField.value, SOURCE_KINDS, childPath(path, "kind"), "kind");
  if (!kind.ok) return kind;

  const idField = parseRequiredField(object.value, "id", path);
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(
    idField.value,
    kind.value === "context-pack" ? "ctx" : "evidence",
    childPath(path, "id"),
    "id",
  );
  if (!id.ok) return id;

  if (kind.value === "context-pack") {
    const safeKeys = validateSensitiveObjectKeys(object.value, path);
    if (!safeKeys.ok) return safeKeys;

    const digestField = parseRequiredField(object.value, "digest", path);
    if (!digestField.ok) return digestField;
    const digest = parseSha256(digestField.value, childPath(path, "digest"), "digest");
    if (!digest.ok) return digest;

    const availabilityField = parseRequiredField(object.value, "availability", path);
    if (!availabilityField.ok) return availabilityField;
    const availability = parseEnumValue(
      availabilityField.value,
      CONTEXT_AVAILABILITY,
      childPath(path, "availability"),
      "availability",
    );
    if (!availability.ok) return availability;

    return pass({
      ...object.value,
      kind: kind.value,
      id: id.value,
      digest: digest.value,
      availability: availability.value,
    });
  }

  const contentDigestField = parseRequiredField(object.value, "contentDigest", path);
  if (!contentDigestField.ok) return contentDigestField;
  const contentDigest = parseSha256(
    contentDigestField.value,
    childPath(path, "contentDigest"),
    "contentDigest",
  );
  if (!contentDigest.ok) return contentDigest;

  const snapshotDigestField = parseRequiredField(object.value, "snapshotDigest", path);
  if (!snapshotDigestField.ok) return snapshotDigestField;
  const snapshotDigest = parseSha256(
    snapshotDigestField.value,
    childPath(path, "snapshotDigest"),
    "snapshotDigest",
  );
  if (!snapshotDigest.ok) return snapshotDigest;

  const canonicalUrlField = parseRequiredField(object.value, "canonicalUrl", path);
  if (!canonicalUrlField.ok) return canonicalUrlField;
  const canonicalUrl = parseString(
    canonicalUrlField.value,
    childPath(path, "canonicalUrl"),
    "canonicalUrl",
  );
  if (!canonicalUrl.ok) return canonicalUrl;

  const fetchedAtField = parseRequiredField(object.value, "fetchedAt", path);
  if (!fetchedAtField.ok) return fetchedAtField;
  const fetchedAt = parseUtc(fetchedAtField.value, childPath(path, "fetchedAt"), "fetchedAt");
  if (!fetchedAt.ok) return fetchedAt;

  return pass({
    ...object.value,
    kind: kind.value,
    id: id.value,
    contentDigest: contentDigest.value,
    snapshotDigest: snapshotDigest.value,
    canonicalUrl: canonicalUrl.value,
    fetchedAt: fetchedAt.value,
  });
}

function parseArtifact(value: unknown, path: string): ProtocolParseResult<ArtifactRegistrationV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;
  const safeKeys = validateSensitiveObjectKeys(object.value, path);
  if (!safeKeys.ok) return safeKeys;

  const idField = parseRequiredField(object.value, "id", path);
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "artifact", childPath(path, "id"), "id");
  if (!id.ok) return id;

  const kindField = parseRequiredField(object.value, "kind", path);
  if (!kindField.ok) return kindField;
  const kind = parseString(kindField.value, childPath(path, "kind"), "kind");
  if (!kind.ok) return kind;

  const titleField = parseRequiredField(object.value, "title", path);
  if (!titleField.ok) return titleField;
  const title = parseArtifactTitle(titleField.value, childPath(path, "title"));
  if (!title.ok) return title;

  const mediaTypeField = parseRequiredField(object.value, "mediaType", path);
  if (!mediaTypeField.ok) return mediaTypeField;
  const mediaType = parseString(mediaTypeField.value, childPath(path, "mediaType"), "mediaType");
  if (!mediaType.ok) return mediaType;

  const digestField = parseRequiredField(object.value, "digest", path);
  if (!digestField.ok) return digestField;
  const digest = parseSha256(digestField.value, childPath(path, "digest"), "digest");
  if (!digest.ok) return digest;

  const bytesField = parseRequiredField(object.value, "bytes", path);
  if (!bytesField.ok) return bytesField;
  const bytes = parseSafeIntegerInRange(
    bytesField.value,
    childPath(path, "bytes"),
    "bytes",
    0,
    MAX_SAFE_INTEGER,
  );
  if (!bytes.ok) return bytes;

  const placementField = parseRequiredField(object.value, "placement", path);
  if (!placementField.ok) return placementField;
  const placement = parseEnumValue(
    placementField.value,
    ARTIFACT_PLACEMENTS,
    childPath(path, "placement"),
    "placement",
  );
  if (!placement.ok) return placement;

  const contentSyncField = parseRequiredField(object.value, "contentSync", path);
  if (!contentSyncField.ok) return contentSyncField;
  const contentSync = parseEnumValue(
    contentSyncField.value,
    CONTENT_SYNCS,
    childPath(path, "contentSync"),
    "contentSync",
  );
  if (!contentSync.ok) return contentSync;
  if (placement.value === "cloud-content" && contentSync.value === "not-requested") {
    return fail(
      "semantic_conflict",
      childPath(path, "contentSync"),
      "cloud-content artifacts require content synchronization to be requested",
    );
  }

  const createdAtField = parseRequiredField(object.value, "createdAt", path);
  if (!createdAtField.ok) return createdAtField;
  const createdAt = parseUtc(createdAtField.value, childPath(path, "createdAt"), "createdAt");
  if (!createdAt.ok) return createdAt;

  return pass({
    ...object.value,
    id: id.value,
    kind: kind.value,
    title: title.value,
    mediaType: mediaType.value,
    digest: digest.value,
    bytes: bytes.value,
    placement: placement.value,
    contentSync: contentSync.value,
    createdAt: createdAt.value,
  });
}

function parseModelExecution(
  value: unknown,
  path: string,
): ProtocolParseResult<RunManifestModelExecutionV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const taskIdField = parseRequiredField(object.value, "taskId", path);
  if (!taskIdField.ok) return taskIdField;
  const taskId = parseOpaqueIdentifier(taskIdField.value, "modeltask", childPath(path, "taskId"), "taskId");
  if (!taskId.ok) return taskId;

  const phaseField = parseRequiredField(object.value, "phase", path);
  if (!phaseField.ok) return phaseField;
  const phase = parseEnumValue(phaseField.value, TASK_PHASES, childPath(path, "phase"), "phase");
  if (!phase.ok) return phase;

  const attemptField = parseRequiredField(object.value, "attempt", path);
  if (!attemptField.ok) return attemptField;
  const attempt = parsePositiveSafeInteger(attemptField.value, childPath(path, "attempt"), "attempt");
  if (!attempt.ok) return attempt;

  const inputDigestField = parseRequiredField(object.value, "inputDigest", path);
  if (!inputDigestField.ok) return inputDigestField;
  const inputDigest = parseSha256(
    inputDigestField.value,
    childPath(path, "inputDigest"),
    "inputDigest",
  );
  if (!inputDigest.ok) return inputDigest;

  const outputDigestField = parseRequiredField(object.value, "outputDigest", path);
  if (!outputDigestField.ok) return outputDigestField;
  const outputDigest = parseSha256(
    outputDigestField.value,
    childPath(path, "outputDigest"),
    "outputDigest",
  );
  if (!outputDigest.ok) return outputDigest;

  const receiptField = parseRequiredField(object.value, "receipt", path);
  if (!receiptField.ok) return receiptField;
  const receipt = parseResearchModelReceiptV1(receiptField.value, childPath(path, "receipt"));
  if (!receipt.ok) return receipt;

  return pass({
    ...object.value,
    taskId: taskId.value,
    phase: phase.value,
    attempt: attempt.value,
    inputDigest: inputDigest.value,
    outputDigest: outputDigest.value,
    receipt: receipt.value,
  });
}

function parseUsage(value: unknown, path: string): ProtocolParseResult<RunManifestUsageV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const inputTokensField = parseRequiredField(object.value, "inputTokens", path);
  if (!inputTokensField.ok) return inputTokensField;
  const inputTokens = parseNullableSafeInteger(
    inputTokensField.value,
    childPath(path, "inputTokens"),
    "inputTokens",
  );
  if (!inputTokens.ok) return inputTokens;

  const outputTokensField = parseRequiredField(object.value, "outputTokens", path);
  if (!outputTokensField.ok) return outputTokensField;
  const outputTokens = parseNullableSafeInteger(
    outputTokensField.value,
    childPath(path, "outputTokens"),
    "outputTokens",
  );
  if (!outputTokens.ok) return outputTokens;

  const costUsdField = parseRequiredField(object.value, "costUsd", path);
  if (!costUsdField.ok) return costUsdField;
  const costUsd = parseNullableNonNegativeFiniteNumber(
    costUsdField.value,
    childPath(path, "costUsd"),
    "costUsd",
  );
  if (!costUsd.ok) return costUsd;

  const completenessField = parseRequiredField(object.value, "completeness", path);
  if (!completenessField.ok) return completenessField;
  const completeness = parseEnumValue(
    completenessField.value,
    COMPLETENESS_VALUES,
    childPath(path, "completeness"),
    "completeness",
  );
  if (!completeness.ok) return completeness;

  return pass({
    ...object.value,
    inputTokens: inputTokens.value,
    outputTokens: outputTokens.value,
    costUsd: costUsd.value,
    completeness: completeness.value,
  });
}

function parseRetention(value: unknown, path: string): ProtocolParseResult<RunManifestRetentionV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const policyField = parseRequiredField(object.value, "policy", path);
  if (!policyField.ok) return policyField;
  const policy = parseEnumValue(policyField.value, RETENTION_POLICIES, childPath(path, "policy"), "policy");
  if (!policy.ok) return policy;

  const effectivePolicyField = parseRequiredField(object.value, "effectivePolicy", path);
  if (!effectivePolicyField.ok) return effectivePolicyField;
  const effectivePolicy = parseEnumValue(
    effectivePolicyField.value,
    RETENTION_POLICIES,
    childPath(path, "effectivePolicy"),
    "effectivePolicy",
  );
  if (!effectivePolicy.ok) return effectivePolicy;

  const statusField = parseRequiredField(object.value, "status", path);
  if (!statusField.ok) return statusField;
  const status = parseEnumValue(
    statusField.value,
    RETENTION_STATUSES,
    childPath(path, "status"),
    "status",
  );
  if (!status.ok) return status;

  const contentExpiresAtField = parseRequiredField(object.value, "contentExpiresAt", path);
  if (!contentExpiresAtField.ok) return contentExpiresAtField;
  const contentExpiresAt = parseNullableUtc(
    contentExpiresAtField.value,
    childPath(path, "contentExpiresAt"),
    "contentExpiresAt",
  );
  if (!contentExpiresAt.ok) return contentExpiresAt;

  const updatedAtField = parseRequiredField(object.value, "updatedAt", path);
  if (!updatedAtField.ok) return updatedAtField;
  const updatedAt = parseUtc(updatedAtField.value, childPath(path, "updatedAt"), "updatedAt");
  if (!updatedAt.ok) return updatedAt;

  return pass({
    ...object.value,
    policy: policy.value,
    effectivePolicy: effectivePolicy.value,
    status: status.value,
    contentExpiresAt: contentExpiresAt.value,
    updatedAt: updatedAt.value,
  });
}

function parseDeletion(
  value: unknown,
  path: string,
): ProtocolParseResult<RunManifestDeletionReceiptV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;
  const safeKeys = validateSensitiveObjectKeys(object.value, path);
  if (!safeKeys.ok) return safeKeys;

  const statusField = parseRequiredField(object.value, "status", path);
  if (!statusField.ok) return statusField;
  const status = parseEnumValue(
    statusField.value,
    DELETION_STATUSES,
    childPath(path, "status"),
    "status",
  );
  if (!status.ok) return status;

  let requestedAt: string | undefined;
  if (hasOwn(object.value, "requestedAt")) {
    const parsed = parseUtc(object.value.requestedAt, childPath(path, "requestedAt"), "requestedAt");
    if (!parsed.ok) return parsed;
    requestedAt = parsed.value;
  }

  let completedAt: string | undefined;
  if (hasOwn(object.value, "completedAt")) {
    const parsed = parseUtc(object.value.completedAt, childPath(path, "completedAt"), "completedAt");
    if (!parsed.ok) return parsed;
    completedAt = parsed.value;
  }

  let deletedObjectCount: number | undefined;
  if (hasOwn(object.value, "deletedObjectCount")) {
    const parsed = parseSafeIntegerInRange(
      object.value.deletedObjectCount,
      childPath(path, "deletedObjectCount"),
      "deletedObjectCount",
      0,
      MAX_SAFE_INTEGER,
    );
    if (!parsed.ok) return parsed;
    deletedObjectCount = parsed.value;
  }

  let retainedAuditUntil: string | undefined;
  if (hasOwn(object.value, "retainedAuditUntil")) {
    const parsed = parseUtc(
      object.value.retainedAuditUntil,
      childPath(path, "retainedAuditUntil"),
      "retainedAuditUntil",
    );
    if (!parsed.ok) return parsed;
    retainedAuditUntil = parsed.value;
  }

  let eventSequence: number | undefined;
  if (hasOwn(object.value, "eventSequence")) {
    const parsed = parsePositiveSafeInteger(
      object.value.eventSequence,
      childPath(path, "eventSequence"),
      "eventSequence",
    );
    if (!parsed.ok) return parsed;
    eventSequence = parsed.value;
  }

  return pass({
    ...object.value,
    status: status.value,
    ...(typeof requestedAt === "string" ? { requestedAt } : {}),
    ...(typeof completedAt === "string" ? { completedAt } : {}),
    ...(typeof deletedObjectCount === "number" ? { deletedObjectCount } : {}),
    ...(typeof retainedAuditUntil === "string" ? { retainedAuditUntil } : {}),
    ...(typeof eventSequence === "number" ? { eventSequence } : {}),
  });
}

function validateRetentionDeletionPair(
  retention: RunManifestRetentionV1,
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  const valid =
    (retention.status === "active" && deletion.status === "not_scheduled") ||
    (retention.status === "deletion_scheduled" && deletion.status === "scheduled") ||
    (retention.status === "deletion_pending" &&
      (deletion.status === "pending" || deletion.status === "partial_failure")) ||
    (retention.status === "deleted" && deletion.status === "completed");
  if (!valid) {
    return fail(
      "semantic_conflict",
      "$.retention.status",
      `retention status ${retention.status} is incompatible with deletion status ${deletion.status}`,
    );
  }
  return pass(undefined);
}

function validateDeletionRequirements(
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  if (
    (deletion.status === "scheduled" ||
      deletion.status === "pending" ||
      deletion.status === "partial_failure") &&
    !hasOwn(deletion, "requestedAt")
  ) {
    return fail("missing_field", "$.deletion.requestedAt", "Deletion status requires requestedAt");
  }
  if (deletion.status === "completed") {
    for (const key of ["requestedAt", "completedAt", "deletedObjectCount", "eventSequence"] as const) {
      if (!hasOwn(deletion, key)) {
        return fail("missing_field", `$.deletion.${key}`, `Completed deletion requires ${key}`);
      }
    }
  }
  return pass(undefined);
}

function validateRetentionClock(
  retention: RunManifestRetentionV1,
): ProtocolParseResult<void> {
  if (retention.status === "active" && retention.contentExpiresAt !== null) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "active retention must not have contentExpiresAt",
    );
  }
  if (retention.status !== "active" && retention.contentExpiresAt === null) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "scheduled or completed deletion requires contentExpiresAt",
    );
  }
  return pass(undefined);
}

function validateManifestChronology(
  createdAt: string,
  finalizedAt: string | undefined,
  sources: readonly RunManifestSourceV1[],
  artifacts: readonly ArtifactRegistrationV1[],
  retention: RunManifestRetentionV1,
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  if (finalizedAt !== undefined && compareUtcTimestamps(finalizedAt, createdAt) < 0) {
    return fail(
      "semantic_conflict",
      "$.finalizedAt",
      "finalizedAt must not precede manifest createdAt",
    );
  }
  for (const [index, source] of sources.entries()) {
    if (source.kind !== "public-evidence") continue;
    const path = `$.sources[${index}].fetchedAt`;
    if (compareUtcTimestamps(source.fetchedAt, createdAt) < 0) {
      return fail(
        "semantic_conflict",
        path,
        "source fetchedAt must not precede manifest createdAt",
      );
    }
    if (
      finalizedAt !== undefined &&
      compareUtcTimestamps(source.fetchedAt, finalizedAt) > 0
    ) {
      return fail(
        "semantic_conflict",
        path,
        "final source fetchedAt must not follow manifest finalizedAt",
      );
    }
  }
  for (const [index, artifact] of artifacts.entries()) {
    const path = `$.artifacts[${index}].createdAt`;
    if (compareUtcTimestamps(artifact.createdAt, createdAt) < 0) {
      return fail(
        "semantic_conflict",
        path,
        "artifact createdAt must not precede manifest createdAt",
      );
    }
    if (
      finalizedAt !== undefined &&
      compareUtcTimestamps(artifact.createdAt, finalizedAt) > 0
    ) {
      return fail(
        "semantic_conflict",
        path,
        "final artifact createdAt must not follow manifest finalizedAt",
      );
    }
  }
  if (compareUtcTimestamps(retention.updatedAt, createdAt) < 0) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "retention.updatedAt must not precede manifest createdAt",
    );
  }
  if (
    retention.contentExpiresAt !== null &&
    compareUtcTimestamps(retention.contentExpiresAt, createdAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "retention.contentExpiresAt must not precede manifest createdAt",
    );
  }

  for (const key of ["requestedAt", "completedAt", "retainedAuditUntil"] as const) {
    const timestamp = deletion[key];
    if (timestamp !== undefined && compareUtcTimestamps(timestamp, createdAt) < 0) {
      return fail(
        "semantic_conflict",
        `$.deletion.${key}`,
        `deletion.${key} must not precede manifest createdAt`,
      );
    }
  }
  if (
    deletion.completedAt !== undefined &&
    deletion.requestedAt !== undefined &&
    compareUtcTimestamps(deletion.completedAt, deletion.requestedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.completedAt",
      "deletion.completedAt must not precede deletion.requestedAt",
    );
  }
  if (
    deletion.requestedAt !== undefined &&
    compareUtcTimestamps(deletion.requestedAt, retention.updatedAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "deletion.requestedAt must not follow retention.updatedAt",
    );
  }
  if (
    deletion.completedAt !== undefined &&
    compareUtcTimestamps(deletion.completedAt, retention.updatedAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.completedAt",
      "deletion.completedAt must not follow retention.updatedAt",
    );
  }

  if (
    retention.status === "deletion_scheduled" &&
    retention.contentExpiresAt !== null &&
    compareUtcTimestamps(retention.contentExpiresAt, retention.updatedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "scheduled contentExpiresAt must not precede retention.updatedAt",
    );
  }
  if (
    retention.status === "deletion_scheduled" &&
    retention.contentExpiresAt !== null &&
    deletion.requestedAt !== undefined &&
    compareUtcTimestamps(deletion.requestedAt, retention.contentExpiresAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "scheduled deletion.requestedAt must not follow contentExpiresAt",
    );
  }
  return pass(undefined);
}

function validateRetentionDeadlineCeiling(
  retention: RunManifestRetentionV1,
): ProtocolParseResult<void> {
  const contentExpiresAt = retention.contentExpiresAt;
  if (!isUtcTimestamp(contentExpiresAt)) {
    return pass(undefined);
  }

  let deadline: string | undefined;
  if (retention.effectivePolicy === "run-only") {
    deadline = retention.updatedAt;
  } else if (retention.effectivePolicy === "7-days") {
    try {
      deadline = utcTimestampPlusDays(retention.updatedAt, 7);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  if (deadline && compareUtcTimestamps(contentExpiresAt, deadline) > 0) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      `contentExpiresAt exceeds the ${retention.effectivePolicy} deadline from retention.updatedAt`,
    );
  }
  return pass(undefined);
}

function validateRetentionShorteningDeadline(
  retention: RunManifestRetentionV1,
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  const requestedAt = deletion.requestedAt;
  if (!isUtcTimestamp(retention.contentExpiresAt) || !isUtcTimestamp(requestedAt)) {
    return pass(undefined);
  }
  if (compareUtcTimestamps(requestedAt, retention.updatedAt) !== 0) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "retention shortening requires requestedAt and retention.updatedAt to identify the same instant",
    );
  }
  return validateRetentionDeadlineCeiling(retention);
}

function manifestDigest(value: unknown): string {
  return digestProtocolObject(value);
}

function canonicalField(record: Record<string, unknown>, key: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && (!descriptor.enumerable || !("value" in descriptor))) {
    return canonicalJson(record);
  }
  return canonicalJson({
    present: Boolean(descriptor),
    ...(descriptor && "value" in descriptor ? { value: descriptor.value } : {}),
  });
}

function sameCanonicalField(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  key: string,
): boolean {
  return canonicalField(previous, key) === canonicalField(next, key);
}

function compareImmutableField(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<void> {
  if (!sameCanonicalField(previous, next, key)) {
    return fail("semantic_conflict", path, `${key} cannot change after finalization`);
  }
  return pass(undefined);
}

function compareTerminalObjectFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  path: string,
): ProtocolParseResult<void> {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (!sameCanonicalField(previous, next, key)) {
      return fail(
        "semantic_conflict",
        childPath(path, key),
        `${key} cannot change after deletion completion`,
      );
    }
  }
  return pass(undefined);
}

const MUTABLE_ROOT_FIELDS = new Set(["digest", "revision", "previousDigest"]);
const MUTABLE_RETENTION_FIELDS = new Set(["effectivePolicy", "status", "contentExpiresAt", "updatedAt"]);
const MUTABLE_DELETION_FIELDS = new Set([
  "status",
  "requestedAt",
  "completedAt",
  "deletedObjectCount",
  "retainedAuditUntil",
  "eventSequence",
]);

function compareUnknownFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  excluded: ReadonlySet<string>,
  path: string,
): ProtocolParseResult<void> {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (excluded.has(key)) continue;
    const result = compareImmutableField(previous, next, key, childPath(path, key));
    if (!result.ok) return result;
  }
  return pass(undefined);
}

function addTokenTotal(current: number | null, value: unknown, label: string, index: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`execution ${index} ${label} must be a non-negative safe integer`);
  }
  const total = (current ?? 0) + value;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`${label} aggregate exceeds Number.MAX_SAFE_INTEGER`);
  }
  return total;
}

function addCostTotal(current: number | null, value: unknown, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`execution ${index} costUsd must be a finite number >= 0`);
  }
  const total = (current ?? 0) + value;
  if (!Number.isFinite(total) || total < 0) {
    throw new RangeError("costUsd aggregate is not a finite non-negative number");
  }
  return total;
}

function usdAggregatesEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= USD_AGGREGATE_TOLERANCE;
}

export function aggregateManifestUsage(
  executions: readonly RunManifestModelExecutionV1[],
): RunManifestUsageV1 {
  if (!Array.isArray(executions)) {
    throw new TypeError("model executions must be an array");
  }

  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let costUsd: number | null = null;
  let anyReported = false;
  let anyMissing = false;

  for (const [index, execution] of executions.entries()) {
    const usage = (execution as RunManifestModelExecutionV1 | null | undefined)?.receipt?.usage;
    if (!isRecord(usage)) {
      throw new TypeError(`execution ${index} has invalid receipt usage`);
    }
    if (usage.inputTokens === null) {
      anyMissing = true;
    } else {
      anyReported = true;
      inputTokens = addTokenTotal(inputTokens, usage.inputTokens, "inputTokens", index);
    }
    if (usage.outputTokens === null) {
      anyMissing = true;
    } else {
      anyReported = true;
      outputTokens = addTokenTotal(outputTokens, usage.outputTokens, "outputTokens", index);
    }
    if (usage.costUsd === null) {
      anyMissing = true;
    } else {
      anyReported = true;
      costUsd = addCostTotal(costUsd, usage.costUsd, index);
    }
  }

  return {
    inputTokens,
    outputTokens,
    costUsd,
    completeness:
      executions.length > 0 && !anyMissing
        ? "complete"
        : anyReported
          ? "partial"
          : "unreported",
  };
}

export function parseRunManifestV1(value: unknown): ProtocolParseResult<RunManifestV1> {
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(schemaField.value, "$.schema");
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "manifest", "$.id", "id");
  if (!id.ok) return id;

  const runIdField = parseRequiredField(object.value, "runId", "$");
  if (!runIdField.ok) return runIdField;
  const runId = parseOpaqueIdentifier(runIdField.value, "run", "$.runId", "runId");
  if (!runId.ok) return runId;

  const digestField = parseRequiredField(object.value, "digest", "$");
  if (!digestField.ok) return digestField;
  const digest = parseSha256(digestField.value, "$.digest", "digest");
  if (!digest.ok) return digest;

  const revisionField = parseRequiredField(object.value, "revision", "$");
  if (!revisionField.ok) return revisionField;
  const revision = parsePositiveSafeInteger(revisionField.value, "$.revision", "revision");
  if (!revision.ok) return revision;

  let previousDigest: string | undefined;
  if (revision.value === 1) {
    if (hasOwn(object.value, "previousDigest")) {
      return fail("semantic_conflict", "$.previousDigest", "revision 1 must not include previousDigest");
    }
  } else {
    if (!hasOwn(object.value, "previousDigest")) {
      return fail("missing_field", "$.previousDigest", "revisions after 1 require previousDigest");
    }
    const parsedPreviousDigest = parseSha256(
      object.value.previousDigest,
      "$.previousDigest",
      "previousDigest",
    );
    if (!parsedPreviousDigest.ok) return parsedPreviousDigest;
    previousDigest = parsedPreviousDigest.value;
  }

  const stateField = parseRequiredField(object.value, "state", "$");
  if (!stateField.ok) return stateField;
  const state = parseEnumValue(stateField.value, MANIFEST_STATES, "$.state", "state");
  if (!state.ok) return state;

  const createdAtField = parseRequiredField(object.value, "createdAt", "$");
  if (!createdAtField.ok) return createdAtField;
  const createdAt = parseUtc(createdAtField.value, "$.createdAt", "createdAt");
  if (!createdAt.ok) return createdAt;

  let finalizedAt: string | undefined;
  if (state.value === "assembling") {
    if (hasOwn(object.value, "finalizedAt")) {
      return fail("semantic_conflict", "$.finalizedAt", "assembling manifests must not include finalizedAt");
    }
  } else {
    const finalizedAtField = parseRequiredField(object.value, "finalizedAt", "$");
    if (!finalizedAtField.ok) return finalizedAtField;
    const parsedFinalizedAt = parseUtc(finalizedAtField.value, "$.finalizedAt", "finalizedAt");
    if (!parsedFinalizedAt.ok) return parsedFinalizedAt;
    finalizedAt = parsedFinalizedAt.value;
  }

  let context: ResearchContextBindingV1 | undefined;
  if (hasOwn(object.value, "context")) {
    const parsedContext = parseResearchContextBindingV1(object.value.context, "$.context");
    if (!parsedContext.ok) return parsedContext;
    context = parsedContext.value;
  }

  const sourcesField = parseRequiredField(object.value, "sources", "$");
  if (!sourcesField.ok) return sourcesField;
  if (!Array.isArray(sourcesField.value)) {
    return fail("invalid_type", "$.sources", "sources must be an array");
  }
  const sources: RunManifestSourceV1[] = [];
  const sourceIds = new Set<string>();
  let contextSourceCount = 0;
  let contextSourceIndex = -1;
  for (const [index, sourceValue] of sourcesField.value.entries()) {
    const sourcePath = indexPath("$.sources", index);
    const source = parseSource(sourceValue, sourcePath);
    if (!source.ok) return source;
    if (sourceIds.has(source.value.id)) {
      return fail("semantic_conflict", childPath(sourcePath, "id"), "source ids must be unique");
    }
    sourceIds.add(source.value.id);
    if (source.value.kind === "context-pack") {
      contextSourceCount += 1;
      contextSourceIndex = index;
    }
    sources.push(source.value);
  }

  const artifactsField = parseRequiredField(object.value, "artifacts", "$");
  if (!artifactsField.ok) return artifactsField;
  if (!Array.isArray(artifactsField.value)) {
    return fail("invalid_type", "$.artifacts", "artifacts must be an array");
  }
  const artifacts: ArtifactRegistrationV1[] = [];
  const artifactIds = new Set<string>();
  for (const [index, artifactValue] of artifactsField.value.entries()) {
    const artifactPath = indexPath("$.artifacts", index);
    const artifact = parseArtifact(artifactValue, artifactPath);
    if (!artifact.ok) return artifact;
    if (artifactIds.has(artifact.value.id)) {
      return fail("semantic_conflict", childPath(artifactPath, "id"), "artifact ids must be unique");
    }
    artifactIds.add(artifact.value.id);
    artifacts.push(artifact.value);
  }

  const modelExecutionsField = parseRequiredField(object.value, "modelExecutions", "$");
  if (!modelExecutionsField.ok) return modelExecutionsField;
  if (!Array.isArray(modelExecutionsField.value)) {
    return fail("invalid_type", "$.modelExecutions", "modelExecutions must be an array");
  }
  const modelExecutions: RunManifestModelExecutionV1[] = [];
  const executionPairs = new Set<string>();
  for (const [index, executionValue] of modelExecutionsField.value.entries()) {
    const executionPath = indexPath("$.modelExecutions", index);
    const execution = parseModelExecution(executionValue, executionPath);
    if (!execution.ok) return execution;
    const pair = `${execution.value.taskId}\u0000${execution.value.attempt}`;
    if (executionPairs.has(pair)) {
      return fail("semantic_conflict", executionPath, "taskId and attempt pairs must be unique");
    }
    executionPairs.add(pair);
    modelExecutions.push(execution.value);
  }

  const usageField = parseRequiredField(object.value, "usage", "$");
  if (!usageField.ok) return usageField;
  const usage = parseUsage(usageField.value, "$.usage");
  if (!usage.ok) return usage;

  const retentionField = parseRequiredField(object.value, "retention", "$");
  if (!retentionField.ok) return retentionField;
  const retention = parseRetention(retentionField.value, "$.retention");
  if (!retention.ok) return retention;

  const deletionField = parseRequiredField(object.value, "deletion", "$");
  if (!deletionField.ok) return deletionField;
  const deletion = parseDeletion(deletionField.value, "$.deletion");
  if (!deletion.ok) return deletion;

  if (context) {
    if (contextSourceCount !== 1) {
      return fail(
        "semantic_conflict",
        "$.sources",
        "context requires exactly one context-pack source",
      );
    }
    const contextSource = sources[contextSourceIndex];
    if (
      contextSource.kind !== "context-pack" ||
      contextSource.id !== context.contextPackId ||
      contextSource.digest !== context.contextPackDigest
    ) {
      return fail(
        "semantic_conflict",
        indexPath("$.sources", contextSourceIndex),
        "context-pack source must match context id and digest",
      );
    }
  } else if (contextSourceCount > 0) {
    return fail(
      "semantic_conflict",
      indexPath("$.sources", contextSourceIndex),
      "context-less manifests must not contain a context-pack source",
    );
  }

  let expectedUsage: RunManifestUsageV1;
  try {
    expectedUsage = aggregateManifestUsage(modelExecutions);
  } catch (error) {
    return fail(
      "invalid_value",
      "$.usage",
      error instanceof Error ? `usage aggregation failed: ${error.message}` : "usage aggregation failed",
    );
  }
  for (const key of ["inputTokens", "outputTokens", "costUsd", "completeness"] as const) {
    const equal =
      key === "costUsd"
        ? usdAggregatesEqual(usage.value.costUsd, expectedUsage.costUsd)
        : usage.value[key] === expectedUsage[key];
    if (!equal) {
      return fail(
        "semantic_conflict",
        childPath("$.usage", key),
        `usage.${key} must equal the aggregate model execution usage`,
      );
    }
  }

  if (revision.value === 1 && retention.value.effectivePolicy !== retention.value.policy) {
    return fail(
      "semantic_conflict",
      "$.retention.effectivePolicy",
      "revision 1 effectivePolicy must equal policy",
    );
  }

  const pair = validateRetentionDeletionPair(retention.value, deletion.value);
  if (!pair.ok) return pair;
  const deletionRequirements = validateDeletionRequirements(deletion.value);
  if (!deletionRequirements.ok) return deletionRequirements;
  const clock = validateRetentionClock(retention.value);
  if (!clock.ok) return clock;
  const chronology = validateManifestChronology(
    createdAt.value,
    finalizedAt,
    sources,
    artifacts,
    retention.value,
    deletion.value,
  );
  if (!chronology.ok) return chronology;

  let computedDigest: string;
  try {
    computedDigest = manifestDigest(object.value);
  } catch (error) {
    return fail(
      "invalid_value",
      "$.digest",
      error instanceof Error ? error.message : "Manifest is not canonical JSON",
    );
  }
  if (computedDigest !== digest.value) {
    return fail(
      "digest_mismatch",
      "$.digest",
      `digest must equal ${computedDigest}`,
    );
  }

  const parsedManifest = {
    ...object.value,
    schema: schema.value,
    id: id.value,
    runId: runId.value,
    digest: digest.value,
    revision: revision.value,
    ...(typeof previousDigest === "string" ? { previousDigest } : {}),
    state: state.value,
    createdAt: createdAt.value,
    ...(typeof finalizedAt === "string" ? { finalizedAt } : {}),
    ...(context ? { context } : {}),
    sources,
    artifacts,
    modelExecutions,
    usage: usage.value,
    retention: retention.value,
    deletion: deletion.value,
  };
  return pass(parsedManifest as RunManifestV1);
}

export function validateManifestRetentionConsent(
  manifest: RunManifestV1,
  contextConsent: RetentionPolicyV1 | undefined,
): ProtocolParseResult<RunManifestV1> {
  if (!manifest.context) {
    if (!retentionDoesNotExceed(manifest.retention.effectivePolicy, manifest.retention.policy)) {
      return fail(
        "semantic_conflict",
        "$.retention.effectivePolicy",
        "effectivePolicy must not exceed the original policy without a context",
      );
    }
    return pass(manifest);
  }

  if (contextConsent === undefined) {
    return fail(
      "semantic_conflict",
      "$.retention.policy",
      "context consent is required when a manifest has a context binding",
    );
  }
  if (!retentionDoesNotExceed(manifest.retention.policy, contextConsent)) {
    return fail(
      "semantic_conflict",
      "$.retention.policy",
      "retention policy exceeds context consent",
    );
  }
  if (!retentionDoesNotExceed(manifest.retention.effectivePolicy, contextConsent)) {
    return fail(
      "semantic_conflict",
      "$.retention.effectivePolicy",
      "effective retention policy exceeds context consent",
    );
  }
  return pass(manifest);
}

export function validateRunManifestRevision(
  previous: RunManifestV1,
  next: RunManifestV1,
  options: ManifestRevisionOptions = {},
): ProtocolParseResult<RunManifestV1> {
  if (next.revision !== previous.revision + 1) {
    return fail(
      "semantic_conflict",
      "$.revision",
      `revision must equal ${previous.revision + 1}`,
    );
  }
  if (next.previousDigest !== previous.digest) {
    return fail(
      "semantic_conflict",
      "$.previousDigest",
      "previousDigest must equal the preceding manifest digest",
    );
  }
  if (next.id !== previous.id) {
    return fail("semantic_conflict", "$.id", "id cannot change across revisions");
  }
  if (next.runId !== previous.runId) {
    return fail("semantic_conflict", "$.runId", "runId cannot change across revisions");
  }
  if (next.createdAt !== previous.createdAt) {
    return fail("semantic_conflict", "$.createdAt", "createdAt cannot change across revisions");
  }
  if (
    !isUtcTimestamp(previous.retention.updatedAt) ||
    !isUtcTimestamp(next.retention.updatedAt) ||
    compareUtcTimestamps(next.retention.updatedAt, previous.retention.updatedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "retention.updatedAt cannot move backward across revisions",
    );
  }

  let previousDigest: string;
  try {
    previousDigest = manifestDigest(previous);
  } catch (error) {
    return fail(
      "semantic_conflict",
      "$.digest",
      error instanceof Error ? error.message : "previous manifest is not canonical JSON",
    );
  }
  if (previousDigest !== previous.digest) {
    return fail("semantic_conflict", "$.digest", "previous manifest digest is not correct");
  }

  let nextDigest: string;
  try {
    nextDigest = manifestDigest(next);
  } catch (error) {
    return fail(
      "semantic_conflict",
      "$.digest",
      error instanceof Error ? error.message : "next manifest is not canonical JSON",
    );
  }
  if (nextDigest !== next.digest) {
    return fail("semantic_conflict", "$.digest", "next manifest digest is not correct");
  }

  const previousRetention = previous.retention as unknown as Record<string, unknown>;
  const nextRetention = next.retention as unknown as Record<string, unknown>;
  const previousDeletion = previous.deletion as unknown as Record<string, unknown>;
  const nextDeletion = next.deletion as unknown as Record<string, unknown>;
  const policy = compareImmutableField(previousRetention, nextRetention, "policy", "$.retention.policy");
  if (!policy.ok) return policy;

  if (previous.deletion.status === "completed") {
    const receipt = compareTerminalObjectFields(
      previousDeletion,
      nextDeletion,
      "$.deletion",
    );
    if (!receipt.ok) return receipt;
    const deletedRetention = compareTerminalObjectFields(
      previousRetention,
      nextRetention,
      "$.retention",
    );
    if (!deletedRetention.ok) return deletedRetention;
  }

  if (previous.deletion.status === "completed" && next.deletion.status !== "completed") {
    return fail(
      "semantic_conflict",
      "$.deletion.status",
      "completed deletion is terminal",
    );
  }
  if (previous.retention.status === "deleted" && next.retention.status !== "deleted") {
    return fail(
      "semantic_conflict",
      "$.retention.status",
      "deleted retention is terminal",
    );
  }

  if (previous.state === "final") {
    if (next.state !== "final") {
      return fail("semantic_conflict", "$.state", "a final manifest must remain final");
    }
    if (next.finalizedAt !== previous.finalizedAt) {
      return fail(
        "semantic_conflict",
        "$.finalizedAt",
        "finalizedAt cannot change after finalization",
      );
    }

    for (const key of ["schema", "id", "runId", "state", "createdAt", "finalizedAt"] as const) {
      const result = compareImmutableField(previous, next, key, `$.${key}`);
      if (!result.ok) return result;
    }
    for (const key of ["context", "sources", "artifacts", "modelExecutions", "usage"] as const) {
      const result = compareImmutableField(previous, next, key, `$.${key}`);
      if (!result.ok) return result;
    }
    const retentionUnknowns = compareUnknownFields(
      previousRetention,
      nextRetention,
      MUTABLE_RETENTION_FIELDS,
      "$.retention",
    );
    if (!retentionUnknowns.ok) return retentionUnknowns;

    const deletionUnknowns = compareUnknownFields(
      previousDeletion,
      nextDeletion,
      MUTABLE_DELETION_FIELDS,
      "$.deletion",
    );
    if (!deletionUnknowns.ok) return deletionUnknowns;

    const rootUnknowns = compareUnknownFields(
      previous as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      new Set([
        ...MUTABLE_ROOT_FIELDS,
        "schema",
        "id",
        "runId",
        "state",
        "createdAt",
        "finalizedAt",
        "context",
        "sources",
        "artifacts",
        "modelExecutions",
        "usage",
        "retention",
        "deletion",
      ]),
      "$",
    );
    if (!rootUnknowns.ok) return rootUnknowns;
  }

  if (
    previous.state === "final" &&
    RETENTION_ORDER[next.retention.effectivePolicy] <
      RETENTION_ORDER[previous.retention.effectivePolicy]
  ) {
    if (next.retention.status !== "deletion_scheduled") {
      return fail(
        "semantic_conflict",
        "$.retention.status",
        "post-final retention shortening requires deletion_scheduled",
      );
    }
    if (next.deletion.status !== "scheduled") {
      return fail(
        "semantic_conflict",
        "$.deletion.status",
        "post-final retention shortening requires scheduled deletion",
      );
    }
    if (!isUtcTimestamp(next.retention.contentExpiresAt)) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "post-final retention shortening requires a content expiry timestamp",
      );
    }
    if (!isUtcTimestamp(next.retention.updatedAt)) {
      return fail(
        "semantic_conflict",
        "$.retention.updatedAt",
        "post-final retention shortening requires a scheduling update timestamp",
      );
    }
    if (!isUtcTimestamp(next.deletion.requestedAt)) {
      return fail(
        "missing_field",
        "$.deletion.requestedAt",
        "post-final retention shortening requires a deletion request timestamp",
      );
    }
    const deadline = validateRetentionShorteningDeadline(next.retention, next.deletion);
    if (!deadline.ok) return deadline;
  } else {
    const deadline = validateRetentionDeadlineCeiling(next.retention);
    if (!deadline.ok) return deadline;
  }

  if (
    next.retention.effectivePolicy === previous.retention.effectivePolicy &&
    next.retention.effectivePolicy !== "project" &&
    isUtcTimestamp(previous.retention.contentExpiresAt)
  ) {
    if (
      !isUtcTimestamp(next.retention.contentExpiresAt) ||
      compareUtcTimestamps(
        next.retention.contentExpiresAt,
        previous.retention.contentExpiresAt,
      ) > 0
    ) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        `contentExpiresAt cannot be removed or move later while effectivePolicy remains ${next.retention.effectivePolicy}`,
      );
    }
  }

  const consent = validateManifestRetentionConsent(next, options?.contextConsent);
  if (!consent.ok) return consent;

  if (RETENTION_ORDER[next.retention.effectivePolicy] > RETENTION_ORDER[previous.retention.effectivePolicy]) {
    if (options.freshConsent !== true) {
      return fail(
        "semantic_conflict",
        "$.retention.effectivePolicy",
        "lengthening effective retention requires freshConsent",
      );
    }
  }

  return pass(next);
}
