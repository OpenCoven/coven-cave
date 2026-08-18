import {
  compareUtcTimestamps,
  copyProtocolJsonValue,
  fail,
  isOpaqueId,
  isRecord,
  isSha256,
  isUtcTimestamp,
  isUtcTimestampAtMostHoursAfter,
  parseResearchContextBindingV1,
  pass,
  retentionDoesNotExceed,
  RETENTION_ORDER,
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
const RETENTION_DURATION_HOURS = {
  "run-only": 24,
  "7-days": 7 * 24,
} as const;
const RETENTION_STATUSES = ["active", "deletion_scheduled", "deletion_pending", "deleted"] as const;
const DELETION_STATUSES = ["not_scheduled", "scheduled", "pending", "completed", "partial_failure"] as const;
const MANIFEST_STATES = ["assembling", "final"] as const;
const COMPLETENESS_VALUES = ["complete", "partial", "unreported"] as const;

const ARTIFACT_TITLE_URI_SCHEME_PREFIX_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ARTIFACT_TITLE_SECRET_RE = /(?:sk-|ghp_|github_pat_)/;
const ARTIFACT_TITLE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const PRINTABLE_ASCII_PROPERTY_NAME_RE = /^[\u0020-\u007e]*$/;
const FORBIDDEN_NORMALIZED_SENSITIVE_KEYS = new Set([
  "excerpt",
  "excerpts",
  "privateexcerpt",
  "privateexcerpts",
  "rawexcerpt",
  "rawexcerpts",
  "text",
  "texts",
  "content",
  "contents",
  "blob",
  "blobs",
  "filename",
  "filenames",
  "localpath",
  "localpaths",
  "filepath",
  "filepaths",
  "path",
  "paths",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "objectkey",
  "objectkeys",
  "storagekey",
  "storagekeys",
  "bucketkey",
  "bucketkeys",
  "deletedcontent",
  "deletedcontents",
]);

function normalizeSensitiveKey(key: string): string {
  return key.normalize("NFKC").replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
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
  freshConsentAt?: string;
  shortenedAt?: string;
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
  freshConsentAt?: string;
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
    if (
      !PRINTABLE_ASCII_PROPERTY_NAME_RE.test(key)
      || key.normalize("NFKC") !== key
    ) {
      return fail(
        "semantic_conflict",
        keyPath,
        "Sensitive manifest property names must be printable ASCII and NFKC-stable",
      );
    }
    if (FORBIDDEN_NORMALIZED_SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
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

function hasArtifactTitleUriScheme(value: string): boolean {
  const match = ARTIFACT_TITLE_URI_SCHEME_PREFIX_RE.exec(value);
  if (!match) return false;
  const schemeSpecificPart = value.slice(match[0].length);
  return schemeSpecificPart.length === 0 || !/^\s/.test(schemeSpecificPart);
}

function parseArtifactTitle(value: unknown, path: string): ProtocolParseResult<string> {
  const title = parseString(value, path, "title");
  if (!title.ok) return title;
  if (
    title.value.includes("/") ||
    title.value.includes("\\") ||
    hasArtifactTitleUriScheme(title.value) ||
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
  if (placement.value === "cloud-content" && contentSync.value !== "synced") {
    return fail(
      "semantic_conflict",
      childPath(path, "contentSync"),
      "cloud-content artifacts require completed content synchronization",
    );
  }
  if (contentSync.value === "synced" && placement.value !== "cloud-content") {
    return fail(
      "semantic_conflict",
      childPath(path, "placement"),
      "synced artifacts require cloud-content placement",
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

  let freshConsentAt: string | undefined;
  if (hasOwn(object.value, "freshConsentAt")) {
    const parsedFreshConsentAt = parseUtc(
      object.value.freshConsentAt,
      childPath(path, "freshConsentAt"),
      "freshConsentAt",
    );
    if (!parsedFreshConsentAt.ok) return parsedFreshConsentAt;
    freshConsentAt = parsedFreshConsentAt.value;
  }

  let shortenedAt: string | undefined;
  if (hasOwn(object.value, "shortenedAt")) {
    const parsedShortenedAt = parseUtc(
      object.value.shortenedAt,
      childPath(path, "shortenedAt"),
      "shortenedAt",
    );
    if (!parsedShortenedAt.ok) return parsedShortenedAt;
    shortenedAt = parsedShortenedAt.value;
  }

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
    ...(freshConsentAt === undefined ? {} : { freshConsentAt }),
    ...(shortenedAt === undefined ? {} : { shortenedAt }),
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
    if (
      typeof deletion.requestedAt === "string"
      && typeof deletion.completedAt === "string"
      && compareUtcTimestamps(deletion.completedAt, deletion.requestedAt) < 0
    ) {
      return fail(
        "semantic_conflict",
        "$.deletion.completedAt",
        "Completed deletion cannot precede its request",
      );
    }
  }
  return pass(undefined);
}

type RetentionClockManifest = Pick<
  RunManifestV1,
  "revision" | "state" | "finalizedAt" | "retention"
>;

function retentionAuthorityAnchor(manifest: RetentionClockManifest): string {
  const { retention } = manifest;
  if (retention.freshConsentAt !== undefined) return retention.freshConsentAt;
  if (retention.shortenedAt !== undefined) return retention.shortenedAt;
  if (manifest.state !== "final") return retention.updatedAt;
  return manifest.finalizedAt!;
}

function deadlineFitsFiniteAuthority(
  deadline: string,
  manifest: RetentionClockManifest,
): boolean {
  const policy = manifest.retention.effectivePolicy;
  return policy === "project"
    || isUtcTimestampAtMostHoursAfter(
      deadline,
      retentionAuthorityAnchor(manifest),
      RETENTION_DURATION_HOURS[policy],
    );
}

function validateRetentionClock(
  manifest: RetentionClockManifest,
): ProtocolParseResult<void> {
  const { retention } = manifest;
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
      `${retention.status} retention requires contentExpiresAt`,
    );
  }
  if (retention.status === "active" && retention.effectivePolicy === "project" && retention.contentExpiresAt !== null) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "active project retention must not have contentExpiresAt",
    );
  }
  if (!isUtcTimestamp(retention.updatedAt)) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "retention.updatedAt must be a valid UTC timestamp",
    );
  }
  if (
    retention.freshConsentAt !== undefined
    && retention.shortenedAt !== undefined
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.shortenedAt",
      "freshConsentAt and shortenedAt are mutually exclusive current clock markers",
    );
  }
  for (const [key, marker] of [
    ["freshConsentAt", retention.freshConsentAt],
    ["shortenedAt", retention.shortenedAt],
  ] as const) {
    if (marker === undefined) continue;
    if (!isUtcTimestamp(marker)) {
      return fail(
        "semantic_conflict",
        `$.retention.${key}`,
        `retention.${key} must be a valid exact UTC timestamp`,
      );
    }
    if (manifest.state !== "final") {
      return fail(
        "semantic_conflict",
        `$.retention.${key}`,
        `${key} is only valid after manifest finalization`,
      );
    }
    if (manifest.revision === 1) {
      return fail(
        "semantic_conflict",
        `$.retention.${key}`,
        `initial manifests must not include ${key}`,
      );
    }
    if (!isUtcTimestamp(manifest.finalizedAt)) {
      return fail(
        "semantic_conflict",
        "$.finalizedAt",
        `${key} requires a valid finalizedAt timestamp`,
      );
    }
    if (compareUtcTimestamps(marker, manifest.finalizedAt) < 0) {
      return fail(
        "semantic_conflict",
        `$.retention.${key}`,
        `${key} must not precede manifest finalization`,
      );
    }
    if (marker !== retention.updatedAt) {
      return fail(
        "semantic_conflict",
        `$.retention.${key}`,
        `${key} must exactly equal retention.updatedAt`,
      );
    }
  }
  if (retention.shortenedAt !== undefined) {
    if (retention.effectivePolicy === "project") {
      return fail(
        "semantic_conflict",
        "$.retention.shortenedAt",
        "shortenedAt requires a finite effective retention policy",
      );
    }
    if (retention.contentExpiresAt === null) {
      return fail(
        "semantic_conflict",
        "$.retention.shortenedAt",
        "shortenedAt requires a finite content expiration deadline",
      );
    }
  }
  if (
    manifest.state === "final"
    && RETENTION_ORDER[retention.effectivePolicy] < RETENTION_ORDER[retention.policy]
    && retention.freshConsentAt === undefined
    && retention.shortenedAt === undefined
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.shortenedAt",
      "shortened effective retention requires a durable shortenedAt receipt",
    );
  }
  if (
    manifest.state === "final"
    && RETENTION_ORDER[retention.effectivePolicy] > RETENTION_ORDER[retention.policy]
    && retention.freshConsentAt === undefined
    && retention.shortenedAt === undefined
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "lengthened effective retention requires a durable current clock marker",
    );
  }
  if (retention.contentExpiresAt !== null) {
    if (!isUtcTimestamp(retention.contentExpiresAt)) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "content expiration must be a valid UTC timestamp",
      );
    }
    if (
      manifest.state === "final"
      && retention.effectivePolicy !== "project"
      && retention.freshConsentAt === undefined
      && retention.shortenedAt === undefined
      && !isUtcTimestamp(manifest.finalizedAt)
    ) {
      return fail(
        "semantic_conflict",
        "$.finalizedAt",
        "finite final retention requires a valid finalizedAt timestamp",
      );
    }
    const anchor = retentionAuthorityAnchor(manifest);
    if (compareUtcTimestamps(retention.contentExpiresAt, anchor) < 0) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "content expiration must not precede its authoritative retention clock",
      );
    }
    if (!deadlineFitsFiniteAuthority(retention.contentExpiresAt, manifest)) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        `content expiration exceeds the ${retention.effectivePolicy} retention duration`,
      );
    }
  }
  return pass(undefined);
}

