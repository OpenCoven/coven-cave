import {
  copyProtocolJsonValue,
  compareUtcTimestamps,
  fail,
  isRecord,
  isSha256,
  isUtcTimestamp,
  pass,
  type ProtocolParseResult,
  type UnknownFields,
} from "./research-protocol/common.ts";
import {
  parseContextSelectorV1,
  type ContextSelectorV1,
} from "./research-protocol/context-pack.ts";
import { sha256Digest } from "./research-protocol/digest.ts";

export const RESOURCE_KINDS = [
  "saved-resource",
  "paper",
  "attachment",
  "mission-artifact",
  "session",
  "thread-self-report",
  "local-file",
] as const;

export const RESOURCE_CATEGORIES = [
  "github",
  "docs",
  "paper",
  "video",
  "social",
  "article",
  "other",
] as const;

export const RESOURCE_SENSITIVITIES = ["public", "private", "restricted"] as const;
export const RESOURCE_INGEST_STATES = [
  "metadata_only",
  "queued",
  "ingesting",
  "ready",
  "partial",
  "failed",
  "deleting",
] as const;
export const RESOURCE_INGEST_JOB_STATUSES = [
  "queued",
  "claimed",
  "paused_quota",
  "retry_wait",
  "completed",
  "failed",
  "cancelled",
] as const;
export const RESOURCE_INGEST_JOB_STAGES = [
  "fetch",
  "snapshot",
  "extract",
  "publish_lexical",
] as const;
export const RESOURCE_EMBEDDING_STATUSES = [
  "queued",
  "building",
  "ready",
  "failed",
  "unavailable",
] as const;
export const RESOURCE_QUERY_RANKINGS = ["exact", "lexical", "hybrid"] as const;
export const RESOURCE_SEMANTIC_STATES = ["disabled", "unavailable", "ready"] as const;

export type ResourceKindV1 = (typeof RESOURCE_KINDS)[number];
export type ResourceCategoryV1 = (typeof RESOURCE_CATEGORIES)[number];
export type ResourceSensitivityV1 = (typeof RESOURCE_SENSITIVITIES)[number];
export type ResourceIngestStateV1 = (typeof RESOURCE_INGEST_STATES)[number];
export type ResourceIngestJobStatusV1 = (typeof RESOURCE_INGEST_JOB_STATUSES)[number];
export type ResourceIngestJobStageV1 = (typeof RESOURCE_INGEST_JOB_STAGES)[number];
export type ResourceEmbeddingStatusV1 = (typeof RESOURCE_EMBEDDING_STATUSES)[number];
export type ResourceQueryRankingV1 = (typeof RESOURCE_QUERY_RANKINGS)[number];
export type ResourceSemanticStateV1 = (typeof RESOURCE_SEMANTIC_STATES)[number];

export type ResourceManifestV1 = {
  version: 1;
  id: string;
  revision: number;
  kind: ResourceKindV1;
  canonicalIdentity: string;
  title: string;
  sourceUri?: string;
  sourceType: string;
  category?: ResourceCategoryV1;
  publishedAt?: string;
  legacySavedLink?: {
    id: string;
    url: string;
    addedAt: string;
    source: "chat" | "desk";
  } & UnknownFields;
  paper?: {
    arxivId: string;
    authors: string[];
    abstract?: string;
    publishedAt?: string;
  } & UnknownFields;
  subject: {
    familiarId?: string;
    projectId?: string;
  } & UnknownFields;
  sensitivity: ResourceSensitivityV1;
  ingest: {
    desired: boolean;
    state: ResourceIngestStateV1;
    lastFailureCode?: string;
    retryable?: boolean;
  } & UnknownFields;
  currentSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
} & UnknownFields;

export type ResourcePageBoundaryV1 = {
  page: number;
  start: number;
  end: number;
} & UnknownFields;

export type ResourceNormalizationReceiptV1 = {
  extractorId: string;
  extractorVersion: string;
};

export type ResourceSnapshotV1 = {
  version: 1;
  id: string;
  resourceId: string;
  resourceRevision: number;
  rawBlobDigest?: string;
  normalizedBlobDigest: string;
  normalizedMediaType: string;
  normalizedBytes: number;
  normalizationReceipt: ResourceNormalizationReceiptV1;
  sourceSelector: ContextSelectorV1;
  pageBoundaries?: ResourcePageBoundaryV1[];
  fetchedAt?: string;
  finalUrl?: string;
  etag?: string;
  lastModified?: string;
  createdAt: string;
} & UnknownFields;

export type ResourceIngestJobV1 = {
  version: 1;
  id: string;
  resourceId: string;
  resourceRevision: number;
  deletionRevision: number;
  status: ResourceIngestJobStatusV1;
  stage: ResourceIngestJobStageV1;
  attempt: number;
  availableAt: string;
  lease?: {
    owner: string;
    token: string;
    expiresAt: string;
  } & UnknownFields;
  createdAt: string;
  updatedAt: string;
} & UnknownFields;

export type ResourceEmbeddingTaskV1 = {
  version: 1;
  resourceId: string;
  snapshotId: string;
  lexicalRevision: number;
  providerId: string;
  modelId: string;
  dimensions: number;
  status: ResourceEmbeddingStatusV1;
  updatedAt: string;
} & UnknownFields;

export type ResourceTombstoneV1 = {
  version: 1;
  resourceId: string;
  deletionRevision: number;
  deletedAt: string;
};

export type ResearchLinksProjectionV1 = {
  version: 1;
  catalogRevision: number;
  projectedDigest: string;
  generatedAt: string;
} & UnknownFields;

export type ResearchLinksMigrationJournalV1 = {
  version: 1;
  catalogRevision: number;
  intendedProjectionDigest: string;
  startedAt: string;
} & UnknownFields;

export type ResourceQueryFiltersV1 = {
  projectIds?: string[];
  familiarIds?: string[];
  kinds?: ResourceKindV1[];
  sensitivities?: ResourceSensitivityV1[];
  ingestStates?: ResourceIngestStateV1[];
  publishedFrom?: string;
  publishedBefore?: string;
  contextPackId?: string;
} & UnknownFields;

export type ResourceQueryV1 = {
  version: 1;
  text: string;
  filters?: ResourceQueryFiltersV1;
  ranking: ResourceQueryRankingV1;
  limit: number;
} & UnknownFields;

