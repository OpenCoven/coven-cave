import {
  fail,
  isOpaqueId,
  isRecord,
  isSha256,
  isUtcTimestamp,
  pass,
  type ProtocolParseResult,
  type UnknownFields,
} from "./common.ts";

const CONTEXT_PACK_SCHEMA = "opencoven.context-pack/v1";
const CONTEXT_PACK_SCHEMA_RE = /^opencoven\.context-pack\/v(\d+)$/;

const PURPOSES = ["topic-discovery", "research-run"] as const;
const SELECTION_MODES = ["explicit", "saved-view"] as const;
const RETENTION_POLICIES = ["run-only", "7-days", "project"] as const;
const RESOURCE_KINDS = [
  "session",
  "thread-self-report",
  "mission",
  "artifact",
  "attachment",
  "saved-resource",
  "metric-snapshot",
] as const;
const RESOURCE_TRUST_LEVELS = [
  "user-authored",
  "agent-output",
  "mixed-conversation",
  "model-derived",
  "imported-source",
] as const;
const RESOURCE_SENSITIVITIES = ["public", "private", "restricted"] as const;
const SELECTOR_TYPES = [
  "turn-range",
  "json-pointer",
  "text-span",
  "markdown-section",
  "pdf-page-span",
  "whole-resource",
] as const;

type ContextPackPurposeV1 = (typeof PURPOSES)[number];
type ContextSelectionModeV1 = (typeof SELECTION_MODES)[number];
type ContextRetentionPolicyV1 = (typeof RETENTION_POLICIES)[number];
type ContextPackResourceKindV1 = (typeof RESOURCE_KINDS)[number];
type ContextPackResourceTrustV1 = (typeof RESOURCE_TRUST_LEVELS)[number];
type ContextPackResourceSensitivityV1 = (typeof RESOURCE_SENSITIVITIES)[number];

type ContextPackCreatedByV1 = {
  client: "coven-cave";
  userId?: string;
} & UnknownFields;

type ContextPackSubjectV1 = {
  familiarId: string;
  projectId?: string;
} & UnknownFields;

type ContextPackConsentV1 = {
  selectionMode: ContextSelectionModeV1;
  allowRemoteQueries: boolean;
  allowRemoteContent: boolean;
  artifactContentSync: boolean;
  retention: ContextRetentionPolicyV1;
} & UnknownFields;

type ContextPackPolicyV1 = {
  treatResourceTextAsData: true;
  toolAuthority: "none";
  allowedPurposes: ContextPackPurposeV1[];
} & UnknownFields;

type ContextPackTransformsV1 = {
  secretScanVersion: string;
  redactionMapDigest?: string;
} & UnknownFields;

type TurnRangeSelectorV1 = {
  type: "turn-range";
  start: number;
  end: number;
} & UnknownFields;

type JsonPointerSelectorV1 = {
  type: "json-pointer";
  pointer: string;
} & UnknownFields;

type TextSpanSelectorV1 = {
  type: "text-span";
  start: number;
  end: number;
} & UnknownFields;

type MarkdownSectionSelectorV1 = {
  type: "markdown-section";
  headingPath: string[];
} & UnknownFields;

type PdfPageSpanSelectorV1 = {
  type: "pdf-page-span";
  page: number;
  start: number;
  end: number;
} & UnknownFields;

type WholeResourceSelectorV1 = {
  type: "whole-resource";
} & UnknownFields;

export type ContextSelectorV1 =
  | TurnRangeSelectorV1
  | JsonPointerSelectorV1
  | TextSpanSelectorV1
  | MarkdownSectionSelectorV1
  | PdfPageSpanSelectorV1
  | WholeResourceSelectorV1;

export type ContextPackResourceV1 = {
  id: string;
  kind: ContextPackResourceKindV1;
  uri: string;
  digest: string;
  localBlobDigest: string;
  selector: ContextSelectorV1;
  trust: ContextPackResourceTrustV1;
  sensitivity: ContextPackResourceSensitivityV1;
  capturedAt: string;
  title?: string;
  mediaType: string;
} & UnknownFields;