function validateRetentionDeadlineRevision(
  previous: RunManifestV1,
  next: RunManifestV1,
  allowFreshConsentCancellation: boolean,
  freshConsentAuthorized: boolean,
): ProtocolParseResult<void> {
  const nextClock = validateRetentionClock(next);
  if (!nextClock.ok) return nextClock;

  const previousDeadline = previous.retention.contentExpiresAt;
  const nextDeadline = next.retention.contentExpiresAt;
  if (previousDeadline !== null && !isUtcTimestamp(previousDeadline)) {
    return fail(
      "semantic_conflict",
      "$.previous.retention.contentExpiresAt",
      "previous content expiration must be a valid UTC timestamp",
    );
  }
  if (nextDeadline !== null && !isUtcTimestamp(nextDeadline)) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "next content expiration must be a valid UTC timestamp",
    );
  }
  if (nextDeadline === null) {
    if (previousDeadline === null) return pass(undefined);
    if (
      allowFreshConsentCancellation
      && next.retention.status === "active"
      && next.deletion.status === "not_scheduled"
    ) {
      return pass(undefined);
    }
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "content expiration cannot be cleared without fresh-consent effective-policy lengthening and coherent deletion cancellation",
    );
  }

  const shortensEffectivePolicy =
    RETENTION_ORDER[next.retention.effectivePolicy]
      < RETENTION_ORDER[previous.retention.effectivePolicy];
  if (shortensEffectivePolicy && next.retention.effectivePolicy !== "project") {
    if (
      next.retention.shortenedAt === undefined
      || compareUtcTimestamps(nextDeadline, next.retention.shortenedAt) < 0
    ) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "shortened content expiration must not precede its transition time",
      );
    }
    if (
      !isUtcTimestampAtMostHoursAfter(
        nextDeadline,
        next.retention.shortenedAt!,
        RETENTION_DURATION_HOURS[next.retention.effectivePolicy],
      )
    ) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        `content expiration exceeds the ${next.retention.effectivePolicy} retention duration from its shortening transition`,
      );
    }
    if (
      previous.state === "final"
      && previous.retention.effectivePolicy !== "project"
      && (
        (previousDeadline !== null
          && compareUtcTimestamps(nextDeadline, previousDeadline) > 0)
        || !deadlineFitsFiniteAuthority(nextDeadline, previous)
      )
    ) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "shortening finite retention cannot exceed its prior deadline or authoritative ceiling",
      );
    }
    return pass(undefined);
  }

  if (
    previous.state === "final"
    && previous.retention.effectivePolicy === next.retention.effectivePolicy
    && next.retention.effectivePolicy !== "project"
    && !freshConsentAuthorized
    && !deadlineFitsFiniteAuthority(nextDeadline, previous)
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "unchanged finite retention cannot exceed its prior authoritative ceiling",
    );
  }

  if (
    previousDeadline !== null
    && compareUtcTimestamps(nextDeadline, previousDeadline) > 0
    && !freshConsentAuthorized
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "moving content expiration later requires durable fresh consent",
    );
  }
  return pass(undefined);
}