export type ResourceQuerySelectorV1 =
  | Pick<Extract<ContextSelectorV1, { type: "turn-range" }>, "type" | "start" | "end">
  | Pick<Extract<ContextSelectorV1, { type: "json-pointer" }>, "type" | "pointer">
  | Pick<Extract<ContextSelectorV1, { type: "text-span" }>, "type" | "start" | "end">
  | Pick<Extract<ContextSelectorV1, { type: "markdown-section" }>, "type" | "headingPath">
  | Pick<Extract<ContextSelectorV1, { type: "pdf-page-span" }>, "type" | "page" | "start" | "end">
  | Pick<Extract<ContextSelectorV1, { type: "whole-resource" }>, "type">;

export type ResourceQueryHitV1 = {
  resourceId: string;
  snapshotId: string;
  resourceRevision: number;
  normalizedBlobDigest: string;
  selector: ResourceQuerySelectorV1;
  excerpt: string;
  excerptDigest: string;
  retrieval: {
    exact: boolean;
    lexical: {
      matched: boolean;
      rank?: number;
    };
    semantic: {
      state: ResourceSemanticStateV1;
      matched: boolean;
      rank?: number;
    };
  };
};

export type ResourceQueryResponseV1 = {
  version: 1;
  ranking: ResourceQueryRankingV1;
  hits: ResourceQueryHitV1[];
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

function rejectUnexpected(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  label: string,
): ProtocolParseResult<void> {
  const allowlist = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowlist.has(key)) {
      return fail("invalid_value", childPath(path, key), `${label} does not allow additional fields`);
    }
  }
  return pass(undefined);
}

function object(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  if (!isRecord(value)) return fail("invalid_type", path, "Expected an object");
  return pass(value);
}

function required(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<unknown> {
  if (!hasOwn(record, key)) {
    return fail("missing_field", childPath(path, key), `Missing required field ${key}`);
  }
  return pass(record[key]);
}

function versionOne(value: unknown, path: string): ProtocolParseResult<1> {
  if (value !== 1) return fail("invalid_value", path, "version must equal 1");
  return pass(1);
}

function stringValue(
  value: unknown,
  path: string,
  label: string,
  options: { nonEmpty?: boolean; identifier?: boolean } = {},
): ProtocolParseResult<string> {
  if (typeof value !== "string") return fail("invalid_type", path, `${label} must be a string`);
  if (options.nonEmpty && value.trim().length === 0) {
    return fail("invalid_value", path, `${label} must not be empty`);
  }
  if (options.identifier && value !== value.trim()) {
    return fail("invalid_value", path, `${label} must not have surrounding whitespace`);
  }
  return pass(value);
}

function identifier(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  return stringValue(value, path, label, { nonEmpty: true, identifier: true });
}

function booleanValue(value: unknown, path: string, label: string): ProtocolParseResult<boolean> {
  if (typeof value !== "boolean") return fail("invalid_type", path, `${label} must be a boolean`);
  return pass(value);
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  label: string,
): ProtocolParseResult<T[number]> {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    return fail("invalid_value", path, `${label} must be one of ${allowed.join(", ")}`);
  }
  return pass(value as T[number]);
}

function integer(
  value: unknown,
  path: string,
  label: string,
  minimum = 0,
): ProtocolParseResult<number> {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return fail("invalid_value", path, `${label} must be a safe integer >= ${minimum}`);
  }
  return pass(value as number);
}

function utc(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (!isUtcTimestamp(value)) return fail("invalid_value", path, `${label} must be a UTC RFC 3339 timestamp`);
  return pass(value);
}

function digest(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (!isSha256(value)) return fail("invalid_value", path, `${label} must be a lowercase SHA-256 digest`);
  return pass(value);
}

function optional<T>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  parser: (value: unknown, path: string) => ProtocolParseResult<T>,
): ProtocolParseResult<T | undefined> {
  if (!hasOwn(record, key)) return pass(undefined);
  return parser(record[key], childPath(path, key));
}

function parseStringArray(
  value: unknown,
  path: string,
  label: string,
  { nonEmpty = false }: { nonEmpty?: boolean } = {},
): ProtocolParseResult<string[]> {
  if (!Array.isArray(value)) return fail("invalid_type", path, `${label} must be an array`);
  if (nonEmpty && value.length === 0) return fail("invalid_value", path, `${label} must not be empty`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const parsed = identifier(item, indexPath(path, index), `${label} item`);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value)) return fail("invalid_value", indexPath(path, index), `${label} must not contain duplicates`);
    seen.add(parsed.value);
    result.push(parsed.value);
  }
  return pass(result);
}

function parseEnumArray<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  label: string,
): ProtocolParseResult<T[number][]> {
  if (!Array.isArray(value)) return fail("invalid_type", path, `${label} must be an array`);
  if (value.length === 0) return fail("invalid_value", path, `${label} must not be empty`);
  const result: T[number][] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const parsed = enumValue(item, allowed, indexPath(path, index), `${label} item`);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value)) return fail("invalid_value", indexPath(path, index), `${label} must not contain duplicates`);
    seen.add(parsed.value);
    result.push(parsed.value);
  }
  return pass(result);
}

function prepare(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  const copied = copyProtocolJsonValue(value, path);
  if (!copied.ok) return copied;
  return object(copied.value, path);
}

function parseLegacySavedLink(
  value: unknown,
  path: string,
): ProtocolParseResult<NonNullable<ResourceManifestV1["legacySavedLink"]>> {
  const parsedObject = object(value, path);
  if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const idField = required(raw, "id", path); if (!idField.ok) return idField;
  const id = identifier(idField.value, childPath(path, "id"), "legacy saved-link id"); if (!id.ok) return id;
  const urlField = required(raw, "url", path); if (!urlField.ok) return urlField;
  const url = stringValue(urlField.value, childPath(path, "url"), "legacy saved-link URL", { nonEmpty: true }); if (!url.ok) return url;
  const addedAtField = required(raw, "addedAt", path); if (!addedAtField.ok) return addedAtField;
  const addedAt = utc(addedAtField.value, childPath(path, "addedAt"), "addedAt"); if (!addedAt.ok) return addedAt;
  const sourceField = required(raw, "source", path); if (!sourceField.ok) return sourceField;
  const source = enumValue(sourceField.value, ["chat", "desk"] as const, childPath(path, "source"), "source"); if (!source.ok) return source;
  return pass({ ...raw, id: id.value, url: url.value, addedAt: addedAt.value, source: source.value });
}

