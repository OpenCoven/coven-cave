export type UnknownFields = Record<string, unknown>;

export type ProtocolErrorCode =
  | "invalid_type"
  | "invalid_value"
  | "missing_field"
  | "unknown_major"
  | "digest_mismatch"
  | "semantic_conflict";

export type ProtocolParseError = {
  code: ProtocolErrorCode;
  path: string;
  message: string;
};

export type ProtocolParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProtocolParseError };

export const RETENTION_ORDER = {
  "run-only": 0,
  "7-days": 1,
  project: 2,
} as const;

export type RetentionPolicyV1 = keyof typeof RETENTION_ORDER;

const SHA256_RE = /^[a-f0-9]{64}$/;
const OPAQUE_ID_BODY_RE = /^[A-Za-z0-9_-]+$/;
const UTC_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const JSON_POINTER_RE = /^(?:$|\/(?:[^~/]|~0|~1)*(?:\/(?:[^~/]|~0|~1)*)*)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP_RE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= daysInMonth[month - 1]!;
}

export function isJsonPointer(value: unknown): value is string {
  return typeof value === "string" && JSON_POINTER_RE.test(value);
}

export function isOpaqueId(value: unknown, prefix: string): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith(`${prefix}_`)) return false;
  const body = value.slice(prefix.length + 1);
  return body.length > 0 && OPAQUE_ID_BODY_RE.test(body);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function retentionDoesNotExceed(
  requested: RetentionPolicyV1,
  consented: RetentionPolicyV1,
): boolean {
  return RETENTION_ORDER[requested] <= RETENTION_ORDER[consented];
}

export function fail<T>(
  code: ProtocolErrorCode,
  path: string,
  message: string,
): ProtocolParseResult<T> {
  return { ok: false, error: { code, path, message } };
}

export function pass<T>(value: T): ProtocolParseResult<T> {
  return { ok: true, value };
}

export type ResearchContextBindingV1 = {
  contextPackId: string;
  contextPackDigest: string;
  topicProposalId?: string;
} & UnknownFields;

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
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

export function parseResearchContextBindingV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchContextBindingV1> {
  const object = parseObject(value, path);
  if (!object.ok) return object;

  const contextPackIdField = parseRequiredField(object.value, "contextPackId", path);
  if (!contextPackIdField.ok) return contextPackIdField;
  const contextPackId = parseOpaqueIdentifier(
    contextPackIdField.value,
    "ctx",
    childPath(path, "contextPackId"),
    "contextPackId",
  );
  if (!contextPackId.ok) return contextPackId;

  const contextPackDigestField = parseRequiredField(object.value, "contextPackDigest", path);
  if (!contextPackDigestField.ok) return contextPackDigestField;
  const contextPackDigest = parseSha256(
    contextPackDigestField.value,
    childPath(path, "contextPackDigest"),
    "contextPackDigest",
  );
  if (!contextPackDigest.ok) return contextPackDigest;

  let topicProposalId: string | undefined;
  if (hasOwn(object.value, "topicProposalId")) {
    const parsedTopicProposalId = parseOpaqueIdentifier(
      object.value.topicProposalId,
      "proposal",
      childPath(path, "topicProposalId"),
      "topicProposalId",
    );
    if (!parsedTopicProposalId.ok) return parsedTopicProposalId;
    topicProposalId = parsedTopicProposalId.value;
  }

  return pass({
    ...object.value,
    contextPackId: contextPackId.value,
    contextPackDigest: contextPackDigest.value,
    ...(typeof topicProposalId === "string" ? { topicProposalId } : {}),
  });
}