function validateFreshConsentRevision(
  previous: RunManifestV1,
  next: RunManifestV1,
  options: ManifestRevisionOptions,
  requiredPath: string,
): ProtocolParseResult<void> {
  if (options.freshConsent !== true) {
    return fail(
      "semantic_conflict",
      requiredPath,
      "retention renewal or lengthening requires freshConsent and freshConsentAt",
    );
  }
  if (!isUtcTimestamp(options.freshConsentAt)) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "freshConsentAt option must be a valid exact UTC timestamp",
    );
  }
  if (next.retention.freshConsentAt !== options.freshConsentAt) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "manifest freshConsentAt must exactly equal the external freshConsentAt option",
    );
  }
  if (next.retention.updatedAt !== options.freshConsentAt) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "retention.updatedAt must exactly equal the external freshConsentAt option",
    );
  }
  if (previous.state !== "final" || !isUtcTimestamp(previous.finalizedAt)) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "fresh retention consent may only be recorded after finalization",
    );
  }
  if (
    compareUtcTimestamps(options.freshConsentAt, previous.finalizedAt) < 0
    || compareUtcTimestamps(options.freshConsentAt, previous.retention.updatedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "freshConsentAt cannot precede finalization or the previous retention update",
    );
  }
  return pass(undefined);
}

function validateDeletionLifecycleTransition(
  previous: RunManifestV1,
  next: RunManifestV1,
  allowFreshConsentCancellation: boolean,
): ProtocolParseResult<void> {
  const pair = validateRetentionDeletionPair(next.retention, next.deletion);
  if (!pair.ok) return pair;

  const previousStatus = previous.deletion.status;
  const nextStatus = next.deletion.status;
  const validForwardTransition =
    previousStatus === "not_scheduled"
    || (previousStatus === "scheduled"
      && ["scheduled", "pending", "partial_failure", "completed"].includes(nextStatus))
    || (previousStatus === "pending"
      && ["pending", "partial_failure", "completed"].includes(nextStatus))
    || (previousStatus === "partial_failure"
      && ["pending", "partial_failure", "completed"].includes(nextStatus))
    || (previousStatus === "completed" && nextStatus === "completed");
  if (validForwardTransition) return pass(undefined);

  if (
    allowFreshConsentCancellation
    && previousStatus !== "completed"
    && next.retention.status === "active"
    && nextStatus === "not_scheduled"
    && next.retention.contentExpiresAt === null
  ) {
    for (const key of [
      "requestedAt",
      "completedAt",
      "deletedObjectCount",
      "retainedAuditUntil",
      "eventSequence",
    ] as const) {
      if (hasOwn(next.deletion, key)) {
        return fail(
          "semantic_conflict",
          `$.deletion.${key}`,
          "Fresh-consent deletion cancellation must clear deletion receipt timing fields",
        );
      }
    }
    return pass(undefined);
  }

  return fail(
    "semantic_conflict",
    "$.deletion.status",
    `deletion status cannot move backward from ${previousStatus} to ${nextStatus}`,
  );
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

const MUTABLE_ROOT_FIELDS = new Set(["digest", "revision", "previousDigest"]);
const MUTABLE_RETENTION_FIELDS = new Set([
  "effectivePolicy",
  "status",
  "contentExpiresAt",
  "freshConsentAt",
  "shortenedAt",
  "updatedAt",
]);
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

type ExactDecimal = {
  coefficient: bigint;
  exponent: number;
};

const BIGINT_ZERO = BigInt(0);
const BIGINT_TEN = BigInt(10);

function normalizeExactDecimal(coefficient: bigint, exponent: number): ExactDecimal {
  if (coefficient === BIGINT_ZERO) return { coefficient: BIGINT_ZERO, exponent: 0 };
  while (coefficient % BIGINT_TEN === BIGINT_ZERO) {
    coefficient /= BIGINT_TEN;
    exponent += 1;
  }
  return { coefficient, exponent };
}

function exactDecimalFromCost(value: unknown, label: string): ExactDecimal {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} costUsd must be a finite number >= 0`);
  }

  // Decimal arithmetic starts from the canonical JSON spelling of each wire number.
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new TypeError(`${label} costUsd has no canonical decimal representation`);
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(serialized);
  if (!match) {
    throw new TypeError(`${label} costUsd has no canonical decimal representation`);
  }
  const fraction = match[2] ?? "";
  return normalizeExactDecimal(
    BigInt(`${match[1]}${fraction}`),
    Number(match[3] ?? 0) - fraction.length,
  );
}

function addExactDecimals(left: ExactDecimal | null, right: ExactDecimal): ExactDecimal {
  if (left === null || left.coefficient === BIGINT_ZERO) return right;
  if (right.coefficient === BIGINT_ZERO) return left;

  const exponent = Math.min(left.exponent, right.exponent);
  const leftCoefficient =
    left.coefficient * (BIGINT_TEN ** BigInt(left.exponent - exponent));
  const rightCoefficient =
    right.coefficient * (BIGINT_TEN ** BigInt(right.exponent - exponent));
  return normalizeExactDecimal(leftCoefficient + rightCoefficient, exponent);
}

function exactDecimalToString(value: ExactDecimal): string {
  const digits = value.coefficient.toString();
  if (value.exponent >= 0) return `${digits}${"0".repeat(value.exponent)}`;

  const decimalIndex = digits.length + value.exponent;
  return decimalIndex > 0
    ? `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
    : `0.${"0".repeat(-decimalIndex)}${digits}`;
}