function parsePaper(
  value: unknown,
  path: string,
): ProtocolParseResult<NonNullable<ResourceManifestV1["paper"]>> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const arxivField = required(raw, "arxivId", path); if (!arxivField.ok) return arxivField;
  const arxivId = identifier(arxivField.value, childPath(path, "arxivId"), "arXiv id"); if (!arxivId.ok) return arxivId;
  const authorsField = required(raw, "authors", path); if (!authorsField.ok) return authorsField;
  const authors = parseStringArray(authorsField.value, childPath(path, "authors"), "authors"); if (!authors.ok) return authors;
  const abstract = optional(raw, "abstract", path, (item, itemPath) => stringValue(item, itemPath, "abstract")); if (!abstract.ok) return abstract;
  const publishedAt = optional(raw, "publishedAt", path, (item, itemPath) => utc(item, itemPath, "publishedAt")); if (!publishedAt.ok) return publishedAt;
  return pass({ ...raw, arxivId: arxivId.value, authors: authors.value, ...(abstract.value === undefined ? {} : { abstract: abstract.value }), ...(publishedAt.value === undefined ? {} : { publishedAt: publishedAt.value }) });
}

function parseSubject(value: unknown, path: string): ProtocolParseResult<ResourceManifestV1["subject"]> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const familiarId = optional(raw, "familiarId", path, (item, itemPath) => identifier(item, itemPath, "familiarId")); if (!familiarId.ok) return familiarId;
  const projectId = optional(raw, "projectId", path, (item, itemPath) => identifier(item, itemPath, "projectId")); if (!projectId.ok) return projectId;
  return pass({ ...raw, ...(familiarId.value === undefined ? {} : { familiarId: familiarId.value }), ...(projectId.value === undefined ? {} : { projectId: projectId.value }) });
}

function parseIngest(value: unknown, path: string): ProtocolParseResult<ResourceManifestV1["ingest"]> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const desiredField = required(raw, "desired", path); if (!desiredField.ok) return desiredField;
  const desired = booleanValue(desiredField.value, childPath(path, "desired"), "desired"); if (!desired.ok) return desired;
  const stateField = required(raw, "state", path); if (!stateField.ok) return stateField;
  const state = enumValue(stateField.value, RESOURCE_INGEST_STATES, childPath(path, "state"), "ingest state"); if (!state.ok) return state;
  if (!desired.value && ["queued", "ingesting"].includes(state.value)) {
    return fail("semantic_conflict", path, "queued or ingesting state requires desired=true");
  }
  const lastFailureCode = optional(raw, "lastFailureCode", path, (item, itemPath) => identifier(item, itemPath, "lastFailureCode")); if (!lastFailureCode.ok) return lastFailureCode;
  const retryable = optional(raw, "retryable", path, (item, itemPath) => booleanValue(item, itemPath, "retryable")); if (!retryable.ok) return retryable;
  return pass({ ...raw, desired: desired.value, state: state.value, ...(lastFailureCode.value === undefined ? {} : { lastFailureCode: lastFailureCode.value }), ...(retryable.value === undefined ? {} : { retryable: retryable.value }) });
}

export function parseResourceManifestV1(value: unknown): ProtocolParseResult<ResourceManifestV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const idField = required(raw, "id", "$"); if (!idField.ok) return idField;
  const id = identifier(idField.value, "$.id", "resource id"); if (!id.ok) return id;
  const revisionField = required(raw, "revision", "$"); if (!revisionField.ok) return revisionField;
  const revision = integer(revisionField.value, "$.revision", "revision", 1); if (!revision.ok) return revision;
  const kindField = required(raw, "kind", "$"); if (!kindField.ok) return kindField;
  const kind = enumValue(kindField.value, RESOURCE_KINDS, "$.kind", "resource kind"); if (!kind.ok) return kind;
  const canonicalField = required(raw, "canonicalIdentity", "$"); if (!canonicalField.ok) return canonicalField;
  const canonicalIdentity = stringValue(canonicalField.value, "$.canonicalIdentity", "canonicalIdentity", { nonEmpty: true }); if (!canonicalIdentity.ok) return canonicalIdentity;
  const titleField = required(raw, "title", "$"); if (!titleField.ok) return titleField;
  const title = stringValue(titleField.value, "$.title", "title", { nonEmpty: true }); if (!title.ok) return title;
  const sourceTypeField = required(raw, "sourceType", "$"); if (!sourceTypeField.ok) return sourceTypeField;
  const sourceType = identifier(sourceTypeField.value, "$.sourceType", "sourceType"); if (!sourceType.ok) return sourceType;
  const sourceUri = optional(raw, "sourceUri", "$", (item, itemPath) => stringValue(item, itemPath, "sourceUri", { nonEmpty: true })); if (!sourceUri.ok) return sourceUri;
  const category = optional(raw, "category", "$", (item, itemPath) => enumValue(item, RESOURCE_CATEGORIES, itemPath, "category")); if (!category.ok) return category;
  const publishedAt = optional(raw, "publishedAt", "$", (item, itemPath) => utc(item, itemPath, "publishedAt")); if (!publishedAt.ok) return publishedAt;
  const legacySavedLink = optional(raw, "legacySavedLink", "$", parseLegacySavedLink); if (!legacySavedLink.ok) return legacySavedLink;
  const paper = optional(raw, "paper", "$", parsePaper); if (!paper.ok) return paper;
  const subjectField = required(raw, "subject", "$"); if (!subjectField.ok) return subjectField;
  const subject = parseSubject(subjectField.value, "$.subject"); if (!subject.ok) return subject;
  const sensitivityField = required(raw, "sensitivity", "$"); if (!sensitivityField.ok) return sensitivityField;
  const sensitivity = enumValue(sensitivityField.value, RESOURCE_SENSITIVITIES, "$.sensitivity", "sensitivity"); if (!sensitivity.ok) return sensitivity;
  const ingestField = required(raw, "ingest", "$"); if (!ingestField.ok) return ingestField;
  const ingest = parseIngest(ingestField.value, "$.ingest"); if (!ingest.ok) return ingest;
  const currentSnapshotId = optional(raw, "currentSnapshotId", "$", (item, itemPath) => identifier(item, itemPath, "currentSnapshotId")); if (!currentSnapshotId.ok) return currentSnapshotId;
  if (ingest.value.state === "ready" && currentSnapshotId.value === undefined) {
    return fail("semantic_conflict", "$.currentSnapshotId", "ready resources require currentSnapshotId");
  }
  const createdField = required(raw, "createdAt", "$"); if (!createdField.ok) return createdField;
  const createdAt = utc(createdField.value, "$.createdAt", "createdAt"); if (!createdAt.ok) return createdAt;
  const updatedField = required(raw, "updatedAt", "$"); if (!updatedField.ok) return updatedField;
  const updatedAt = utc(updatedField.value, "$.updatedAt", "updatedAt"); if (!updatedAt.ok) return updatedAt;
  if (compareUtcTimestamps(updatedAt.value, createdAt.value) < 0) return fail("semantic_conflict", "$.updatedAt", "updatedAt must not precede createdAt");
  return pass({ ...raw, version: 1, id: id.value, revision: revision.value, kind: kind.value, canonicalIdentity: canonicalIdentity.value, title: title.value, sourceType: sourceType.value, subject: subject.value, sensitivity: sensitivity.value, ingest: ingest.value, createdAt: createdAt.value, updatedAt: updatedAt.value, ...(sourceUri.value === undefined ? {} : { sourceUri: sourceUri.value }), ...(category.value === undefined ? {} : { category: category.value }), ...(publishedAt.value === undefined ? {} : { publishedAt: publishedAt.value }), ...(legacySavedLink.value === undefined ? {} : { legacySavedLink: legacySavedLink.value }), ...(paper.value === undefined ? {} : { paper: paper.value }), ...(currentSnapshotId.value === undefined ? {} : { currentSnapshotId: currentSnapshotId.value }) });
}

