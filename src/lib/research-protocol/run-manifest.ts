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
  utcTimestampToProtocolNanoseconds,
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
import {
  validateSafeExtensionKeys as validateSensitiveObjectKeys,
} from "./privacy-extension.ts";

export {
  SENSITIVE_EXTENSION_KEY_PATTERN,
  SENSITIVE_EXTENSION_VARIANT_KEY_PATTERN,
  SENSITIVE_EXTENSION_COMPONENT_KEY_PATTERN,
  SENSITIVE_EXTENSION_COMPOUND_KEY_PATTERN,
} from "./privacy-extension.ts";

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

const ARTIFACT_TITLE_URI_SCHEME_PREFIX_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const ARTIFACT_TITLE_SECRET_RE = /(?:sk-|ghp_|github_pat_)/;
const ARTIFACT_TITLE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const RUN_MANIFEST_FIELDS = new Set([
  "schema",
  "id",
  "runId",
  "digest",
  "revision",
  "previousDigest",
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
]);
const CONTEXT_BINDING_FIELDS = new Set([
  "contextPackId",
  "contextPackDigest",
  "topicProposalId",
]);
const CONTEXT_PACK_SOURCE_FIELDS = new Set(["kind", "id", "digest", "availability"]);
const PUBLIC_EVIDENCE_SOURCE_FIELDS = new Set([
  "kind",
  "id",
  "contentDigest",
  "snapshotDigest",
  "canonicalUrl",
  "fetchedAt",
]);
const ARTIFACT_FIELDS = new Set([
  "id",
  "kind",
  "title",
  "mediaType",
  "digest",
  "bytes",
  "placement",
  "contentSync",
  "createdAt",
]);
const MODEL_EXECUTION_FIELDS = new Set([
  "taskId",
  "phase",
  "attempt",
  "inputDigest",
  "outputDigest",
  "receipt",
]);
const MODEL_RECEIPT_FIELDS = new Set([
  "familiarId",
  "runtime",
  "effectiveModel",
  "modelSource",
  "providerBilling",
  "usage",
]);
const MODEL_USAGE_FIELDS = new Set([
  "inputTokens",
  "outputTokens",
  "costUsd",
  "reportedByRuntime",
]);
const MANIFEST_USAGE_FIELDS = new Set([
  "inputTokens",
  "outputTokens",
  "costUsd",
  "completeness",
]);
const RETENTION_FIELDS = new Set([
  "policy",
  "effectivePolicy",
  "status",
  "contentExpiresAt",
  "updatedAt",
]);
const DELETION_FIELDS = new Set([
  "status",
  "requestedAt",
  "completedAt",
  "deletedObjectCount",
  "retainedAuditUntil",
  "eventSequence",
]);

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

function validateModelReceiptExtensionKeys(
  value: unknown,
  path: string,
): ProtocolParseResult<void> {
  const receiptKeys = validateSensitiveObjectKeys(value, path, MODEL_RECEIPT_FIELDS);
  if (!receiptKeys.ok) return receiptKeys;
  if (!isRecord(value) || !hasOwn(value, "usage")) return pass(undefined);
  return validateSensitiveObjectKeys(
    value.usage,
    childPath(path, "usage"),
    MODEL_USAGE_FIELDS,
  );
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

const NON_GLOBAL_IPV4_RANGES = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
] as const;
const GLOBAL_IPV4_EXCEPTIONS = new Set([0xc0000009, 0xc000000a]);

function parseIpv4Address(hostname: string): number | undefined {
  const parts = hostname.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) {
    return undefined;
  }
  return parts.reduce((address, part) => address * 256 + Number(part), 0);
}

function ipv4AddressIsInRange(
  address: number,
  base: number,
  prefixLength: number,
): boolean {
  const size = 2 ** (32 - prefixLength);
  return address >= base && address < base + size;
}

function isPublicIpv4Address(address: number): boolean {
  if (GLOBAL_IPV4_EXCEPTIONS.has(address)) return true;
  return !NON_GLOBAL_IPV4_RANGES.some(([base, prefixLength]) =>
    ipv4AddressIsInRange(address, base, prefixLength),
  );
}

function isPublicIpv4(hostname: string): boolean {
  const address = parseIpv4Address(hostname);
  return address !== undefined && isPublicIpv4Address(address);
}