function exactDecimalToNumber(value: ExactDecimal): number {
  const result = Number(exactDecimalToString(value));
  if (!Number.isFinite(result) || result < 0) {
    throw new RangeError("costUsd aggregate is not a finite non-negative number");
  }
  const roundTripped = exactDecimalFromCost(result, "aggregate");
  if (
    roundTripped.coefficient !== value.coefficient
    || roundTripped.exponent !== value.exponent
  ) {
    throw new RangeError("costUsd aggregate has no exact canonical JSON number representation");
  }
  return result;
}

function aggregateCostsMatch(declared: number | null, aggregate: ExactDecimal | null): boolean {
  if (declared === null || aggregate === null) return declared === null && aggregate === null;
  const declaredDecimal = exactDecimalFromCost(declared, "declared aggregate");
  return declaredDecimal.coefficient === aggregate.coefficient
    && declaredDecimal.exponent === aggregate.exponent;
}

function aggregateManifestUsageExact(
  executions: readonly RunManifestModelExecutionV1[],
): { usage: RunManifestUsageV1; exactCostUsd: ExactDecimal | null } {
  if (!Array.isArray(executions)) {
    throw new TypeError("model executions must be an array");
  }

  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let exactCostUsd: ExactDecimal | null = null;
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
      exactCostUsd = addExactDecimals(
        exactCostUsd,
        exactDecimalFromCost(usage.costUsd, `execution ${index}`),
      );
    }
  }

  return {
    exactCostUsd,
    usage: {
      inputTokens,
      outputTokens,
      costUsd: exactCostUsd === null ? null : exactDecimalToNumber(exactCostUsd),
      completeness:
        executions.length > 0 && !anyMissing
          ? "complete"
          : anyReported
            ? "partial"
            : "unreported",
    },
  };
}