function parsePageBoundaries(value: unknown, path: string, normalizedBytes: number): ProtocolParseResult<ResourcePageBoundaryV1[]> {
  if (!Array.isArray(value)) return fail("invalid_type", path, "pageBoundaries must be an array");
  if (value.length === 0) return fail("invalid_value", path, "pageBoundaries must not be empty");
  const boundaries: ResourcePageBoundaryV1[] = [];
  let previousEnd = 0;
  for (const [index, item] of value.entries()) {
    const itemPath = indexPath(path, index);
    const parsedObject = object(item, itemPath); if (!parsedObject.ok) return parsedObject;
    const raw = parsedObject.value;
    const pageField = required(raw, "page", itemPath); if (!pageField.ok) return pageField;
    const page = integer(pageField.value, childPath(itemPath, "page"), "page", 1); if (!page.ok) return page;
    if (page.value !== index + 1) return fail("semantic_conflict", childPath(itemPath, "page"), "pages must be consecutive and one-based");
    const startField = required(raw, "start", itemPath); if (!startField.ok) return startField;
    const start = integer(startField.value, childPath(itemPath, "start"), "start"); if (!start.ok) return start;
    const endField = required(raw, "end", itemPath); if (!endField.ok) return endField;
    const end = integer(endField.value, childPath(itemPath, "end"), "end"); if (!end.ok) return end;
    if (start.value >= end.value) return fail("semantic_conflict", itemPath, "page boundary must be a non-empty half-open range");
    if (start.value < previousEnd) return fail("semantic_conflict", childPath(itemPath, "start"), "page boundaries must not overlap or move backwards");
    if (end.value > normalizedBytes) return fail("semantic_conflict", childPath(itemPath, "end"), "page boundary exceeds normalizedBytes");
    previousEnd = end.value;
    boundaries.push({ ...raw, page: page.value, start: start.value, end: end.value });
  }
  return pass(boundaries);
}

function parseNormalizationReceipt(
  value: unknown,
  path: string,
): ProtocolParseResult<ResourceNormalizationReceiptV1> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  for (const key of Object.keys(raw)) {
    if (key !== "extractorId" && key !== "extractorVersion") {
      return fail("invalid_value", childPath(path, key), `Unknown normalization receipt field ${key}`);
    }
  }
  const extractorIdField = required(raw, "extractorId", path); if (!extractorIdField.ok) return extractorIdField;
  const extractorId = identifier(extractorIdField.value, childPath(path, "extractorId"), "extractorId"); if (!extractorId.ok) return extractorId;
  const extractorVersionField = required(raw, "extractorVersion", path); if (!extractorVersionField.ok) return extractorVersionField;
  const extractorVersion = identifier(extractorVersionField.value, childPath(path, "extractorVersion"), "extractorVersion"); if (!extractorVersion.ok) return extractorVersion;
  return pass({ extractorId: extractorId.value, extractorVersion: extractorVersion.value });
}