function parseIpv6Address(hostname: string): readonly number[] | undefined {
  let normalized = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  if (normalized.includes(".")) {
    const finalColon = normalized.lastIndexOf(":");
    if (finalColon < 0) return undefined;
    const ipv4 = parseIpv4Address(normalized.slice(finalColon + 1));
    if (ipv4 === undefined) return undefined;
    normalized = `${normalized.slice(0, finalColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half: string): number[] | undefined => {
    if (half === "") return [];
    const groups = half.split(":");
    if (groups.some((group) => !/^[a-f0-9]{1,4}$/.test(group))) {
      return undefined;
    }
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const left = parseHalf(halves[0]!);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;

  if (halves.length === 1) {
    return left.length === 8 ? left : undefined;
  }
  const omittedGroups = 8 - left.length - right.length;
  if (omittedGroups < 1) return undefined;
  return [...left, ...Array.from({ length: omittedGroups }, () => 0), ...right];
}

function ipv6HasPrefix(
  address: readonly number[],
  prefix: readonly number[],
  prefixLength: number,
): boolean {
  const completeGroups = Math.floor(prefixLength / 16);
  for (let index = 0; index < completeGroups; index += 1) {
    if (address[index] !== (prefix[index] ?? 0)) return false;
  }
  const remainingBits = prefixLength % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (
    (address[completeGroups]! & mask) ===
    ((prefix[completeGroups] ?? 0) & mask)
  );
}

function isPublicIpv6(hostname: string): boolean {
  const address = parseIpv6Address(hostname);
  if (!address) return false;
  const embeddedIpv4 = address[6]! * 0x10000 + address[7]!;

  if (
    ipv6HasPrefix(address, [0, 0, 0, 0, 0, 0], 96) ||
    ipv6HasPrefix(address, [0, 0, 0, 0, 0, 0xffff], 96) ||
    ipv6HasPrefix(address, [0, 0, 0, 0, 0xffff, 0], 96) ||
    ipv6HasPrefix(address, [0x0064, 0xff9b, 0, 0, 0, 0], 96)
  ) {
    return isPublicIpv4Address(embeddedIpv4);
  }
  if (ipv6HasPrefix(address, [0x2002], 16)) {
    const sixToFourIpv4 = address[1]! * 0x10000 + address[2]!;
    return isPublicIpv4Address(sixToFourIpv4);
  }
  if (ipv6HasPrefix(address, [0x2001, 0], 23)) {
    const protocolAnycast =
      address[1] === 1 &&
      address.slice(2, 7).every((group) => group === 0) &&
      address[7]! >= 1 &&
      address[7]! <= 3;
    return (
      protocolAnycast ||
      ipv6HasPrefix(address, [0x2001, 0x0003], 32) ||
      ipv6HasPrefix(address, [0x2001, 0x0004, 0x0112], 48) ||
      ipv6HasPrefix(address, [0x2001, 0x0020], 28) ||
      ipv6HasPrefix(address, [0x2001, 0x0030], 28)
    );
  }
  if (
    ipv6HasPrefix(address, [0x2001, 0x0db8], 32) ||
    ipv6HasPrefix(address, [0x3ffe], 16) ||
    ipv6HasPrefix(address, [0x3fff], 20)
  ) {
    return false;
  }
  return (address[0]! & 0xe000) === 0x2000;
}

const SPECIAL_USE_HOST_SUFFIXES = [
  "alt",
  "arpa",
  "corp",
  "example",
  "home",
  "internal",
  "invalid",
  "lan",
  "local",
  "localdomain",
  "localhost",
  "mail",
  "onion",
  "test",
] as const;
const SPECIAL_USE_HOSTNAMES = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  if (/^\d+(?:\.\d+){3}$/.test(normalized)) {
    return isPublicIpv4(normalized);
  }
  if (normalized.includes(":")) {
    return isPublicIpv6(normalized);
  }

  if (!normalized.includes(".")) return false;
  if (
    normalized.length > 253 ||
    normalized
      .split(".")
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  ) {
    return false;
  }
  if (
    SPECIAL_USE_HOST_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    )
  ) {
    return false;
  }
  return ![...SPECIAL_USE_HOSTNAMES].some(
    (name) => normalized === name || normalized.endsWith(`.${name}`),
  );
}

function parsePublicCanonicalUrl(
  value: unknown,
  path: string,
): ProtocolParseResult<string> {
  const parsedString = parseString(value, path, "canonicalUrl");
  if (!parsedString.ok) return parsedString;
  const candidate = parsedString.value;
  if (
    candidate.length === 0 ||
    candidate !== candidate.trim() ||
    /[\u0000-\u001f\u007f]/.test(candidate) ||
    candidate.includes("#") ||
    !/^[hH][tT][tT][pP][sS]?:\/\//.test(candidate)
  ) {
    return fail(
      "invalid_value",
      path,
      "canonicalUrl must be an absolute public HTTP(S) URL without userinfo or fragments",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fail("invalid_value", path, "canonicalUrl must be a valid absolute URL");
  }
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(candidate)?.[1] ?? "";
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    authority.includes("@") ||
    parsed.hostname === "" ||
    !isPublicHostname(parsed.hostname)
  ) {
    return fail(
      "invalid_value",
      path,
      "canonicalUrl must identify a public HTTP(S) host without userinfo",
    );
  }
  return pass(candidate);
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
    const safeKeys = validateSensitiveObjectKeys(
      object.value,
      path,
      CONTEXT_PACK_SOURCE_FIELDS,
    );
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

  const safeKeys = validateSensitiveObjectKeys(
    object.value,
    path,
    PUBLIC_EVIDENCE_SOURCE_FIELDS,
  );
  if (!safeKeys.ok) return safeKeys;

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
  const canonicalUrl = parsePublicCanonicalUrl(
    canonicalUrlField.value,
    childPath(path, "canonicalUrl"),
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
  const safeKeys = validateSensitiveObjectKeys(object.value, path, ARTIFACT_FIELDS);
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
  const safeKeys = validateSensitiveObjectKeys(
    object.value,
    path,
    MODEL_EXECUTION_FIELDS,
  );
  if (!safeKeys.ok) return safeKeys;

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
  const safeReceiptKeys = validateModelReceiptExtensionKeys(
    receiptField.value,
    childPath(path, "receipt"),
  );
  if (!safeReceiptKeys.ok) return safeReceiptKeys;
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
  const safeKeys = validateSensitiveObjectKeys(
    object.value,
    path,
    MANIFEST_USAGE_FIELDS,
  );
  if (!safeKeys.ok) return safeKeys;

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
  const safeKeys = validateSensitiveObjectKeys(object.value, path, RETENTION_FIELDS);
  if (!safeKeys.ok) return safeKeys;

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
  const safeKeys = validateSensitiveObjectKeys(object.value, path, DELETION_FIELDS);
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
    if (compareUtcTimestamps(deletion.completedAt!, deletion.requestedAt!) < 0) {
      return fail(
        "semantic_conflict",
        "$.deletion.completedAt",
        "completedAt must not be earlier than requestedAt",
      );
    }
  }
  return pass(undefined);
}

function validateDeletionChronology(
  createdAt: string,
  finalizedAt: string | undefined,
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  if (deletion.requestedAt === undefined) return pass(undefined);
  if (compareUtcTimestamps(deletion.requestedAt, createdAt) < 0) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "requestedAt must not be earlier than manifest createdAt",
    );
  }
  if (
    finalizedAt !== undefined &&
    compareUtcTimestamps(deletion.requestedAt, finalizedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "requestedAt must not be earlier than manifest finalizedAt",
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
): ProtocolParseResult<void> {
  if (
    finalizedAt !== undefined &&
    compareUtcTimestamps(finalizedAt, createdAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.finalizedAt",
      "finalizedAt must not be earlier than manifest createdAt",
    );
  }

  for (const [index, source] of sources.entries()) {
    if (source.kind !== "public-evidence") continue;
    if (
      compareUtcTimestamps(source.fetchedAt, createdAt) < 0 ||
      (finalizedAt !== undefined &&
        compareUtcTimestamps(source.fetchedAt, finalizedAt) > 0)
    ) {
      return fail(
        "semantic_conflict",
        `$.sources[${index}].fetchedAt`,
        "Public evidence fetchedAt must fall within the manifest assembly window",
      );
    }
  }

  for (const [index, artifact] of artifacts.entries()) {
    if (
      compareUtcTimestamps(artifact.createdAt, createdAt) < 0 ||
      (finalizedAt !== undefined &&
        compareUtcTimestamps(artifact.createdAt, finalizedAt) > 0)
    ) {
      return fail(
        "semantic_conflict",
        `$.artifacts[${index}].createdAt`,
        "Artifact createdAt must fall within the manifest assembly window",
      );
    }
  }

  if (compareUtcTimestamps(retention.updatedAt, createdAt) < 0) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "Retention updatedAt must not be earlier than manifest createdAt",
    );
  }
  if (
    finalizedAt !== undefined &&
    compareUtcTimestamps(retention.updatedAt, finalizedAt) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "Final manifest retention updatedAt must not be earlier than finalizedAt",
    );
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

function validateFinalRetentionShortening(
  state: RunManifestV1["state"],
  shortened: boolean,
  retention: RunManifestRetentionV1,
  deletion: RunManifestDeletionReceiptV1,
): ProtocolParseResult<void> {
  if (state !== "final" || !shortened) return pass(undefined);
  if (retention.status === "active" || deletion.status === "not_scheduled") {
    return fail(
      "semantic_conflict",
      "$.retention.status",
      "shortened final retention must have scheduled-or-later deletion",
    );
  }
  const pair = validateRetentionDeletionPair(retention, deletion);
  if (!pair.ok) return pair;
  if (retention.contentExpiresAt === null) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "shortened final retention requires contentExpiresAt",
    );
  }
  return pass(undefined);
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
const MUTABLE_RETENTION_FIELDS = new Set(["effectivePolicy", "status", "contentExpiresAt", "updatedAt"]);
const MUTABLE_DELETION_FIELDS = new Set([
  "status",
  "requestedAt",
  "completedAt",
  "deletedObjectCount",
  "retainedAuditUntil",
  "eventSequence",
]);
const RETENTION_STATUS_ORDER = {
  active: 0,
  deletion_scheduled: 1,
  deletion_pending: 2,
  deleted: 3,
} as const;
const DELETION_STATUS_ORDER = {
  not_scheduled: 0,
  scheduled: 1,
  pending: 2,
  partial_failure: 2,
  completed: 3,
} as const;
const RETENTION_DURATION_SECONDS = {
  "run-only": 24 * 60 * 60,
  "7-days": 7 * 24 * 60 * 60,
} as const;

function validateFiniteRetentionDeadline(
  retention: RunManifestRetentionV1,
  clockStart: string,
): ProtocolParseResult<void> {
  if (
    retention.contentExpiresAt === null ||
    retention.effectivePolicy === "project"
  ) {
    return pass(undefined);
  }
  const deadline = utcTimestampToProtocolNanoseconds(retention.contentExpiresAt);
  const ceiling =
    utcTimestampToProtocolNanoseconds(clockStart) +
    BigInt(RETENTION_DURATION_SECONDS[retention.effectivePolicy]) *
      BigInt(1_000_000_000);
  if (deadline > ceiling) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      `${retention.effectivePolicy} content expiration exceeds its policy deadline ceiling`,
    );
  }
  return pass(undefined);
}

function validateFreshRetentionConsent(
  previous: RunManifestV1,
  next: RunManifestV1,
  options: ManifestRevisionOptions,
  path: string,
): ProtocolParseResult<string> {
  if (
    options.freshConsent !== true ||
    options.freshConsentAt === undefined ||
    !isUtcTimestamp(options.freshConsentAt) ||
    (next.context !== undefined && options.contextConsent === undefined)
  ) {
    return fail(
      "semantic_conflict",
      path,
      next.context === undefined
        ? "Retention lengthening requires explicit fresh consent"
        : "Retention lengthening requires explicit fresh Context Pack consent",
    );
  }
  const latestPriorAuthority =
    previous.deletion.requestedAt !== undefined &&
    compareUtcTimestamps(
      previous.deletion.requestedAt,
      previous.retention.updatedAt,
    ) > 0
      ? previous.deletion.requestedAt
      : previous.retention.updatedAt;
  if (
    compareUtcTimestamps(options.freshConsentAt, latestPriorAuthority) <= 0 ||
    compareUtcTimestamps(options.freshConsentAt, next.retention.updatedAt) > 0
  ) {
    return fail(
      "semantic_conflict",
      path,
      "Fresh consent must postdate prior retention and deletion-request authority and be no later than the new revision",
    );
  }
  return pass(options.freshConsentAt);
}

function validateRetentionLifecycleRevision(
  previous: RunManifestV1,
  next: RunManifestV1,
  options: ManifestRevisionOptions,
): ProtocolParseResult<void> {
  const previousDeadline = previous.retention.contentExpiresAt;
  const nextDeadline = next.retention.contentExpiresAt;
  if (
    compareUtcTimestamps(
      next.retention.updatedAt,
      previous.retention.updatedAt,
    ) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.updatedAt",
      "Retention updatedAt cannot move backward",
    );
  }
  const policyLengthened =
    RETENTION_ORDER[next.retention.effectivePolicy] >
    RETENTION_ORDER[previous.retention.effectivePolicy];
  const deadlineExtended =
    previousDeadline !== null &&
    nextDeadline !== null &&
    compareUtcTimestamps(nextDeadline, previousDeadline) > 0;
  const deadlineRemoved = previousDeadline !== null && nextDeadline === null;
  const restoration =
    deadlineRemoved &&
    previous.retention.status === "deletion_scheduled" &&
    previous.deletion.status === "scheduled" &&
    next.retention.effectivePolicy === "project" &&
    next.retention.status === "active" &&
    next.deletion.status === "not_scheduled";
  const lengtheningPath = policyLengthened
    ? "$.retention.effectivePolicy"
    : "$.retention.contentExpiresAt";
  const retentionLengthened =
    policyLengthened || deadlineExtended || deadlineRemoved;
  const deletionPendingOrLater = [previous, next].some(
    (manifest) =>
      manifest.retention.status === "deletion_pending" ||
      manifest.retention.status === "deleted" ||
      manifest.deletion.status === "pending" ||
      manifest.deletion.status === "partial_failure" ||
      manifest.deletion.status === "completed",
  );
  if (retentionLengthened && deletionPendingOrLater) {
    return fail(
      "semantic_conflict",
      lengtheningPath,
      "Retention cannot be restored after deletion has started",
    );
  }

  let freshConsentAt: string | undefined;
  if (retentionLengthened) {
    const freshConsent = validateFreshRetentionConsent(
      previous,
      next,
      options,
      lengtheningPath,
    );
    if (!freshConsent.ok) return freshConsent;
    freshConsentAt = freshConsent.value;
  }

  if (previousDeadline !== null && nextDeadline === null && !restoration) {
    return fail(
      "semantic_conflict",
      "$.retention.contentExpiresAt",
      "An established content expiration deadline cannot be cleared",
    );
  }
  if (
    RETENTION_STATUS_ORDER[next.retention.status] <
      RETENTION_STATUS_ORDER[previous.retention.status] &&
    !restoration
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.status",
      "Retention deletion progress cannot move backward",
    );
  }
  if (
    DELETION_STATUS_ORDER[next.deletion.status] <
      DELETION_STATUS_ORDER[previous.deletion.status] &&
    !restoration
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.status",
      "Deletion progress cannot move backward",
    );
  }
  if (
    previous.deletion.requestedAt !== undefined &&
    next.deletion.requestedAt !== previous.deletion.requestedAt &&
    !restoration
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "An established deletion request timestamp cannot change",
    );
  }
  if (
    previous.deletion.requestedAt === undefined &&
    next.deletion.requestedAt !== undefined &&
    compareUtcTimestamps(
      next.deletion.requestedAt,
      previous.retention.updatedAt,
    ) < 0
  ) {
    return fail(
      "semantic_conflict",
      "$.deletion.requestedAt",
      "A new deletion request must not predate prior retention authority",
    );
  }

  const inheritsFiniteDeadlineAuthority =
    previousDeadline !== null &&
    nextDeadline !== null &&
    RETENTION_ORDER[next.retention.effectivePolicy] >=
      RETENTION_ORDER[previous.retention.effectivePolicy] &&
    compareUtcTimestamps(nextDeadline, previousDeadline) <= 0;
  if (!inheritsFiniteDeadlineAuthority) {
    const deadline = validateFiniteRetentionDeadline(
      next.retention,
      freshConsentAt ??
        next.finalizedAt ??
        previous.finalizedAt ??
        next.createdAt,
    );
    if (!deadline.ok) return deadline;
  }

  if (previous.deletion.status === "completed") {
    for (const key of [
      "requestedAt",
      "completedAt",
      "deletedObjectCount",
      "retainedAuditUntil",
      "eventSequence",
    ] as const) {
      if (canonicalField(previous.deletion, key) !== canonicalField(next.deletion, key)) {
        return fail(
          "semantic_conflict",
          `$.deletion.${key}`,
          "Completed deletion receipts are terminal",
        );
      }
    }
  }
  if (previous.retention.status === "deleted") {
    for (const key of [
      "effectivePolicy",
      "status",
      "contentExpiresAt",
      "updatedAt",
    ] as const) {
      if (canonicalField(previous.retention, key) !== canonicalField(next.retention, key)) {
        return fail(
          "semantic_conflict",
          `$.retention.${key}`,
          "Deleted retention state is terminal",
        );
      }
    }
  }
  return pass(undefined);
}

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

type RunManifestParseMode =
  | "standalone"
  | "revision-candidate"
  | "embedded-candidate";

function parseRunManifestValueV1(
  value: unknown,
  mode: RunManifestParseMode,
): ProtocolParseResult<RunManifestV1> {
  const standalone = mode === "standalone";
  const validateStandaloneDeadline = mode === "standalone";
  const wireValue = copyProtocolJsonValue(value);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, "$");
  if (!object.ok) return object;
  const safeKeys = validateSensitiveObjectKeys(
    object.value,
    "$",
    RUN_MANIFEST_FIELDS,
  );
  if (!safeKeys.ok) return safeKeys;

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
    const safeContextKeys = validateSensitiveObjectKeys(
      object.value.context,
      "$.context",
      CONTEXT_BINDING_FIELDS,
    );
    if (!safeContextKeys.ok) return safeContextKeys;
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
    if (usage.value[key] !== expectedUsage[key]) {
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
  if (
    standalone &&
    !retentionDoesNotExceed(
      retention.value.effectivePolicy,
      retention.value.policy,
    )
  ) {
    return fail(
      "semantic_conflict",
      "$.retention.effectivePolicy",
      "effectivePolicy must not exceed policy outside validated revision-chain consent",
    );
  }

  const pair = validateRetentionDeletionPair(retention.value, deletion.value);
  if (!pair.ok) return pair;
  const deletionRequirements = validateDeletionRequirements(deletion.value);
  if (!deletionRequirements.ok) return deletionRequirements;
  const deletionChronology = validateDeletionChronology(
    createdAt.value,
    finalizedAt,
    deletion.value,
  );
  if (!deletionChronology.ok) return deletionChronology;
  const chronology = validateManifestChronology(
    createdAt.value,
    finalizedAt,
    sources,
    artifacts,
    retention.value,
  );
  if (!chronology.ok) return chronology;
  const clock = validateRetentionClock(retention.value);
  if (!clock.ok) return clock;
  if (validateStandaloneDeadline) {
    const deadline = validateFiniteRetentionDeadline(
      retention.value,
      finalizedAt ?? createdAt.value,
    );
    if (!deadline.ok) return deadline;
  }
  const shortening = validateFinalRetentionShortening(
    state.value,
    RETENTION_ORDER[retention.value.effectivePolicy] <
      RETENTION_ORDER[retention.value.policy],
    retention.value,
    deletion.value,
  );
  if (!shortening.ok) return shortening;

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

export function parseRunManifestV1(value: unknown): ProtocolParseResult<RunManifestV1> {
  const parsed = parseRunManifestValueV1(value, "standalone");
  if (!parsed.ok || parsed.value.revision !== 1) return parsed;
  const remembered = rememberValidatedRevisionReference(
    parsed.value,
    parsed.value,
  );
  if (!remembered.ok) return remembered;
  return parsed;
}

/**
 * Parses a manifest that will immediately be checked against its preceding
 * revision. The candidate's finite deadline is deferred to the chain validator,
 * where verified fresh consent can supply a later clock.
 */
function parseRunManifestRevisionCandidateV1(
  value: unknown,
): ProtocolParseResult<RunManifestV1> {
  return parseRunManifestValueV1(value, "revision-candidate");
}

/** @internal Embedded manifests remain provisional until run + pack composition. */
export function parseEmbeddedRunManifestCandidateV1(
  value: unknown,
): ProtocolParseResult<RunManifestV1> {
  return parseRunManifestValueV1(value, "embedded-candidate");
}

export function validateManifestRetentionConsent(
  manifest: RunManifestV1,
  contextConsent: RetentionPolicyV1 | undefined,
): ProtocolParseResult<RunManifestV1> {
  const consent = validateManifestRetentionCeiling(manifest, contextConsent);
  if (!consent.ok) return consent;
  const deadline = validateFiniteRetentionDeadline(
    manifest.retention,
    manifest.finalizedAt ?? manifest.createdAt,
  );
  if (!deadline.ok) return deadline;
  return pass(manifest);
}

function validateManifestRetentionCeiling(
  manifest: RunManifestV1,
  contextConsent: RetentionPolicyV1 | undefined,
): ProtocolParseResult<RunManifestV1> {
  if (!manifest.context) {
    if (
      !retentionDoesNotExceed(
        manifest.retention.effectivePolicy,
        manifest.retention.policy,
      )
    ) {
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

function validateParsedRunManifestRevision(
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

  const consent = validateManifestRetentionCeiling(
    next,
    options.contextConsent,
  );
  if (!consent.ok) return consent;

  const lifecycle = validateRetentionLifecycleRevision(previous, next, options);
  if (!lifecycle.ok) return lifecycle;

  const shortening = validateFinalRetentionShortening(
    next.state,
    RETENTION_ORDER[next.retention.effectivePolicy] <
      RETENTION_ORDER[previous.retention.effectivePolicy],
    next.retention,
    next.deletion,
  );
  if (!shortening.ok) return shortening;

  return pass(next);
}

type ValidatedRevisionProvenance = {
  fingerprint: string;
  detachedValue: RunManifestV1;
};

const validatedRevisionProvenance = new WeakMap<
  object,
  ValidatedRevisionProvenance
>();

function rememberValidatedRevisionReference(
  reference: object,
  manifest: RunManifestV1,
): ProtocolParseResult<void> {
  const detached = copyProtocolJsonValue(manifest);
  if (!detached.ok) return detached;
  let fingerprint: string;
  try {
    fingerprint = canonicalJson(reference);
  } catch {
    return fail(
      "invalid_value",
      "$",
      "Validated manifest must contain only canonical JSON data",
    );
  }
  validatedRevisionProvenance.set(reference, {
    fingerprint,
    detachedValue: detached.value,
  });
  return pass(undefined);
}

function resolveTrustedPredecessor(
  previous: RunManifestV1,
): ProtocolParseResult<RunManifestV1> {
  const provenance =
    previous !== null && typeof previous === "object"
      ? validatedRevisionProvenance.get(previous)
      : undefined;
  if (provenance !== undefined) {
    try {
      if (canonicalJson(previous) !== provenance.fingerprint) {
        return fail(
          "semantic_conflict",
          "$.digest",
          "A validated predecessor cannot be mutated",
        );
      }
    } catch {
      return fail(
        "semantic_conflict",
        "$.digest",
        "A validated predecessor cannot be mutated",
      );
    }
    return pass(provenance.detachedValue);
  }
  return fail(
    "semantic_conflict",
    "$.revision",
    "Previous manifest lacks revision-1-rooted validation provenance",
  );
}

/**
 * Parses and validates one candidate revision atomically. Candidate parsing may
 * defer standalone retention ceilings only inside this composition boundary;
 * the linked previous revision and fresh consent checks must then authorize any
 * extension before the parsed candidate is returned. Only strict revision-1
 * parsing establishes root provenance; every later predecessor must be the
 * unmodified result returned by a successful sequential validation.
 */
export function validateRunManifestRevisionV1(
  previous: RunManifestV1,
  candidate: unknown,
  options: ManifestRevisionOptions = {},
): ProtocolParseResult<RunManifestV1> {
  const trustedPrevious = resolveTrustedPredecessor(previous);
  if (!trustedPrevious.ok) return trustedPrevious;
  const next = parseRunManifestRevisionCandidateV1(candidate);
  if (!next.ok) return next;
  const validated = validateParsedRunManifestRevision(
    trustedPrevious.value,
    next.value,
    options,
  );
  if (!validated.ok) return validated;
  const rememberedResult = rememberValidatedRevisionReference(
    validated.value,
    validated.value,
  );
  if (!rememberedResult.ok) return rememberedResult;
  return validated;
}

/** @deprecated Use validateRunManifestRevisionV1. */
export const validateRunManifestRevision = validateRunManifestRevisionV1;