export function aggregateManifestUsage(
  executions: readonly RunManifestModelExecutionV1[],
): RunManifestUsageV1 {
  return aggregateManifestUsageExact(executions).usage;
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
  if (
    typeof finalizedAt === "string"
    && compareUtcTimestamps(createdAt.value, finalizedAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      "$.finalizedAt",
      "finalizedAt must not precede createdAt",
    );
  }

  let context: ResearchContextBindingV1 | undefined;
  if (hasOwn(object.value, "context")) {
    const safeKeys = validateSensitiveObjectKeys(object.value.context, "$.context");
    if (!safeKeys.ok) return safeKeys;
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
    if (
      source.value.kind === "public-evidence"
      && typeof finalizedAt === "string"
      && compareUtcTimestamps(source.value.fetchedAt, finalizedAt) > 0
    ) {
      return fail(
        "semantic_conflict",
        childPath(sourcePath, "fetchedAt"),
        "public-evidence fetchedAt must not follow manifest finalization",
      );
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
    if (compareUtcTimestamps(artifact.value.createdAt, createdAt.value) < 0) {
      return fail(
        "semantic_conflict",
        childPath(artifactPath, "createdAt"),
        "artifact createdAt must not precede manifest creation",
      );
    }
    if (
      typeof finalizedAt === "string"
      && compareUtcTimestamps(artifact.value.createdAt, finalizedAt) > 0
    ) {
      return fail(
        "semantic_conflict",
        childPath(artifactPath, "createdAt"),
        "artifact createdAt must not follow manifest finalization",
      );
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
  if (compareUtcTimestamps(retention.value.updatedAt, createdAt.value) < 0) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "retention.updatedAt must not precede manifest creation",
    );
  }

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
  let exactCostUsd: ExactDecimal | null;
  try {
    const aggregate = aggregateManifestUsageExact(modelExecutions);
    expectedUsage = aggregate.usage;
    exactCostUsd = aggregate.exactCostUsd;
  } catch (error) {
    return fail(
      "invalid_value",
      "$.usage",
      error instanceof Error ? `usage aggregation failed: ${error.message}` : "usage aggregation failed",
    );
  }
  for (const key of ["inputTokens", "outputTokens", "completeness"] as const) {
    if (usage.value[key] !== expectedUsage[key]) {
      return fail(
        "semantic_conflict",
        childPath("$.usage", key),
        `usage.${key} must equal the aggregate model execution usage`,
      );
    }
  }
  if (!aggregateCostsMatch(usage.value.costUsd, exactCostUsd)) {
    return fail(
      "semantic_conflict",
      "$.usage.costUsd",
      "usage.costUsd must equal the aggregate model execution usage",
    );
  }

  if (revision.value === 1 && retention.value.effectivePolicy !== retention.value.policy) {
    return fail(
      "semantic_conflict",
      "$.retention.effectivePolicy",
      "revision 1 effectivePolicy must equal policy",
    );
  }
  if (
    RETENTION_ORDER[retention.value.effectivePolicy] < RETENTION_ORDER[retention.value.policy]
    && retention.value.status === "active"
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.status",
      "shortened effective retention cannot remain active",
    );
  }

  const pair = validateRetentionDeletionPair(retention.value, deletion.value);
  if (!pair.ok) return pair;
  const deletionRequirements = validateDeletionRequirements(deletion.value);
  if (!deletionRequirements.ok) return deletionRequirements;
  const clock = validateRetentionClock({
    revision: revision.value,
    state: state.value,
    ...(typeof finalizedAt === "string" ? { finalizedAt } : {}),
    retention: retention.value,
  });
  if (!clock.ok) return clock;

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
  if (!isUtcTimestamp(previous.createdAt) || !isUtcTimestamp(next.createdAt)) {
    return fail(
      "semantic_conflict",
      "$.createdAt",
      "manifest revision createdAt values must be valid UTC timestamps",
    );
  }
  if (compareUtcTimestamps(previous.createdAt, next.createdAt) > 0) {
    return fail(
      "semantic_conflict",
      "$.createdAt",
      "next createdAt must not precede previous createdAt",
    );
  }
  if (next.createdAt !== previous.createdAt) {
    return fail("semantic_conflict", "$.createdAt", "createdAt cannot change across revisions");
  }
  if (!isUtcTimestamp(previous.retention.updatedAt)) {
    return fail(
      "semantic_conflict",
      "$.previous.retention.updatedAt",
      "previous retention.updatedAt must be a valid UTC timestamp",
    );
  }
  if (!isUtcTimestamp(next.retention.updatedAt)) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "next retention.updatedAt must be a valid UTC timestamp",
    );
  }
  if (compareUtcTimestamps(previous.retention.updatedAt, next.retention.updatedAt) > 0) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "next retention.updatedAt must not precede previous retention.updatedAt",
    );
  }
  const previousClock = validateRetentionClock(previous);
  if (!previousClock.ok) {
    return fail(
      previousClock.error.code,
      `$.previous${previousClock.error.path.slice(1)}`,
      previousClock.error.message,
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
  const policy = compareImmutableField(previousRetention, nextRetention, "policy", "$.retention.policy");
  if (!policy.ok) return policy;

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

    const previousDeletion = previous.deletion as unknown as Record<string, unknown>;
    const nextDeletion = next.deletion as unknown as Record<string, unknown>;
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

  const policyComparison =
    RETENTION_ORDER[next.retention.effectivePolicy]
    - RETENTION_ORDER[previous.retention.effectivePolicy];
  const shortensEffectivePolicy = policyComparison < 0;
  const lengthensEffectivePolicy = policyComparison > 0;

  if (shortensEffectivePolicy) {
    if (next.retention.status !== "deletion_scheduled") {
      return fail(
        "semantic_conflict",
        "$.retention.status",
        "shortening effective retention must schedule deletion",
      );
    }
    if (next.deletion.status !== "scheduled") {
      return fail(
        "semantic_conflict",
        "$.deletion.status",
        "shortening effective retention requires a scheduled deletion receipt",
      );
    }
    if (!isUtcTimestamp(next.retention.contentExpiresAt)) {
      return fail(
        "semantic_conflict",
        "$.retention.contentExpiresAt",
        "shortening effective retention requires a valid content expiration timestamp",
      );
    }
    if (!isUtcTimestamp(next.retention.updatedAt)) {
      return fail(
        "semantic_conflict",
        "$.retention.updatedAt",
        "shortening effective retention requires a valid retention update timestamp",
      );
    }
    if (!isUtcTimestamp(next.deletion.requestedAt)) {
      return fail(
        "semantic_conflict",
        "$.deletion.requestedAt",
        "shortening effective retention requires a valid deletion request timestamp",
      );
    }
  }

  const consent = validateManifestRetentionConsent(next, options.contextConsent);
  if (!consent.ok) return consent;

  const nextClock = validateRetentionClock(next);
  if (!nextClock.ok) return nextClock;

  const previousDeadline = previous.retention.contentExpiresAt;
  const nextDeadline = next.retention.contentExpiresAt;
  const extendsDeadline =
    previousDeadline !== null
    && nextDeadline !== null
    && isUtcTimestamp(previousDeadline)
    && isUtcTimestamp(nextDeadline)
    && compareUtcTimestamps(nextDeadline, previousDeadline) > 0;
  const exceedsPriorFiniteCeiling =
    previous.state === "final"
    && previous.retention.effectivePolicy === next.retention.effectivePolicy
    && previous.retention.effectivePolicy !== "project"
    && nextDeadline !== null
    && isUtcTimestamp(nextDeadline)
    && !deadlineFitsFiniteAuthority(nextDeadline, previous);
  const renewsSamePolicyDeadline =
    policyComparison === 0
    && (extendsDeadline || exceedsPriorFiniteCeiling);
  const changesFreshConsentReceipt =
    previous.retention.freshConsentAt !== next.retention.freshConsentAt;
  const changesShorteningReceipt =
    previous.retention.shortenedAt !== next.retention.shortenedAt;

  if (shortensEffectivePolicy) {
    if (next.retention.freshConsentAt !== undefined) {
      return fail(
        "semantic_conflict",
        "$.retention.freshConsentAt",
        "shortening effective retention must clear stale freshConsentAt authority",
      );
    }
    if (next.retention.shortenedAt !== next.retention.updatedAt) {
      return fail(
        "semantic_conflict",
        "$.retention.shortenedAt",
        "shortening effective retention requires shortenedAt to equal retention.updatedAt",
      );
    }
  } else if (lengthensEffectivePolicy || renewsSamePolicyDeadline) {
    if (next.retention.shortenedAt !== undefined) {
      return fail(
        "semantic_conflict",
        "$.retention.shortenedAt",
        "retention lengthening or renewal must clear stale shortenedAt authority",
      );
    }
  } else {
    if (changesFreshConsentReceipt) {
      return fail(
        "semantic_conflict",
        "$.retention.freshConsentAt",
        "freshConsentAt cannot change without policy lengthening or deadline renewal",
      );
    }
    if (changesShorteningReceipt) {
      return fail(
        "semantic_conflict",
        "$.retention.shortenedAt",
        "shortenedAt cannot change without an effective-policy shortening",
      );
    }
  }

  const freshConsentRequiredPath = lengthensEffectivePolicy
    ? "$.retention.effectivePolicy"
    : renewsSamePolicyDeadline
      ? "$.retention.contentExpiresAt"
      : null;
  const hasFreshConsentOptions =
    options.freshConsent === true || options.freshConsentAt !== undefined;
  let freshConsentAuthorized = false;
  if (freshConsentRequiredPath !== null) {
    const freshConsent = validateFreshConsentRevision(
      previous,
      next,
      options,
      freshConsentRequiredPath,
    );
    if (!freshConsent.ok) return freshConsent;
    freshConsentAuthorized = true;
  } else if (hasFreshConsentOptions) {
    return fail(
      "semantic_conflict",
      "$.retention.freshConsentAt",
      "fresh consent options require policy lengthening or deadline renewal",
    );
  }

  const lifecycle = validateDeletionLifecycleTransition(
    previous,
    next,
    lengthensEffectivePolicy && freshConsentAuthorized,
  );
  if (!lifecycle.ok) return lifecycle;

  const deadline = validateRetentionDeadlineRevision(
    previous,
    next,
    lengthensEffectivePolicy && freshConsentAuthorized,
    freshConsentAuthorized,
  );
  if (!deadline.ok) return deadline;

  return pass(next);
}