export function parseResourceSnapshotV1(value: unknown): ProtocolParseResult<ResourceSnapshotV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const idField = required(raw, "id", "$"); if (!idField.ok) return idField;
  const id = identifier(idField.value, "$.id", "snapshot id"); if (!id.ok) return id;
  const resourceIdField = required(raw, "resourceId", "$"); if (!resourceIdField.ok) return resourceIdField;
  const resourceId = identifier(resourceIdField.value, "$.resourceId", "resourceId"); if (!resourceId.ok) return resourceId;
  const revisionField = required(raw, "resourceRevision", "$"); if (!revisionField.ok) return revisionField;
  const resourceRevision = integer(revisionField.value, "$.resourceRevision", "resourceRevision", 1); if (!resourceRevision.ok) return resourceRevision;
  const rawBlobDigest = optional(raw, "rawBlobDigest", "$", (item, itemPath) => digest(item, itemPath, "rawBlobDigest")); if (!rawBlobDigest.ok) return rawBlobDigest;
  const normalizedDigestField = required(raw, "normalizedBlobDigest", "$"); if (!normalizedDigestField.ok) return normalizedDigestField;
  const normalizedBlobDigest = digest(normalizedDigestField.value, "$.normalizedBlobDigest", "normalizedBlobDigest"); if (!normalizedBlobDigest.ok) return normalizedBlobDigest;
  const mediaField = required(raw, "normalizedMediaType", "$"); if (!mediaField.ok) return mediaField;
  const normalizedMediaType = stringValue(mediaField.value, "$.normalizedMediaType", "normalizedMediaType", { nonEmpty: true }); if (!normalizedMediaType.ok) return normalizedMediaType;
  const bytesField = required(raw, "normalizedBytes", "$"); if (!bytesField.ok) return bytesField;
  const normalizedBytes = integer(bytesField.value, "$.normalizedBytes", "normalizedBytes"); if (!normalizedBytes.ok) return normalizedBytes;
  const receiptField = required(raw, "normalizationReceipt", "$"); if (!receiptField.ok) return receiptField;
  const normalizationReceipt = parseNormalizationReceipt(receiptField.value, "$.normalizationReceipt"); if (!normalizationReceipt.ok) return normalizationReceipt;
  const selectorField = required(raw, "sourceSelector", "$"); if (!selectorField.ok) return selectorField;
  const sourceSelector = parseContextSelectorV1(selectorField.value, "$.sourceSelector"); if (!sourceSelector.ok) return sourceSelector;
  const pageBoundaries = optional(raw, "pageBoundaries", "$", (item, itemPath) => parsePageBoundaries(item, itemPath, normalizedBytes.value)); if (!pageBoundaries.ok) return pageBoundaries;
  if (sourceSelector.value.type === "text-span" && sourceSelector.value.end > normalizedBytes.value) {
    return fail("semantic_conflict", "$.sourceSelector.end", "text-span exceeds normalizedBytes");
  }
  if (sourceSelector.value.type === "pdf-page-span") {
    if (pageBoundaries.value === undefined) {
      return fail("semantic_conflict", "$.pageBoundaries", "pdf-page-span requires pageBoundaries");
    }
    const pageBoundary = pageBoundaries.value.find(
      (boundary) => boundary.page === sourceSelector.value.page,
    );
    if (!pageBoundary) {
      return fail("semantic_conflict", "$.sourceSelector.page", "pdf-page-span references a page outside pageBoundaries");
    }
    const pageLength = pageBoundary.end - pageBoundary.start;
    if (sourceSelector.value.end > pageLength) {
      return fail("semantic_conflict", "$.sourceSelector.end", "pdf-page-span exceeds the selected page's normalized bytes");
    }
  }
  const fetchedAt = optional(raw, "fetchedAt", "$", (item, itemPath) => utc(item, itemPath, "fetchedAt")); if (!fetchedAt.ok) return fetchedAt;
  const finalUrl = optional(raw, "finalUrl", "$", (item, itemPath) => stringValue(item, itemPath, "finalUrl", { nonEmpty: true })); if (!finalUrl.ok) return finalUrl;
  const etag = optional(raw, "etag", "$", (item, itemPath) => stringValue(item, itemPath, "etag")); if (!etag.ok) return etag;
  const lastModified = optional(raw, "lastModified", "$", (item, itemPath) => stringValue(item, itemPath, "lastModified")); if (!lastModified.ok) return lastModified;
  const createdField = required(raw, "createdAt", "$"); if (!createdField.ok) return createdField;
  const createdAt = utc(createdField.value, "$.createdAt", "createdAt"); if (!createdAt.ok) return createdAt;
  return pass({ ...raw, version: 1, id: id.value, resourceId: resourceId.value, resourceRevision: resourceRevision.value, normalizedBlobDigest: normalizedBlobDigest.value, normalizedMediaType: normalizedMediaType.value, normalizedBytes: normalizedBytes.value, normalizationReceipt: normalizationReceipt.value, sourceSelector: sourceSelector.value, createdAt: createdAt.value, ...(rawBlobDigest.value === undefined ? {} : { rawBlobDigest: rawBlobDigest.value }), ...(pageBoundaries.value === undefined ? {} : { pageBoundaries: pageBoundaries.value }), ...(fetchedAt.value === undefined ? {} : { fetchedAt: fetchedAt.value }), ...(finalUrl.value === undefined ? {} : { finalUrl: finalUrl.value }), ...(etag.value === undefined ? {} : { etag: etag.value }), ...(lastModified.value === undefined ? {} : { lastModified: lastModified.value }) });
}

export function parseResourceIngestJobV1(value: unknown): ProtocolParseResult<ResourceIngestJobV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const idField = required(raw, "id", "$"); if (!idField.ok) return idField;
  const id = identifier(idField.value, "$.id", "job id"); if (!id.ok) return id;
  const resourceIdField = required(raw, "resourceId", "$"); if (!resourceIdField.ok) return resourceIdField;
  const resourceId = identifier(resourceIdField.value, "$.resourceId", "resourceId"); if (!resourceId.ok) return resourceId;
  const resourceRevisionField = required(raw, "resourceRevision", "$"); if (!resourceRevisionField.ok) return resourceRevisionField;
  const resourceRevision = integer(resourceRevisionField.value, "$.resourceRevision", "resourceRevision", 1); if (!resourceRevision.ok) return resourceRevision;
  const deletionRevisionField = required(raw, "deletionRevision", "$"); if (!deletionRevisionField.ok) return deletionRevisionField;
  const deletionRevision = integer(deletionRevisionField.value, "$.deletionRevision", "deletionRevision"); if (!deletionRevision.ok) return deletionRevision;
  const statusField = required(raw, "status", "$"); if (!statusField.ok) return statusField;
  const status = enumValue(statusField.value, RESOURCE_INGEST_JOB_STATUSES, "$.status", "job status"); if (!status.ok) return status;
  const stageField = required(raw, "stage", "$"); if (!stageField.ok) return stageField;
  const stage = enumValue(stageField.value, RESOURCE_INGEST_JOB_STAGES, "$.stage", "job stage"); if (!stage.ok) return stage;
  const attemptField = required(raw, "attempt", "$"); if (!attemptField.ok) return attemptField;
  const attempt = integer(attemptField.value, "$.attempt", "attempt"); if (!attempt.ok) return attempt;
  const availableAtField = required(raw, "availableAt", "$"); if (!availableAtField.ok) return availableAtField;
  const availableAt = utc(availableAtField.value, "$.availableAt", "availableAt"); if (!availableAt.ok) return availableAt;
  const lease = optional<Exclude<ResourceIngestJobV1["lease"], undefined>>(raw, "lease", "$", (item, itemPath) => {
    const leaseObject = object(item, itemPath); if (!leaseObject.ok) return leaseObject;
    const ownerField = required(leaseObject.value, "owner", itemPath); if (!ownerField.ok) return ownerField;
    const owner = identifier(ownerField.value, childPath(itemPath, "owner"), "lease owner"); if (!owner.ok) return owner;
    const tokenField = required(leaseObject.value, "token", itemPath); if (!tokenField.ok) return tokenField;
    const token = stringValue(tokenField.value, childPath(itemPath, "token"), "lease token", { nonEmpty: true }); if (!token.ok) return token;
    if (!/^[a-f0-9]{32}$/.test(token.value)) return fail("invalid_value", childPath(itemPath, "token"), "lease token must be 128-bit lowercase hexadecimal");
    const expiresField = required(leaseObject.value, "expiresAt", itemPath); if (!expiresField.ok) return expiresField;
    const expiresAt = utc(expiresField.value, childPath(itemPath, "expiresAt"), "lease expiresAt"); if (!expiresAt.ok) return expiresAt;
    return pass({ ...leaseObject.value, owner: owner.value, token: token.value, expiresAt: expiresAt.value });
  }); if (!lease.ok) return lease;
  if ((status.value === "claimed") !== (lease.value !== undefined)) {
    return fail("semantic_conflict", "$.lease", "lease must be present exactly when status is claimed");
  }
  const createdField = required(raw, "createdAt", "$"); if (!createdField.ok) return createdField;
  const createdAt = utc(createdField.value, "$.createdAt", "createdAt"); if (!createdAt.ok) return createdAt;
  const updatedField = required(raw, "updatedAt", "$"); if (!updatedField.ok) return updatedField;
  const updatedAt = utc(updatedField.value, "$.updatedAt", "updatedAt"); if (!updatedAt.ok) return updatedAt;
  if (compareUtcTimestamps(updatedAt.value, createdAt.value) < 0) return fail("semantic_conflict", "$.updatedAt", "updatedAt must not precede createdAt");
  return pass({ ...raw, version: 1, id: id.value, resourceId: resourceId.value, resourceRevision: resourceRevision.value, deletionRevision: deletionRevision.value, status: status.value, stage: stage.value, attempt: attempt.value, availableAt: availableAt.value, createdAt: createdAt.value, updatedAt: updatedAt.value, ...(lease.value === undefined ? {} : { lease: lease.value }) });
}