export type ContextPackV1 = {
  schema: "opencoven.context-pack/v1";
  id: string;
  digest: string;
  createdAt: string;
  createdBy: ContextPackCreatedByV1;
  purpose: ContextPackPurposeV1;
  subject: ContextPackSubjectV1;
  consent: ContextPackConsentV1;
  resources: ContextPackResourceV1[];
  policy: ContextPackPolicyV1;
  transforms: ContextPackTransformsV1;
} & UnknownFields;

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

function parseBoolean(value: unknown, path: string, label: string): ProtocolParseResult<boolean> {
  if (typeof value !== "boolean") {
    return fail("invalid_type", path, `${label} must be a boolean`);
  }
  return pass(value);
}

function parseString(
  value: unknown,
  path: string,
  label: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!allowEmpty && value.length === 0) {
    return fail("invalid_value", path, `${label} must not be empty`);
  }
  return pass(value);
}

function parseOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<string | undefined> {
  if (!hasOwn(record, key)) {
    return pass(undefined);
  }
  return parseString(record[key], childPath(path, key), key, { allowEmpty: true });
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
    return fail("invalid_value", path, `${label} must be a UTC timestamp ending in Z`);
  }
  return pass(value);
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

function parseSafeInteger(
  value: unknown,
  path: string,
  label: string,
  minimum = 0,
): ProtocolParseResult<number> {
  if (typeof value !== "number") {
    return fail("invalid_type", path, `${label} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    return fail("invalid_value", path, `${label} must be a safe integer`);
  }
  if (value < minimum) {
    return fail("invalid_value", path, `${label} must be >= ${minimum}`);
  }
  return pass(value);
}

function parseRange(
  start: number,
  end: number,
  path: string,
  label: string,
): ProtocolParseResult<void> {
  if (start >= end) {
    return fail("semantic_conflict", path, `${label} requires start < end`);
  }
  return pass(undefined);
}

function parseHeadingPath(value: unknown, path: string): ProtocolParseResult<string[]> {
  if (!Array.isArray(value)) {
    return fail("invalid_type", path, "headingPath must be an array");
  }
  if (value.length === 0) {
    return fail("invalid_value", path, "headingPath must not be empty");
  }
  const headings: string[] = [];
  for (const [index, heading] of value.entries()) {
    const parsedHeading = parseString(heading, indexPath(path, index), "headingPath item");
    if (!parsedHeading.ok) return parsedHeading;
    headings.push(parsedHeading.value);
  }
  return pass(headings);
}

function parseJsonPointer(value: unknown, path: string): ProtocolParseResult<string> {
  const pointer = parseString(value, path, "pointer", { allowEmpty: true });
  if (!pointer.ok) return pointer;
  if (pointer.value !== "" && !pointer.value.startsWith("/")) {
    return fail("invalid_value", path, "pointer must be empty or start with /");
  }
  return pointer;
}

function parseSchema(value: unknown): ProtocolParseResult<"opencoven.context-pack/v1"> {
  if (typeof value !== "string") {
    return fail("invalid_type", "$.schema", "schema must be a string");
  }
  if (value === CONTEXT_PACK_SCHEMA) {
    return pass(CONTEXT_PACK_SCHEMA);
  }
  const match = CONTEXT_PACK_SCHEMA_RE.exec(value);
  if (match) {
    return fail("unknown_major", "$.schema", `Unsupported Context Pack schema major v${match[1]}`);
  }
  return fail("invalid_value", "$.schema", `schema must equal ${CONTEXT_PACK_SCHEMA}`);
}

export function parseContextSelectorV1(
  value: unknown,
  path = "$.selector",
): ProtocolParseResult<ContextSelectorV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const typeField = parseRequiredField(object.value, "type", path);
  if (!typeField.ok) return typeField;

  const type = parseEnumValue(typeField.value, SELECTOR_TYPES, childPath(path, "type"), "selector type");
  if (!type.ok) return type;

  switch (type.value) {
    case "turn-range": {
      const startField = parseRequiredField(object.value, "start", path);
      if (!startField.ok) return startField;
      const start = parseSafeInteger(startField.value, childPath(path, "start"), "start");
      if (!start.ok) return start;

      const endField = parseRequiredField(object.value, "end", path);
      if (!endField.ok) return endField;
      const end = parseSafeInteger(endField.value, childPath(path, "end"), "end");
      if (!end.ok) return end;

      const range = parseRange(start.value, end.value, path, "turn-range");
      if (!range.ok) return range;

      return pass({ ...object.value, type: "turn-range", start: start.value, end: end.value });
    }
    case "json-pointer": {
      const pointerField = parseRequiredField(object.value, "pointer", path);
      if (!pointerField.ok) return pointerField;
      const pointer = parseJsonPointer(pointerField.value, childPath(path, "pointer"));
      if (!pointer.ok) return pointer;

      return pass({ ...object.value, type: "json-pointer", pointer: pointer.value });
    }
    case "text-span": {
      const startField = parseRequiredField(object.value, "start", path);
      if (!startField.ok) return startField;
      const start = parseSafeInteger(startField.value, childPath(path, "start"), "start");
      if (!start.ok) return start;

      const endField = parseRequiredField(object.value, "end", path);
      if (!endField.ok) return endField;
      const end = parseSafeInteger(endField.value, childPath(path, "end"), "end");
      if (!end.ok) return end;

      const range = parseRange(start.value, end.value, path, "text-span");
      if (!range.ok) return range;

      return pass({ ...object.value, type: "text-span", start: start.value, end: end.value });
    }
    case "markdown-section": {
      const headingPathField = parseRequiredField(object.value, "headingPath", path);
      if (!headingPathField.ok) return headingPathField;
      const headingPath = parseHeadingPath(headingPathField.value, childPath(path, "headingPath"));
      if (!headingPath.ok) return headingPath;

      return pass({ ...object.value, type: "markdown-section", headingPath: headingPath.value });
    }
    case "pdf-page-span": {
      const pageField = parseRequiredField(object.value, "page", path);
      if (!pageField.ok) return pageField;
      const page = parseSafeInteger(pageField.value, childPath(path, "page"), "page", 1);
      if (!page.ok) return page;

      const startField = parseRequiredField(object.value, "start", path);
      if (!startField.ok) return startField;
      const start = parseSafeInteger(startField.value, childPath(path, "start"), "start");
      if (!start.ok) return start;

      const endField = parseRequiredField(object.value, "end", path);
      if (!endField.ok) return endField;
      const end = parseSafeInteger(endField.value, childPath(path, "end"), "end");
      if (!end.ok) return end;

      const range = parseRange(start.value, end.value, path, "pdf-page-span");
      if (!range.ok) return range;

      return pass({
        ...object.value,
        type: "pdf-page-span",
        page: page.value,
        start: start.value,
        end: end.value,
      });
    }
    case "whole-resource":
      return pass({ ...object.value, type: "whole-resource" });
  }
}

export function parseContextPackResourceV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ContextPackResourceV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const idField = parseRequiredField(object.value, "id", path);
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "resource", childPath(path, "id"), "id");
  if (!id.ok) return id;

  const kindField = parseRequiredField(object.value, "kind", path);
  if (!kindField.ok) return kindField;
  const kind = parseEnumValue(kindField.value, RESOURCE_KINDS, childPath(path, "kind"), "kind");
  if (!kind.ok) return kind;

  const uriField = parseRequiredField(object.value, "uri", path);
  if (!uriField.ok) return uriField;
  const uri = parseString(uriField.value, childPath(path, "uri"), "uri", { allowEmpty: true });
  if (!uri.ok) return uri;

  const digestField = parseRequiredField(object.value, "digest", path);
  if (!digestField.ok) return digestField;
  const digest = parseSha256(digestField.value, childPath(path, "digest"), "digest");
  if (!digest.ok) return digest;

  const localBlobDigestField = parseRequiredField(object.value, "localBlobDigest", path);
  if (!localBlobDigestField.ok) return localBlobDigestField;
  const localBlobDigest = parseSha256(
    localBlobDigestField.value,
    childPath(path, "localBlobDigest"),
    "localBlobDigest",
  );
  if (!localBlobDigest.ok) return localBlobDigest;

  const selectorField = parseRequiredField(object.value, "selector", path);
  if (!selectorField.ok) return selectorField;
  const selector = parseContextSelectorV1(selectorField.value, childPath(path, "selector"));
  if (!selector.ok) return selector;

  const trustField = parseRequiredField(object.value, "trust", path);
  if (!trustField.ok) return trustField;
  const trust = parseEnumValue(trustField.value, RESOURCE_TRUST_LEVELS, childPath(path, "trust"), "trust");
  if (!trust.ok) return trust;

  const sensitivityField = parseRequiredField(object.value, "sensitivity", path);
  if (!sensitivityField.ok) return sensitivityField;
  const sensitivity = parseEnumValue(
    sensitivityField.value,
    RESOURCE_SENSITIVITIES,
    childPath(path, "sensitivity"),
    "sensitivity",
  );
  if (!sensitivity.ok) return sensitivity;

  const capturedAtField = parseRequiredField(object.value, "capturedAt", path);
  if (!capturedAtField.ok) return capturedAtField;
  const capturedAt = parseUtc(capturedAtField.value, childPath(path, "capturedAt"), "capturedAt");
  if (!capturedAt.ok) return capturedAt;

  const title = parseOptionalString(object.value, "title", path);
  if (!title.ok) return title;

  const mediaTypeField = parseRequiredField(object.value, "mediaType", path);
  if (!mediaTypeField.ok) return mediaTypeField;
  const mediaType = parseString(
    mediaTypeField.value,
    childPath(path, "mediaType"),
    "mediaType",
    { allowEmpty: true },
  );
  if (!mediaType.ok) return mediaType;

  return pass({
    ...object.value,
    id: id.value,
    kind: kind.value,
    uri: uri.value,
    digest: digest.value,
    localBlobDigest: localBlobDigest.value,
    selector: selector.value,
    trust: trust.value,
    sensitivity: sensitivity.value,
    capturedAt: capturedAt.value,
    ...(typeof title.value === "string" ? { title: title.value } : {}),
    mediaType: mediaType.value,
  });
}

function parseCreatedBy(value: unknown, path: string): ProtocolParseResult<ContextPackCreatedByV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const clientField = parseRequiredField(object.value, "client", path);
  if (!clientField.ok) return clientField;
  const client = parseString(clientField.value, childPath(path, "client"), "client");
  if (!client.ok) return client;
  if (client.value !== "coven-cave") {
    return fail("invalid_value", childPath(path, "client"), "client must be coven-cave");
  }

  const userId = parseOptionalString(object.value, "userId", path);
  if (!userId.ok) return userId;

  return pass({
    ...object.value,
    client: "coven-cave",
    ...(typeof userId.value === "string" ? { userId: userId.value } : {}),
  });
}

function parseSubject(value: unknown, path: string): ProtocolParseResult<ContextPackSubjectV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const familiarIdField = parseRequiredField(object.value, "familiarId", path);
  if (!familiarIdField.ok) return familiarIdField;
  const familiarId = parseString(
    familiarIdField.value,
    childPath(path, "familiarId"),
    "familiarId",
    { allowEmpty: true },
  );
  if (!familiarId.ok) return familiarId;

  const projectId = parseOptionalString(object.value, "projectId", path);
  if (!projectId.ok) return projectId;

  return pass({
    ...object.value,
    familiarId: familiarId.value,
    ...(typeof projectId.value === "string" ? { projectId: projectId.value } : {}),
  });
}

function parseConsent(value: unknown, path: string): ProtocolParseResult<ContextPackConsentV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const selectionModeField = parseRequiredField(object.value, "selectionMode", path);
  if (!selectionModeField.ok) return selectionModeField;
  const selectionMode = parseEnumValue(
    selectionModeField.value,
    SELECTION_MODES,
    childPath(path, "selectionMode"),
    "selectionMode",
  );
  if (!selectionMode.ok) return selectionMode;

  const allowRemoteQueriesField = parseRequiredField(object.value, "allowRemoteQueries", path);
  if (!allowRemoteQueriesField.ok) return allowRemoteQueriesField;
  const allowRemoteQueries = parseBoolean(
    allowRemoteQueriesField.value,
    childPath(path, "allowRemoteQueries"),
    "allowRemoteQueries",
  );
  if (!allowRemoteQueries.ok) return allowRemoteQueries;

  const allowRemoteContentField = parseRequiredField(object.value, "allowRemoteContent", path);
  if (!allowRemoteContentField.ok) return allowRemoteContentField;
  const allowRemoteContent = parseBoolean(
    allowRemoteContentField.value,
    childPath(path, "allowRemoteContent"),
    "allowRemoteContent",
  );
  if (!allowRemoteContent.ok) return allowRemoteContent;

  const artifactContentSyncField = parseRequiredField(object.value, "artifactContentSync", path);
  if (!artifactContentSyncField.ok) return artifactContentSyncField;
  const artifactContentSync = parseBoolean(
    artifactContentSyncField.value,
    childPath(path, "artifactContentSync"),
    "artifactContentSync",
  );
  if (!artifactContentSync.ok) return artifactContentSync;

  const retentionField = parseRequiredField(object.value, "retention", path);
  if (!retentionField.ok) return retentionField;
  const retention = parseEnumValue(
    retentionField.value,
    RETENTION_POLICIES,
    childPath(path, "retention"),
    "retention",
  );
  if (!retention.ok) return retention;

  return pass({
    ...object.value,
    selectionMode: selectionMode.value,
    allowRemoteQueries: allowRemoteQueries.value,
    allowRemoteContent: allowRemoteContent.value,
    artifactContentSync: artifactContentSync.value,
    retention: retention.value,
  });
}

function parsePolicy(
  value: unknown,
  path: string,
  purpose: ContextPackPurposeV1,
): ProtocolParseResult<ContextPackPolicyV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const treatField = parseRequiredField(object.value, "treatResourceTextAsData", path);
  if (!treatField.ok) return treatField;
  if (treatField.value !== true) {
    return fail(
      typeof treatField.value === "boolean" ? "invalid_value" : "invalid_type",
      childPath(path, "treatResourceTextAsData"),
      "treatResourceTextAsData must be true",
    );
  }

  const toolAuthorityField = parseRequiredField(object.value, "toolAuthority", path);
  if (!toolAuthorityField.ok) return toolAuthorityField;
  const toolAuthority = parseString(toolAuthorityField.value, childPath(path, "toolAuthority"), "toolAuthority");
  if (!toolAuthority.ok) return toolAuthority;
  if (toolAuthority.value !== "none") {
    return fail("invalid_value", childPath(path, "toolAuthority"), "toolAuthority must be none");
  }

  const allowedPurposesField = parseRequiredField(object.value, "allowedPurposes", path);
  if (!allowedPurposesField.ok) return allowedPurposesField;
  if (!Array.isArray(allowedPurposesField.value)) {
    return fail("invalid_type", childPath(path, "allowedPurposes"), "allowedPurposes must be an array");
  }
  if (allowedPurposesField.value.length === 0) {
    return fail("invalid_value", childPath(path, "allowedPurposes"), "allowedPurposes must not be empty");
  }

  const allowedPurposes: ContextPackPurposeV1[] = [];
  const seenPurposes = new Set<ContextPackPurposeV1>();
  for (const [index, rawPurpose] of allowedPurposesField.value.entries()) {
    const parsedPurpose = parseEnumValue(
      rawPurpose,
      PURPOSES,
      indexPath(childPath(path, "allowedPurposes"), index),
      "allowedPurposes item",
    );
    if (!parsedPurpose.ok) return parsedPurpose;
    if (seenPurposes.has(parsedPurpose.value)) {
      return fail(
        "semantic_conflict",
        indexPath(childPath(path, "allowedPurposes"), index),
        `Duplicate allowed purpose ${parsedPurpose.value}`,
      );
    }
    seenPurposes.add(parsedPurpose.value);
    allowedPurposes.push(parsedPurpose.value);
  }

  if (!seenPurposes.has(purpose)) {
    return fail(
      "semantic_conflict",
      childPath(path, "allowedPurposes"),
      `allowedPurposes must include the pack purpose ${purpose}`,
    );
  }

  return pass({
    ...object.value,
    treatResourceTextAsData: true,
    toolAuthority: "none",
    allowedPurposes,
  });
}

function parseTransforms(value: unknown, path: string): ProtocolParseResult<ContextPackTransformsV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const secretScanVersionField = parseRequiredField(object.value, "secretScanVersion", path);
  if (!secretScanVersionField.ok) return secretScanVersionField;
  const secretScanVersion = parseString(
    secretScanVersionField.value,
    childPath(path, "secretScanVersion"),
    "secretScanVersion",
    { allowEmpty: true },
  );
  if (!secretScanVersion.ok) return secretScanVersion;

  let redactionMapDigest: string | undefined;
  if (hasOwn(object.value, "redactionMapDigest")) {
    const parsedDigest = parseSha256(
      object.value.redactionMapDigest,
      childPath(path, "redactionMapDigest"),
      "redactionMapDigest",
    );
    if (!parsedDigest.ok) return parsedDigest;
    redactionMapDigest = parsedDigest.value;
  }

  return pass({
    ...object.value,
    secretScanVersion: secretScanVersion.value,
    ...(redactionMapDigest ? { redactionMapDigest } : {}),
  });
}

export function parseContextPackV1(value: unknown): ProtocolParseResult<ContextPackV1> {
  const object = parseObject(value, "$");
  if (!object.ok) return object;

  const schemaField = parseRequiredField(object.value, "schema", "$");
  if (!schemaField.ok) return schemaField;
  const schema = parseSchema(schemaField.value);
  if (!schema.ok) return schema;

  const idField = parseRequiredField(object.value, "id", "$");
  if (!idField.ok) return idField;
  const id = parseOpaqueIdentifier(idField.value, "ctx", "$.id", "id");
  if (!id.ok) return id;

  const digestField = parseRequiredField(object.value, "digest", "$");
  if (!digestField.ok) return digestField;
  const digest = parseSha256(digestField.value, "$.digest", "digest");
  if (!digest.ok) return digest;

  const createdAtField = parseRequiredField(object.value, "createdAt", "$");
  if (!createdAtField.ok) return createdAtField;
  const createdAt = parseUtc(createdAtField.value, "$.createdAt", "createdAt");
  if (!createdAt.ok) return createdAt;

  const createdByField = parseRequiredField(object.value, "createdBy", "$");
  if (!createdByField.ok) return createdByField;
  const createdBy = parseCreatedBy(createdByField.value, "$.createdBy");
  if (!createdBy.ok) return createdBy;

  const purposeField = parseRequiredField(object.value, "purpose", "$");
  if (!purposeField.ok) return purposeField;
  const purpose = parseEnumValue(purposeField.value, PURPOSES, "$.purpose", "purpose");
  if (!purpose.ok) return purpose;

  const subjectField = parseRequiredField(object.value, "subject", "$");
  if (!subjectField.ok) return subjectField;
  const subject = parseSubject(subjectField.value, "$.subject");
  if (!subject.ok) return subject;

  const consentField = parseRequiredField(object.value, "consent", "$");
  if (!consentField.ok) return consentField;
  const consent = parseConsent(consentField.value, "$.consent");
  if (!consent.ok) return consent;

  const resourcesField = parseRequiredField(object.value, "resources", "$");
  if (!resourcesField.ok) return resourcesField;
  if (!Array.isArray(resourcesField.value)) {
    return fail("invalid_type", "$.resources", "resources must be an array");
  }
  const resources: ContextPackResourceV1[] = [];
  const seenResourceIds = new Set<string>();
  for (const [index, resourceValue] of resourcesField.value.entries()) {
    const resource = parseContextPackResourceV1(resourceValue, indexPath("$.resources", index));
    if (!resource.ok) return resource;
    if (seenResourceIds.has(resource.value.id)) {
      return fail(
        "semantic_conflict",
        childPath(indexPath("$.resources", index), "id"),
        `Duplicate resource id ${resource.value.id}`,
      );
    }
    seenResourceIds.add(resource.value.id);
    resources.push(resource.value);
  }

  const policyField = parseRequiredField(object.value, "policy", "$");
  if (!policyField.ok) return policyField;
  const policy = parsePolicy(policyField.value, "$.policy", purpose.value);
  if (!policy.ok) return policy;

  const transformsField = parseRequiredField(object.value, "transforms", "$");
  if (!transformsField.ok) return transformsField;
  const transforms = parseTransforms(transformsField.value, "$.transforms");
  if (!transforms.ok) return transforms;

  return pass({
    ...object.value,
    schema: CONTEXT_PACK_SCHEMA,
    id: id.value,
    digest: digest.value,
    createdAt: createdAt.value,
    createdBy: createdBy.value,
    purpose: purpose.value,
    subject: subject.value,
    consent: consent.value,
    resources,
    policy: policy.value,
    transforms: transforms.value,
  });
}