export function parseResourceEmbeddingTaskV1(value: unknown): ProtocolParseResult<ResourceEmbeddingTaskV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const resourceIdField = required(raw, "resourceId", "$"); if (!resourceIdField.ok) return resourceIdField;
  const resourceId = identifier(resourceIdField.value, "$.resourceId", "resourceId"); if (!resourceId.ok) return resourceId;
  const snapshotIdField = required(raw, "snapshotId", "$"); if (!snapshotIdField.ok) return snapshotIdField;
  const snapshotId = identifier(snapshotIdField.value, "$.snapshotId", "snapshotId"); if (!snapshotId.ok) return snapshotId;
  const lexicalRevisionField = required(raw, "lexicalRevision", "$"); if (!lexicalRevisionField.ok) return lexicalRevisionField;
  const lexicalRevision = integer(lexicalRevisionField.value, "$.lexicalRevision", "lexicalRevision", 1); if (!lexicalRevision.ok) return lexicalRevision;
  const providerIdField = required(raw, "providerId", "$"); if (!providerIdField.ok) return providerIdField;
  const providerId = identifier(providerIdField.value, "$.providerId", "providerId"); if (!providerId.ok) return providerId;
  const modelIdField = required(raw, "modelId", "$"); if (!modelIdField.ok) return modelIdField;
  const modelId = identifier(modelIdField.value, "$.modelId", "modelId"); if (!modelId.ok) return modelId;
  const dimensionsField = required(raw, "dimensions", "$"); if (!dimensionsField.ok) return dimensionsField;
  const dimensions = integer(dimensionsField.value, "$.dimensions", "dimensions", 1); if (!dimensions.ok) return dimensions;
  const statusField = required(raw, "status", "$"); if (!statusField.ok) return statusField;
  const status = enumValue(statusField.value, RESOURCE_EMBEDDING_STATUSES, "$.status", "embedding status"); if (!status.ok) return status;
  const updatedField = required(raw, "updatedAt", "$"); if (!updatedField.ok) return updatedField;
  const updatedAt = utc(updatedField.value, "$.updatedAt", "updatedAt"); if (!updatedAt.ok) return updatedAt;
  return pass({ ...raw, version: 1, resourceId: resourceId.value, snapshotId: snapshotId.value, lexicalRevision: lexicalRevision.value, providerId: providerId.value, modelId: modelId.value, dimensions: dimensions.value, status: status.value, updatedAt: updatedAt.value });
}

export function parseResourceTombstoneV1(value: unknown): ProtocolParseResult<ResourceTombstoneV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const strict = rejectUnexpected(raw, ["version", "resourceId", "deletionRevision", "deletedAt"], "$", "tombstone"); if (!strict.ok) return strict;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const resourceIdField = required(raw, "resourceId", "$"); if (!resourceIdField.ok) return resourceIdField;
  const resourceId = identifier(resourceIdField.value, "$.resourceId", "resourceId"); if (!resourceId.ok) return resourceId;
  const revisionField = required(raw, "deletionRevision", "$"); if (!revisionField.ok) return revisionField;
  const deletionRevision = integer(revisionField.value, "$.deletionRevision", "deletionRevision", 1); if (!deletionRevision.ok) return deletionRevision;
  const deletedField = required(raw, "deletedAt", "$"); if (!deletedField.ok) return deletedField;
  const deletedAt = utc(deletedField.value, "$.deletedAt", "deletedAt"); if (!deletedAt.ok) return deletedAt;
  return pass({ version: 1, resourceId: resourceId.value, deletionRevision: deletionRevision.value, deletedAt: deletedAt.value });
}

function parseMigrationRecord<T extends ResearchLinksProjectionV1 | ResearchLinksMigrationJournalV1>(
  value: unknown,
  digestKey: "projectedDigest" | "intendedProjectionDigest",
  timestampKey: "generatedAt" | "startedAt",
): ProtocolParseResult<T> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const revisionField = required(raw, "catalogRevision", "$"); if (!revisionField.ok) return revisionField;
  const catalogRevision = integer(revisionField.value, "$.catalogRevision", "catalogRevision"); if (!catalogRevision.ok) return catalogRevision;
  const digestField = required(raw, digestKey, "$"); if (!digestField.ok) return digestField;
  const parsedDigest = digest(digestField.value, childPath("$", digestKey), digestKey); if (!parsedDigest.ok) return parsedDigest;
  const timestampField = required(raw, timestampKey, "$"); if (!timestampField.ok) return timestampField;
  const timestamp = utc(timestampField.value, childPath("$", timestampKey), timestampKey); if (!timestamp.ok) return timestamp;
  return pass({ ...raw, version: 1, catalogRevision: catalogRevision.value, [digestKey]: parsedDigest.value, [timestampKey]: timestamp.value } as T);
}

export function parseResearchLinksProjectionV1(value: unknown): ProtocolParseResult<ResearchLinksProjectionV1> {
  return parseMigrationRecord<ResearchLinksProjectionV1>(value, "projectedDigest", "generatedAt");
}

export function parseResearchLinksMigrationJournalV1(value: unknown): ProtocolParseResult<ResearchLinksMigrationJournalV1> {
  return parseMigrationRecord<ResearchLinksMigrationJournalV1>(value, "intendedProjectionDigest", "startedAt");
}

function parseQueryFilters(value: unknown, path: string): ProtocolParseResult<ResourceQueryFiltersV1> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const projectIds = optional(raw, "projectIds", path, (item, itemPath) => parseStringArray(item, itemPath, "projectIds", { nonEmpty: true })); if (!projectIds.ok) return projectIds;
  const familiarIds = optional(raw, "familiarIds", path, (item, itemPath) => parseStringArray(item, itemPath, "familiarIds", { nonEmpty: true })); if (!familiarIds.ok) return familiarIds;
  const kinds = optional(raw, "kinds", path, (item, itemPath) => parseEnumArray(item, RESOURCE_KINDS, itemPath, "kinds")); if (!kinds.ok) return kinds;
  const sensitivities = optional(raw, "sensitivities", path, (item, itemPath) => parseEnumArray(item, RESOURCE_SENSITIVITIES, itemPath, "sensitivities")); if (!sensitivities.ok) return sensitivities;
  const ingestStates = optional(raw, "ingestStates", path, (item, itemPath) => parseEnumArray(item, RESOURCE_INGEST_STATES, itemPath, "ingestStates")); if (!ingestStates.ok) return ingestStates;
  const publishedFrom = optional(raw, "publishedFrom", path, (item, itemPath) => utc(item, itemPath, "publishedFrom")); if (!publishedFrom.ok) return publishedFrom;
  const publishedBefore = optional(raw, "publishedBefore", path, (item, itemPath) => utc(item, itemPath, "publishedBefore")); if (!publishedBefore.ok) return publishedBefore;
  if (publishedFrom.value !== undefined && publishedBefore.value !== undefined && compareUtcTimestamps(publishedFrom.value, publishedBefore.value) >= 0) {
    return fail("semantic_conflict", path, "publishedFrom must precede publishedBefore");
  }
  const contextPackId = optional(raw, "contextPackId", path, (item, itemPath) => identifier(item, itemPath, "contextPackId")); if (!contextPackId.ok) return contextPackId;
  return pass({ ...raw, ...(projectIds.value === undefined ? {} : { projectIds: projectIds.value }), ...(familiarIds.value === undefined ? {} : { familiarIds: familiarIds.value }), ...(kinds.value === undefined ? {} : { kinds: kinds.value }), ...(sensitivities.value === undefined ? {} : { sensitivities: sensitivities.value }), ...(ingestStates.value === undefined ? {} : { ingestStates: ingestStates.value }), ...(publishedFrom.value === undefined ? {} : { publishedFrom: publishedFrom.value }), ...(publishedBefore.value === undefined ? {} : { publishedBefore: publishedBefore.value }), ...(contextPackId.value === undefined ? {} : { contextPackId: contextPackId.value }) });
}

export function parseResourceQueryV1(value: unknown): ProtocolParseResult<ResourceQueryV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const textField = required(raw, "text", "$"); if (!textField.ok) return textField;
  const text = stringValue(textField.value, "$.text", "query text", { nonEmpty: true }); if (!text.ok) return text;
  const filters = optional(raw, "filters", "$", parseQueryFilters); if (!filters.ok) return filters;
  const rankingField = required(raw, "ranking", "$"); if (!rankingField.ok) return rankingField;
  const ranking = enumValue(rankingField.value, RESOURCE_QUERY_RANKINGS, "$.ranking", "ranking"); if (!ranking.ok) return ranking;
  const limitField = required(raw, "limit", "$"); if (!limitField.ok) return limitField;
  const limit = integer(limitField.value, "$.limit", "limit", 1); if (!limit.ok) return limit;
  if (limit.value > 100) return fail("invalid_value", "$.limit", "limit must be <= 100");
  return pass({ ...raw, version: 1, text: text.value, ranking: ranking.value, limit: limit.value, ...(filters.value === undefined ? {} : { filters: filters.value }) });
}

function parseRankEvidence(value: unknown, path: string, label: string): ProtocolParseResult<{ matched: boolean; rank?: number }> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const strict = rejectUnexpected(raw, ["matched", "rank"], path, `${label} retrieval evidence`); if (!strict.ok) return strict;
  const matchedField = required(raw, "matched", path); if (!matchedField.ok) return matchedField;
  const matched = booleanValue(matchedField.value, childPath(path, "matched"), `${label} matched`); if (!matched.ok) return matched;
  const rank = optional(raw, "rank", path, (item, itemPath) => integer(item, itemPath, `${label} rank`, 1)); if (!rank.ok) return rank;
  if (matched.value !== (rank.value !== undefined)) return fail("semantic_conflict", path, `${label} rank must be present exactly when matched`);
  return pass({ ...raw, matched: matched.value, ...(rank.value === undefined ? {} : { rank: rank.value }) });
}

function parseQueryHit(value: unknown, path: string): ProtocolParseResult<ResourceQueryHitV1> {
  const parsedObject = object(value, path); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const strict = rejectUnexpected(raw, ["resourceId", "snapshotId", "resourceRevision", "normalizedBlobDigest", "selector", "excerpt", "excerptDigest", "retrieval"], path, "query hit"); if (!strict.ok) return strict;
  const resourceIdField = required(raw, "resourceId", path); if (!resourceIdField.ok) return resourceIdField;
  const resourceId = identifier(resourceIdField.value, childPath(path, "resourceId"), "resourceId"); if (!resourceId.ok) return resourceId;
  const snapshotIdField = required(raw, "snapshotId", path); if (!snapshotIdField.ok) return snapshotIdField;
  const snapshotId = identifier(snapshotIdField.value, childPath(path, "snapshotId"), "snapshotId"); if (!snapshotId.ok) return snapshotId;
  const revisionField = required(raw, "resourceRevision", path); if (!revisionField.ok) return revisionField;
  const resourceRevision = integer(revisionField.value, childPath(path, "resourceRevision"), "resourceRevision", 1); if (!resourceRevision.ok) return resourceRevision;
  const normalizedField = required(raw, "normalizedBlobDigest", path); if (!normalizedField.ok) return normalizedField;
  const normalizedBlobDigest = digest(normalizedField.value, childPath(path, "normalizedBlobDigest"), "normalizedBlobDigest"); if (!normalizedBlobDigest.ok) return normalizedBlobDigest;
  const selectorField = required(raw, "selector", path); if (!selectorField.ok) return selectorField;
  const selector = parseContextSelectorV1(selectorField.value, childPath(path, "selector")); if (!selector.ok) return selector;
  const selectorKeys = selector.value.type === "json-pointer"
    ? ["type", "pointer"]
    : selector.value.type === "markdown-section"
      ? ["type", "headingPath"]
      : selector.value.type === "whole-resource"
        ? ["type"]
        : selector.value.type === "pdf-page-span"
          ? ["type", "page", "start", "end"]
          : ["type", "start", "end"];
  const strictSelector = rejectUnexpected(selector.value, selectorKeys, childPath(path, "selector"), "query-hit selector"); if (!strictSelector.ok) return strictSelector;
  const excerptField = required(raw, "excerpt", path); if (!excerptField.ok) return excerptField;
  const excerpt = stringValue(excerptField.value, childPath(path, "excerpt"), "excerpt"); if (!excerpt.ok) return excerpt;
  const excerptDigestField = required(raw, "excerptDigest", path); if (!excerptDigestField.ok) return excerptDigestField;
  const excerptDigest = digest(excerptDigestField.value, childPath(path, "excerptDigest"), "excerptDigest"); if (!excerptDigest.ok) return excerptDigest;
  if (excerptDigest.value !== sha256Digest(excerpt.value)) {
    return fail("digest_mismatch", childPath(path, "excerptDigest"), "excerptDigest does not match the exact excerpt bytes");
  }
  const retrievalField = required(raw, "retrieval", path); if (!retrievalField.ok) return retrievalField;
  const retrievalObject = object(retrievalField.value, childPath(path, "retrieval")); if (!retrievalObject.ok) return retrievalObject;
  const retrievalRaw = retrievalObject.value;
  const strictRetrieval = rejectUnexpected(retrievalRaw, ["exact", "lexical", "semantic"], childPath(path, "retrieval"), "retrieval evidence"); if (!strictRetrieval.ok) return strictRetrieval;
  const exactField = required(retrievalRaw, "exact", childPath(path, "retrieval")); if (!exactField.ok) return exactField;
  const exact = booleanValue(exactField.value, childPath(childPath(path, "retrieval"), "exact"), "exact"); if (!exact.ok) return exact;
  const lexicalField = required(retrievalRaw, "lexical", childPath(path, "retrieval")); if (!lexicalField.ok) return lexicalField;
  const lexical = parseRankEvidence(lexicalField.value, childPath(childPath(path, "retrieval"), "lexical"), "lexical"); if (!lexical.ok) return lexical;
  const semanticField = required(retrievalRaw, "semantic", childPath(path, "retrieval")); if (!semanticField.ok) return semanticField;
  const semanticObject = object(semanticField.value, childPath(childPath(path, "retrieval"), "semantic")); if (!semanticObject.ok) return semanticObject;
  const semanticRaw = semanticObject.value;
  const strictSemantic = rejectUnexpected(semanticRaw, ["state", "matched", "rank"], childPath(childPath(path, "retrieval"), "semantic"), "semantic retrieval evidence"); if (!strictSemantic.ok) return strictSemantic;
  const stateField = required(semanticRaw, "state", childPath(childPath(path, "retrieval"), "semantic")); if (!stateField.ok) return stateField;
  const state = enumValue(stateField.value, RESOURCE_SEMANTIC_STATES, childPath(childPath(childPath(path, "retrieval"), "semantic"), "state"), "semantic state"); if (!state.ok) return state;
  const matchedField = required(semanticRaw, "matched", childPath(childPath(path, "retrieval"), "semantic")); if (!matchedField.ok) return matchedField;
  const matched = booleanValue(matchedField.value, childPath(childPath(childPath(path, "retrieval"), "semantic"), "matched"), "semantic matched"); if (!matched.ok) return matched;
  const rank = optional(semanticRaw, "rank", childPath(childPath(path, "retrieval"), "semantic"), (item, itemPath) => integer(item, itemPath, "semantic rank", 1)); if (!rank.ok) return rank;
  if (matched.value && state.value !== "ready") return fail("semantic_conflict", childPath(childPath(path, "retrieval"), "semantic"), "semantic matches require state=ready");
  if (matched.value !== (rank.value !== undefined)) return fail("semantic_conflict", childPath(childPath(path, "retrieval"), "semantic"), "semantic rank must be present exactly when matched");
  const semantic = { ...semanticRaw, state: state.value, matched: matched.value, ...(rank.value === undefined ? {} : { rank: rank.value }) };
  const retrieval = { ...retrievalRaw, exact: exact.value, lexical: lexical.value, semantic };
  return pass({ ...raw, resourceId: resourceId.value, snapshotId: snapshotId.value, resourceRevision: resourceRevision.value, normalizedBlobDigest: normalizedBlobDigest.value, selector: selector.value as ResourceQuerySelectorV1, excerpt: excerpt.value, excerptDigest: excerptDigest.value, retrieval });
}

export function parseResourceQueryResponseV1(value: unknown): ProtocolParseResult<ResourceQueryResponseV1> {
  const parsedObject = prepare(value, "$"); if (!parsedObject.ok) return parsedObject;
  const raw = parsedObject.value;
  const strict = rejectUnexpected(raw, ["version", "ranking", "hits"], "$", "query response"); if (!strict.ok) return strict;
  const versionField = required(raw, "version", "$"); if (!versionField.ok) return versionField;
  const version = versionOne(versionField.value, "$.version"); if (!version.ok) return version;
  const rankingField = required(raw, "ranking", "$"); if (!rankingField.ok) return rankingField;
  const ranking = enumValue(rankingField.value, RESOURCE_QUERY_RANKINGS, "$.ranking", "ranking"); if (!ranking.ok) return ranking;
  const hitsField = required(raw, "hits", "$"); if (!hitsField.ok) return hitsField;
  if (!Array.isArray(hitsField.value)) return fail("invalid_type", "$.hits", "hits must be an array");
  if (hitsField.value.length > 100) return fail("invalid_value", "$.hits", "hits must contain at most 100 entries");
  const hits: ResourceQueryHitV1[] = [];
  const identities = new Set<string>();
  for (const [index, item] of hitsField.value.entries()) {
    const hit = parseQueryHit(item, indexPath("$.hits", index)); if (!hit.ok) return hit;
    const identity = `${hit.value.resourceId}\u0000${hit.value.snapshotId}`;
    if (identities.has(identity)) return fail("semantic_conflict", indexPath("$.hits", index), "response must not duplicate a resource/snapshot pair");
    identities.add(identity);
    hits.push(hit.value);
  }
  return pass({ ...raw, version: 1, ranking: ranking.value, hits });
}
